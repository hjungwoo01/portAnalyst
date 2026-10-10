# Portfolio

A personal portfolio tracker on GitHub Pages: sector and cash weightings, and a time-weighted comparison against a benchmark you choose.

This repository is only the app; it holds no portfolio data. Holdings and prices live in the private repository `hjungwoo01/portAnalyst-data`, and the page reads them through the GitHub API with a fine-grained token you paste in once per device. Without a token that can read that repository, the site shows nothing.

- `site/`: the page (`index.html`, `app.js`, `calc.js`).
- `calc.test.mjs`: tests for the portfolio math. Run with `node --test`.
- `.github/workflows/deploy.yml`: tests and deploys `site/` on every push.

Tickers use Yahoo Finance symbols: `AAPL`, `005930.KS` (KOSPI), `035720.KQ` (KOSDAQ), `^KS11` (KOSPI index), `BTC-USD`.
