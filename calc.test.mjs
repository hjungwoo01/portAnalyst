import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, allocation, splitAdjust, windowReturn } from './site/calc.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const prices = {
  base: 'USD',
  dates: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
  fx: { KRW: [0.001, 0.001, 0.001, 0.001] },
  tickers: {
    A: { name: 'A', currency: 'USD', sectors: { Technology: 1 }, splits: [], close: [100, 100, 110, 121], change: [110, 121] },
    B: { name: 'B', currency: 'KRW', sectors: { Energy: 0.5, Utilities: 0.5 }, splits: [], close: [1000, 1000, 1000, 2000], change: [1000, 2000] },
    S: { name: 'S', currency: 'USD', sectors: {}, splits: [], close: [50, 50, 55, 55], change: [55, 55] },
  },
};
const holdings = {
  base: 'USD', benchmark: 'S', cash: { USD: 100, EUR: 5 },
  transactions: [
    { date: '2024-01-03', ticker: 'B', shares: 100, price: 1000 },
    { date: '2024-01-02', ticker: 'A', shares: 1, price: 100 },
    { date: '2024-01-03', ticker: 'A', shares: 1, price: 110 },
    { date: '2024-01-03', ticker: 'NEW', shares: 1, price: 5 },
  ],
};

test('positions, fx, cash and pending', () => {
  const a = analyze(holdings, prices);
  const [A, B] = a.positions;
  assert.deepEqual([A.ticker, B.ticker], ['A', 'B']);
  near(A.cost, 210); near(A.value, 242); near(A.day, 22);
  near(B.cost, 100); near(B.value, 200); near(B.day, 100);
  near(a.cashValue, 100); near(a.total, 542);
  assert.deepEqual(a.pending.sort(), ['EUR', 'NEW']);
});

test('time-weighted return ignores money moving in and out', () => {
  const a = analyze(holdings, prices);
  near(a.series.you.at(-1), 442 / 310 - 1);
  near(a.series.bench.at(-1), 0.1);
  const sold = analyze({ ...holdings, transactions: [...holdings.transactions,
    { date: '2024-01-04', ticker: 'A', shares: -1, price: 121 }] }, prices);
  near(sold.series.you.at(-1), 442 / 310 - 1);
  near(sold.positions.find((p) => p.ticker === 'A').cost, 105);
});

test('holdings counted as cash join cash and leave the benchmark comparison', () => {
  const a = analyze({ ...holdings, countAsCash: ['B'] }, prices);
  near(a.total, 542); near(a.cashValue, 300);
  assert.ok(a.positions.find((p) => p.ticker === 'B').asCash);
  near(a.series.you.at(-1), 242 / 210 - 1); // A alone, B's flows ignored
  assert.deepEqual(allocation(a, 'holding').map((r) => [r.name, r.value]), [['A', 242], ['Cash', 300]]);
});

test('allocation spreads sectors and appends cash', () => {
  const rows = allocation(analyze(holdings, prices), 'sector');
  assert.deepEqual(rows.map((r) => [r.name, r.value]),
    [['Technology', 242], ['Energy', 100], ['Utilities', 100], ['Cash', 100]]);
});

test('splits after a trade adjust it; on the split date they do not', () => {
  assert.deepEqual(splitAdjust({ date: '2024-06-01', shares: 10, price: 1000 }, [['2024-06-10', 10]]),
    { date: '2024-06-01', shares: 100, price: 100 });
  assert.equal(splitAdjust({ date: '2024-06-10', shares: 1, price: 100 }, [['2024-06-10', 10]]).shares, 1);
});

test('window return rebases to its first point', () => {
  const w = windowReturn({ dates: ['a', 'b', 'c'], you: [0, 0.1, 0.21], bench: [null, null, null] }, 1);
  near(w.you[0], 0); near(w.you[1], 0.1);
  assert.deepEqual(w.bench, [null, null]);
});
