# Portfolio

A personal portfolio tracker on GitHub Pages: sector and cash weightings, and a time-weighted comparison against a benchmark you choose.

- `site/holdings.json` holds your trades, cash, benchmark and display currency. Edit it from the site (**Edit**, then sign in with a fine-grained token that has Contents read and write on this repo) or by committing the file directly.
- `scripts/fetch_prices.py` pulls prices, splits, sectors and FX from Yahoo Finance into `site/prices.json` during each deploy. It isn't committed.
- `.github/workflows/deploy.yml` deploys on every push and every 2 hours on weekdays. Run it from the Actions tab to refresh prices on demand.

Tickers use Yahoo Finance symbols: `AAPL`, `005930.KS` (KOSPI), `035720.KQ` (KOSDAQ), `^KS11` (KOSPI index), `BTC-USD`.

Local preview:

```bash
pip install yfinance && python scripts/fetch_prices.py && python -m http.server 8000 --directory site
```

Tests: `node --test`
