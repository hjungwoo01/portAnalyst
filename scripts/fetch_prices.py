"""Build site/prices.json (daily closes, splits, sectors, FX) for the tickers in site/holdings.json."""
import datetime as dt
import json
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

SITE = Path(__file__).resolve().parent.parent / "site"
FUND_SECTORS = {
    "realestate": "Real Estate", "consumer_cyclical": "Consumer Cyclical",
    "basic_materials": "Basic Materials", "consumer_defensive": "Consumer Defensive",
    "technology": "Technology", "communication_services": "Communication Services",
    "financial_services": "Financial Services", "utilities": "Utilities",
    "industrials": "Industrials", "energy": "Energy", "healthcare": "Healthcare",
}


def sectors(t):
    try:
        info = t.info or {}
    except Exception:
        return "", {"Other": 1}
    name = info.get("shortName") or info.get("longName") or ""
    if info.get("sector"):
        return name, {info["sector"]: 1}
    if info.get("quoteType") in ("ETF", "MUTUALFUND"):
        try:  # look through the fund to its stock sectors
            w = {FUND_SECTORS.get(k, k): v for k, v in t.funds_data.sector_weightings.items() if v > 0}
            if sum(w.values()):
                return name, {k: v / sum(w.values()) for k, v in w.items()}
        except Exception:
            pass
        return name, {info.get("category") or "Funds": 1}
    return name, {"Crypto" if info.get("quoteType") == "CRYPTOCURRENCY" else "Other": 1}


def closes(hist):
    s = hist["Close"]
    s.index = pd.to_datetime(hist.index.date)  # local trading date per exchange
    return s[~s.index.duplicated(keep="last")]


def num(x):
    return None if pd.isna(x) else float(f"{x:.6g}")


def main():
    h = json.loads((SITE / "holdings.json").read_text())
    base = h["base"]
    first = min((t["date"] for t in h["transactions"]), default=str(dt.date.today()))
    start = dt.date.fromisoformat(first) - dt.timedelta(days=10)  # room for the day-before baseline

    symbols = sorted({t["ticker"] for t in h["transactions"]} | {h["benchmark"]})
    series, meta, errors = {}, {}, []
    for s in symbols:
        t = yf.Ticker(s)
        try:
            hist = t.history(start=start, auto_adjust=False, actions=True)
            if hist.empty:
                raise ValueError("no data")
        except Exception as e:
            print(f"skip {s}: {e}", file=sys.stderr)
            errors.append(s)
            continue
        series[s] = closes(hist)
        split = hist["Stock Splits"][hist["Stock Splits"] > 0]
        name, sec = sectors(t)
        raw = hist["Close"].dropna()
        meta[s] = {
            "name": name, "currency": t.history_metadata.get("currency", base), "sectors": sec,
            "splits": [[d.strftime("%Y-%m-%d"), float(r)] for d, r in split.items()],
            "change": [num(raw.iloc[-2] if len(raw) > 1 else raw.iloc[-1]), num(raw.iloc[-1])],
        }

    if symbols and not series:
        sys.exit("No prices fetched; keeping the previous deployment.")

    fx = {}
    for cur in ({m["currency"] for m in meta.values()} | set(h.get("cash", {}))) - {base}:
        try:
            fx[cur] = closes(yf.Ticker(f"{cur}{base}=X").history(start=start))
        except Exception as e:
            print(f"skip fx {cur}: {e}", file=sys.stderr)

    df = pd.DataFrame(series).sort_index().ffill()
    if fx:  # FX trades on a different calendar: fill both ways, then align to trading days
        fxdf = pd.DataFrame(fx)
        fxdf = fxdf.reindex(fxdf.index.union(df.index)).ffill().bfill().reindex(df.index)

    out = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "base": base,
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "tickers": {s: {**meta[s], "close": [num(x) for x in df[s]]} for s in series},
        "fx": {c: [num(x) for x in fxdf[c]] for c in fx} if fx else {},
        "errors": errors,
    }
    (SITE / "prices.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(series)} tickers, {len(fx)} fx, {len(df)} days, errors: {errors}")


if __name__ == "__main__":
    main()
