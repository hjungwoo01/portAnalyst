// Pure portfolio math over holdings.json + prices.json (built by scripts/fetch_prices.py).

// Splits after a trade's date scale its shares up and its price down.
export function splitAdjust(tx, splits = []) {
  const r = splits.reduce((r, [d, k]) => (d > tx.date ? r * k : r), 1);
  return { ...tx, shares: tx.shares * r, price: tx.price / r };
}

// First index whose date is >= d (dates are sorted ISO strings), clamped to the last index.
export function indexOnOrAfter(dates, d) {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; dates[m] < d ? (lo = m + 1) : (hi = m); }
  return Math.min(lo, dates.length - 1);
}

export function analyze(holdings, prices) {
  const { dates, tickers, fx: fxs = {}, base } = prices;
  const n = dates.length, last = n - 1;
  const fx = (cur, i) => (cur === base ? 1 : fxs[cur]?.[i] ?? null);
  const px = (s, i) => {
    const t = tickers[s], c = t?.close[i], f = t && fx(t.currency, i);
    return c == null || f == null ? null : c * f;
  };

  // Tickers or currencies added since the last price build wait for the next one.
  const pending = new Set();
  const priced = (t) => tickers[t.ticker] && fx(tickers[t.ticker].currency, last) != null;
  for (const t of holdings.transactions) if (!priced(t)) pending.add(t.ticker);
  for (const cur in holdings.cash) if (fx(cur, last) == null) pending.add(cur);

  const txs = holdings.transactions
    .filter(priced)
    .map((t) => ({ ...splitAdjust(t, tickers[t.ticker].splits), i: indexOnOrAfter(dates, t.date) }))
    .sort((a, b) => a.i - b.i);
  const amount = (t) => t.shares * t.price * fx(tickers[t.ticker].currency, t.i);
  const asCash = new Set(holdings.countAsCash || []); // e.g. T-bill ETFs the owner treats as cash

  // Positions on an average-cost basis: a sell removes cost pro rata.
  const pos = {};
  for (const t of txs) {
    const p = (pos[t.ticker] ??= { ticker: t.ticker, shares: 0, cost: 0 });
    if (t.shares > 0) p.cost += amount(t);
    else if (p.shares > 0) p.cost *= Math.max(p.shares + t.shares, 0) / p.shares;
    p.shares += t.shares;
  }
  const positions = Object.values(pos)
    .filter((p) => Math.abs(p.shares) > 1e-9)
    .map((p) => {
      const t = tickers[p.ticker], [prev, price] = t.change, f = fx(t.currency, last);
      const value = p.shares * price * f;
      return { ...p, asCash: asCash.has(p.ticker), name: t.name, currency: t.currency, sectors: t.sectors, price, value,
               gain: value - p.cost, day: p.shares * (price - prev) * f };
    })
    .sort((a, b) => b.value - a.value);

  const cash = Object.entries(holdings.cash || {})
    .filter(([cur]) => fx(cur, last) != null)
    .map(([currency, amt]) => ({ currency, amount: amt, value: amt * fx(currency, last) }));

  // Time-weighted return of the invested holdings (cash and cash-like holdings excluded).
  // Buys enter at the start of their day, sells leave at its end, so money moving in or out
  // never counts as performance.
  const inv = txs.filter((t) => !asCash.has(t.ticker));
  const s0 = Math.max((inv[0]?.i ?? last) - 1, 0);
  const held = {}, you = [], bench = [];
  const b0 = px(holdings.benchmark, s0);
  let prevV = 0, index = 1, k = 0;
  for (let i = s0; i < n; i++) {
    let buys = 0, sells = 0;
    for (; k < inv.length && inv[k].i <= i; k++) {
      const t = inv[k];
      held[t.ticker] = (held[t.ticker] || 0) + t.shares;
      t.shares > 0 ? (buys += amount(t)) : (sells -= amount(t));
    }
    let V = 0;
    for (const s in held) V += held[s] * (px(s, i) ?? 0);
    if (prevV + buys > 0) index *= (V + sells) / (prevV + buys);
    you.push(index - 1);
    bench.push(b0 ? px(holdings.benchmark, i) / b0 - 1 : null);
    prevV = V;
  }

  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const invested = sum(positions, 'value'), cashBalance = sum(cash, 'value');
  const cashValue = cashBalance + sum(positions.filter((p) => p.asCash), 'value');
  return {
    base, positions, cash, invested, cashValue, total: invested + cashBalance,
    cost: sum(positions, 'cost'), day: sum(positions, 'day'),
    series: { dates: dates.slice(s0), you, bench },
    pending: [...pending],
  };
}

// Value per sector (ETFs spread across their look-through weights) or per holding,
// plus one Cash row that includes holdings counted as cash.
export function allocation(a, by) {
  const m = new Map();
  const add = (k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const p of a.positions) {
    if (p.asCash) continue;
    if (by === 'holding') add(p.ticker, p.value);
    else for (const [s, w] of Object.entries(p.sectors)) add(s, p.value * w);
  }
  const rows = [...m].sort((x, y) => y[1] - x[1]);
  if (a.cashValue > 0) rows.push(['Cash', a.cashValue]);
  return rows.map(([name, value]) => ({ name, value, weight: value / a.total }));
}

// Return over a window of the series, rebased to its first point.
export function windowReturn(series, k) {
  const rebase = (a) => a.slice(k).map((v) => (v == null ? null : (1 + v) / (1 + a[k]) - 1));
  return { dates: series.dates.slice(k), you: rebase(series.you), bench: rebase(series.bench) };
}
