import { analyze, allocation, indexOnOrAfter, windowReturn } from './calc.js';

// Holdings and prices live in a private repository, so only a token with access can read or change them.
const DATA = 'https://api.github.com/repos/hjungwoo01/portAnalyst-data/contents';
const RANGES = { '1M': 1, '3M': 3, 'YTD': 0, '1Y': 12, 'All': null };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time

// Korea, Japan and China mark gains in red, like Apple Stocks does in those regions.
if (/^(ko|ja|zh)\b/.test(navigator.language)) document.documentElement.dataset.updown = 'east';

let holdings, prices, sha, draft, a, loadError;
const view = { range: store.get('range') || '1Y', by: store.get('by') || 'sector' };

// ---------- formatting ----------
const fmt = (v, o) => new Intl.NumberFormat(undefined, o).format(v);
const money = (v, cur = a.base, sign) => fmt(v, { style: 'currency', currency: cur, signDisplay: sign ? 'exceptZero' : 'auto' });
const pct = (v, d = 1, sign = true) => fmt(v, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: sign ? 'exceptZero' : 'auto' });
const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const day = (iso, long) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, long ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', year: 'numeric' });

// ---------- GitHub ----------
const token = () => store.get('gh-token');
const b64 = (s) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(''));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const gh = (file, { method = 'GET', body, raw, tok = token() } = {}) => fetch(`${DATA}/${file}`, {
  method, cache: 'no-store',
  headers: { Authorization: `Bearer ${tok}`, Accept: `application/vnd.github${raw ? '.raw' : ''}+json` },
  body: body && JSON.stringify(body),
});

// Returns an error message for the sign-in screen, or nothing on success.
async function load(tok = token()) {
  try {
    const [h, p] = await Promise.all([gh('holdings.json', { tok }), gh('prices.json', { raw: true, tok })]);
    if (h.status === 401) return 'GitHub doesn’t recognize that token. It may have expired.';
    if (h.status === 404) return 'That token can’t read portAnalyst-data. Give it access to that repository.';
    if (!h.ok) return `GitHub returned an error (${h.status}). Try again in a moment.`;
    const j = await h.json();
    sha = j.sha;
    holdings = JSON.parse(unb64(j.content));
    holdings.cash ??= {};
    holdings.countAsCash ??= [];
    prices = p.ok ? await p.json() : null;
  } catch {
    return 'Couldn’t reach GitHub. Check your connection and try again.';
  }
}

// ---------- render ----------
function render() {
  $('#edit').hidden = !holdings; // the private screen has its own Sign In button
  const empty = !holdings
    ? `<h2>This portfolio is private</h2><p>Sign in with your GitHub token to view it.</p>${loadError ? `<p class="err">${esc(loadError)}</p>` : ''}<button class="prominent" type="button" data-open-editor>Sign In</button>`
    : !prices
    ? '<h2>No price data yet</h2><p>Prices come from the Prices workflow in portAnalyst-data. If this persists, check that repository’s Actions tab.</p>'
    : !holdings.transactions.length && !Object.keys(holdings.cash).length
    ? '<h2>No holdings yet</h2><p>Add your first trade to see your sectors, your cash and how you compare with your benchmark.</p><button class="prominent" type="button" data-open-editor>Add a Trade</button>'
    : '';
  $('#empty').innerHTML = empty;
  $('#empty').hidden = !empty;
  $('#main').hidden = !!empty;
  if (empty) return;
  a = analyze(holdings, prices);
  renderSummary(); renderBench(); renderAlloc(); renderHoldings(); renderNotes();
}

function renderSummary() {
  const prevTotal = a.total - a.day, gain = a.invested - a.cost;
  const stat = (label, value, sub, cls = '') => `<div class="stat ${cls}"><dt>${label}</dt><dd>${value}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  $('#summary').innerHTML =
    stat('Total value', money(a.total), '', 'total') +
    stat('Today', `<span class="${tone(a.day)}">${money(a.day, a.base, true)}</span>`, `<span class="${tone(a.day)}">${pct(prevTotal ? a.day / prevTotal : 0, 2)}</span>`) +
    stat('Unrealized gain', `<span class="${tone(gain)}">${money(gain, a.base, true)}</span>`, `<span class="${tone(gain)}">${pct(a.cost ? gain / a.cost : 0)}</span>`) +
    stat('Cash', money(a.cashValue), `<span class="muted">${pct(a.total ? a.cashValue / a.total : 0, 1, false)} of portfolio</span>`);
}

function rangeStart(r, last) {
  if (RANGES[r] == null) return 0;
  const d = new Date(last + 'T12:00:00');
  if (r === 'YTD') d.setMonth(0, 1); else d.setMonth(d.getMonth() - RANGES[r]);
  return Math.max(indexOnOrAfter(a.series.dates, d.toLocaleDateString('sv')) - 1, 0); // baseline = prior close
}

const swatch = (dash) => `<svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" class="${dash ? 'bm' : 'you'}"/></svg>`;

function renderBench() {
  const b = esc(holdings.benchmark), w = windowReturn(a.series, rangeStart(view.range, a.series.dates.at(-1)));
  const you = w.you.at(-1), bm = w.bench.at(-1);
  const summary = (i) => `${swatch()}You <span class="${tone(w.you[i])}">${pct(w.you[i])}</span> · ${swatch(1)}${b} ${w.bench[i] == null ? '—' : `<span class="${tone(w.bench[i])}">${pct(w.bench[i])}</span>`}`;
  const since = `since ${day(w.dates[0], true)}`;

  if (bm == null) $('#verdict').textContent = `Waiting for ${holdings.benchmark} prices`;
  else {
    const d = you - bm, pts = (v) => { const t = fmt(Math.abs(v) * 100, { maximumFractionDigits: 1 }); return `${t} ${t === '1' ? 'point' : 'points'}`; };
    $('#verdict').innerHTML = Math.abs(d) < 0.0005 ? `Even with ${b}`
      : `${d > 0 ? 'Beating' : 'Trailing'} ${b} by <span class="${tone(d)}">${pts(d)}</span>`;
  }
  const sub = $('#bench-sub');
  sub.innerHTML = `${summary(w.you.length - 1)} · ${since}`;

  $('#range').innerHTML = '<legend class="vh">Period</legend>' + Object.keys(RANGES).map((r) =>
    `<input type="radio" name="range" id="r-${r}" value="${r}" ${r === view.range ? 'checked' : ''}><label for="r-${r}">${r}</label>`).join('');
  $('#bench-foot').textContent = `Time-weighted return of your holdings, so deposits and withdrawals don’t count as performance. Cash, including holdings you count as cash, is excluded. Both are price returns without dividends, in ${a.base}.`;

  drawChart(w, (i) => { sub.innerHTML = i == null ? `${summary(w.you.length - 1)} · ${since}` : `${day(w.dates[i], true)} · ${summary(i)}`; });
}

function drawChart(w, onScrub) {
  const el = $('#chart'), W = el.clientWidth || 600, H = Math.round(Math.min(Math.max(W * 0.42, 180), 260));
  const padR = 52, padT = 8, padB = 24, pw = W - padR, ph = H - padT - padB, n = w.dates.length;
  const vals = [...w.you, ...w.bench].filter((v) => v != null);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const raw = Math.max(hi - lo, 0.01) / 4, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * p >= raw) * p;
  lo = Math.floor(lo / step - 1e-9) * step; hi = Math.ceil(hi / step + 1e-9) * step;
  const x = (i) => (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph;
  const path = (s) => s.map((v, i) => (v == null ? '' : `${i && s[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');

  let grid = '';
  for (let t = lo; t <= hi + step / 2; t += step) {
    const v = Math.abs(t) < step / 1e6 ? 0 : t;
    grid += `<line class="grid${v === 0 ? ' zero' : ''}" x1="0" x2="${pw}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pw + 8}" y="${y(v) + 4}">${pct(v, step < 0.01 ? 1 : 0)}</text>`;
  }
  const long = n > 120;
  const xl = `<text class="axis" x="0" y="${H - 4}">${day(w.dates[0], !long)}</text><text class="axis" x="${pw}" y="${H - 4}" text-anchor="end">${day(w.dates[n - 1], !long)}</text>`;
  const label = `Line chart of return from ${day(w.dates[0], true)} to ${day(w.dates[n - 1], true)}. You ${pct(w.you[n - 1])}, ${esc(holdings.benchmark)} ${w.bench[n - 1] == null ? 'unavailable' : pct(w.bench[n - 1])}. Use left and right arrow keys to read values by day.`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" tabindex="0" role="img" aria-label="${label}">
    ${grid}${xl}
    <path class="bm" d="${path(w.bench)}"/><path class="you" d="${path(w.you)}"/>
    <g id="scrub" visibility="hidden"><line class="scrub" y1="${padT}" y2="${padT + ph}"/><circle r="4" fill="var(--label2)"/><circle r="4.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/></g>
  </svg>`;

  const svg = el.firstElementChild, g = svg.querySelector('#scrub'), [ln, cb, cy] = g.children;
  let cur = null;
  const show = (i) => {
    cur = i;
    g.setAttribute('visibility', i == null ? 'hidden' : 'visible');
    if (i != null) {
      ln.setAttribute('x1', x(i)); ln.setAttribute('x2', x(i));
      cy.setAttribute('cx', x(i)); cy.setAttribute('cy', y(w.you[i]));
      cb.setAttribute('cx', x(i)); cb.setAttribute('cy', y(w.bench[i] ?? 0)); cb.setAttribute('r', w.bench[i] == null ? 0 : 4);
    }
    onScrub(i);
  };
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) * (W / r.width);
    show(Math.round(Math.min(Math.max(fx / pw, 0), 1) * (n - 1)));
  };
  svg.onpointerleave = svg.onblur = () => show(null);
  svg.onkeydown = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (step == null) return;
    e.preventDefault();
    show(Math.min(Math.max((cur ?? n - 1) + step, 0), n - 1));
  };
}

function renderAlloc() {
  let rows = allocation(a, view.by);
  const cash = rows.filter((r) => r.name === 'Cash');
  rows = rows.filter((r) => r.name !== 'Cash');
  if (rows.length > 10) {
    const rest = rows.splice(9);
    rows.push({ name: `${rest.length} more`, value: rest.reduce((s, r) => s + r.value, 0), weight: rest.reduce((s, r) => s + r.weight, 0) });
  }
  rows = rows.map((r, i) => ({ ...r, color: `var(--c${i + 1})` })).concat(cash.map((r) => ({ ...r, color: 'var(--cash)' })));

  $('#by').innerHTML = '<legend class="vh">Group by</legend>' + [['sector', 'Sector'], ['holding', 'Holding']].map(([v, l]) =>
    `<input type="radio" name="by" id="by-${v}" value="${v}" ${v === view.by ? 'checked' : ''}><label for="by-${v}">${l}</label>`).join('');
  $('#alloc-body').innerHTML = `
    <div class="stack" aria-hidden="true">${rows.map((r) => `<span style="flex:${r.weight} 0 0;background:${r.color}"></span>`).join('')}</div>
    <ul class="list legend">${rows.map((r) => `<li><i style="background:${r.color}"></i><span class="name">${esc(r.name)}</span><span class="pct num">${pct(r.weight, 1, false)}</span><span class="val num">${money(r.value)}</span></li>`).join('')}</ul>
    ${view.by === 'sector' ? '<p class="foot">Funds are split across the sectors they hold.</p>' : ''}`;
}

function renderHoldings() {
  const w = (v) => pct(a.total ? v / a.total : 0, 1, false);
  const shares = (s) => `${fmt(s, { maximumFractionDigits: 4 })} ${Math.abs(s) === 1 ? 'share' : 'shares'}`;
  const row = (p) => `<li>
    <div class="row"><span><span class="tk">${esc(p.ticker)}</span> <span class="muted">${esc(p.name)}</span></span><span class="num">${money(p.value)}</span></div>
    <div class="row"><span class="num">${shares(p.shares)} · ${money(p.price, p.currency)} · ${w(p.value)}</span><span class="num ${tone(p.gain)}">${money(p.gain, a.base, true)} (${pct(p.cost ? p.gain / p.cost : 0)})</span></div>
  </li>`;
  const invested = a.positions.filter((p) => !p.asCash);
  const cash = a.cash.map((c) => `<li>
    <div class="row"><span class="tk">${esc(c.currency)}</span><span class="num">${money(c.value)}</span></div>
    <div class="row"><span class="num">${c.currency === a.base ? 'Cash' : money(c.amount, c.currency)} · ${w(c.value)}</span><span></span></div>
  </li>`).join('') + a.positions.filter((p) => p.asCash).map(row).join('');
  $('#hold-title').textContent = `Holdings (${invested.length})`;
  $('#hold-body').innerHTML = `<ul class="list hold">${invested.map(row).join('')}</ul>${cash ? `<p class="group-label">Cash</p><ul class="list hold">${cash}</ul>` : ''}`;
}

function renderNotes() {
  const missing = a.pending.filter((s) => prices.errors?.includes(s));
  const waiting = a.pending.filter((s) => !missing.includes(s));
  const notes = [];
  if (waiting.length) notes.push(`Waiting for prices for ${waiting.join(', ')}. They arrive about a minute after saving; reload to see them.`);
  if (missing.length) notes.push(`Yahoo Finance has no prices for ${missing.join(', ')}. Outside the US, Yahoo adds an exchange suffix: .L for London (IB01.L), .KS or .KQ for Korea.`);
  if (holdings.base !== prices.base) notes.push(`Values switch to ${holdings.base} after the next update.`);
  if (!$('#status').dataset.sticky) $('#status').textContent = notes.join(' ');
  $('#updated').textContent = `Prices from Yahoo Finance, updated ${new Date(prices.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`;
}

// ---------- editing ----------
function openEditor() {
  draft = structuredClone(holdings);
  $('#set-bench').value = draft.benchmark;
  $('#set-base').value = draft.base;
  $('#set-ascash').value = draft.countAsCash.join(', ');
  $('#trade-form').date.value = today();
  $('#trade-form').date.max = today();
  $('#save-err').textContent = '';
  renderDraft();
  $('#editor').showModal();
}

function renderDraft() {
  const list = draft.transactions.map((t, i) => [t, i]).sort(([x], [y]) => y.date.localeCompare(x.date));
  $('#trades').innerHTML = list.map(([t, i]) => {
    const what = `${t.shares > 0 ? 'Buy' : 'Sell'} ${fmt(Math.abs(t.shares), { maximumFractionDigits: 6 })} ${t.ticker} at ${fmt(t.price, { maximumFractionDigits: 6 })}`;
    return `<li><span class="num"><span class="muted">${esc(t.date)}</span> ${esc(what)}</span><button type="button" class="icon-btn" data-del-trade="${i}" aria-label="Delete ${esc(what)} on ${esc(t.date)}">✕</button></li>`;
  }).join('') || '<li class="muted">No trades yet.</li>';
  $('#cash-rows').innerHTML = Object.entries(draft.cash).map(([c, v]) =>
    `<li><label><span>${esc(c)}</span><input type="number" inputmode="decimal" step="any" min="0" value="${esc(v)}" data-cash="${esc(c)}" aria-label="${esc(c)} cash amount"></label><button type="button" class="icon-btn" data-del-cash="${esc(c)}" aria-label="Remove ${esc(c)} cash">✕</button></li>`).join('');
}

$('#trade-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, err = $('#trade-err');
  const shares = +f.shares.value, price = +f.price.value;
  err.textContent =
    !f.ticker.checkValidity() ? 'Enter a ticker as Yahoo Finance lists it, like AAPL or 005930.KS.' :
    !(shares > 0) ? 'Enter how many shares you traded.' :
    !(price > 0) ? 'Enter the price per share.' :
    !f.date.value || f.date.value > today() ? 'Enter a date that isn’t in the future.' : '';
  if (err.textContent) return;
  draft.transactions.push({ date: f.date.value, ticker: f.ticker.value.trim().toUpperCase(), shares: shares * +f.side.value, price });
  f.ticker.value = f.shares.value = f.price.value = '';
  renderDraft();
  f.ticker.focus();
});

$('#cash-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const cur = e.target.cur.value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return e.target.cur.reportValidity();
  draft.cash[cur] ??= 0;
  e.target.reset();
  renderDraft();
  $(`[data-cash="${cur}"]`).focus();
});

$('#editor').addEventListener('click', (e) => {
  const t = e.target.closest('[data-del-trade]'), c = e.target.closest('[data-del-cash]');
  if (t) { draft.transactions.splice(+t.dataset.delTrade, 1); renderDraft(); }
  if (c) { delete draft.cash[c.dataset.delCash]; renderDraft(); }
});
$('#editor').addEventListener('input', (e) => {
  if (e.target.dataset.cash) draft.cash[e.target.dataset.cash] = +e.target.value || 0;
});

const settings = () => ({
  benchmark: $('#set-bench').value.trim().toUpperCase(),
  base: $('#set-base').value.trim().toUpperCase(),
  countAsCash: $('#set-ascash').value.split(/[\s,]+/).filter(Boolean).map((t) => t.toUpperCase()),
});
const dirty = () => JSON.stringify({ ...draft, ...settings() }) !== JSON.stringify(holdings);
function closeEditor() {
  if (!dirty() || confirm('Discard your unsaved changes?')) $('#editor').close();
}
$('#editor').addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(); });
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (b.closest('dialog').id === 'editor' ? closeEditor() : b.closest('dialog').close())));

$('#save').addEventListener('click', async () => {
  const err = $('#save-err'), bench = $('#set-bench'), base = $('#set-base');
  if (!bench.checkValidity() || !base.checkValidity()) { err.textContent = 'Enter a benchmark ticker and a three-letter currency code.'; return; }
  if (!settings().countAsCash.every((t) => /^[A-Z0-9.\-^=]{1,20}$/.test(t))) { err.textContent = 'List the holdings that count as cash as tickers separated by commas, like IB01.L.'; return; }
  Object.assign(draft, settings());
  if (!dirty()) return $('#editor').close();

  const btn = $('#save');
  btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
  try {
    const r = await gh('holdings.json', { method: 'PUT', body: { message: 'Update holdings', content: b64(JSON.stringify(draft, null, 2) + '\n'), sha } });
    if (r.ok) {
      sha = (await r.json()).content.sha;
      holdings = draft;
      $('#editor').close();
      $('#status').dataset.sticky = 1;
      $('#status').textContent = 'Saved. Prices for any new tickers arrive in about a minute; reload to see them.';
      render();
    } else if (r.status === 409) {
      err.textContent = 'Your holdings changed on GitHub since this page loaded. Reload the page and make your edit again.';
    } else if (r.status === 401) {
      err.textContent = 'GitHub no longer accepts your token. Sign out, then sign in with a new one.';
    } else if (r.status === 403 || r.status === 404) {
      err.textContent = 'This token can view but not save. Give it Contents read and write access to portAnalyst-data.';
    } else {
      err.textContent = `GitHub returned an error (${r.status}). Try again in a moment.`;
    }
  } catch {
    err.textContent = 'Couldn’t reach GitHub. Check your connection and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
});

$('#signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tok = $('#token').value.trim(), err = $('#signin-err');
  if (!tok) { err.textContent = 'Paste your token.'; return; }
  err.textContent = '';
  const msg = await load(tok);
  if (msg) { err.textContent = msg; return; }
  store.set('gh-token', tok);
  loadError = null;
  $('#token').value = '';
  $('#signin').close();
  render();
});

$('#signout').addEventListener('click', () => {
  store.set('gh-token', null);
  location.reload();
});

const edit = () => (holdings && token() ? openEditor() : $('#signin').showModal());
$('#edit').addEventListener('click', edit);
$('#empty').addEventListener('click', (e) => e.target.closest('[data-open-editor]') && edit());

// ---------- controls ----------
document.addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name !== 'range' && name !== 'by') return;
  view[name] = value; store.set(name, value);
  name === 'range' ? renderBench() : renderAlloc();
  document.getElementById(e.target.id)?.focus();
});
let resizeW = innerWidth;
addEventListener('resize', () => { if (innerWidth !== resizeW && a) { resizeW = innerWidth; renderBench(); } });

// ---------- start ----------
if (token()) loadError = await load();
render();
