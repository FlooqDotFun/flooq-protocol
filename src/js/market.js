// Live market board. Reads ONLY the market record of the register. The contract record is never consulted.
import { POLL_MS, backoffDelay, pickSolanaAddresses, chunk, PAIR_CHUNK, buildTokens, topByVolume, sortTokens, fmtCompact, fmtPrice, fmtPct, fmtInt, letterFor, tileIndex, shortAddr } from './market-core.js';
import { copyText, flashCopied } from './copy.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FETCH_TIMEOUT = 12000;

export function initMarket(record) {
  const rowsEl = document.querySelector('[data-rows]');
  const tickerTrack = document.querySelector('[data-ticker-track]');
  const ticker = document.querySelector('[data-ticker]');
  const pills = [...document.querySelectorAll('[data-pill]'), ...document.querySelectorAll('[data-pill-b]')];
  const errEl = document.querySelector('[data-feed-error]');
  const tileEls = Object.fromEntries([...document.querySelectorAll('[data-tile]')].map(e => [e.dataset.tile, e]));
  const barEls = [...document.querySelectorAll('[data-bar]')];
  const tabs = [...document.querySelectorAll('[data-sort]')];
  if (!rowsEl) return;

  let sortKey = 'vol', good = [], attempt = 0, timer = 0, ctrl = null, started = false;
  const rowMap = new Map(); // address -> { el, token, cells }
  const live = document.querySelector('[data-live]');

  const setPill = (state, text) => pills.forEach(p => { p.dataset.state = state; p.querySelector('[data-pill-text]').textContent = text; });

  if (!record || record.state !== 'stated' || !record.url) {
    setPill('down', 'Feed pending');
    rowsEl.querySelectorAll('[data-skeleton]').forEach(r => r.remove());
    errEl.hidden = false; errEl.textContent = 'The market feed record is pending, so the board stays dashed.';
    return;
  }

  // ---------- number cells with count-up and change flash ----------
  function setNum(el, to, fmt, { flash = true } = {}) {
    const from = el._v ?? null;
    el._v = to;
    if (reduced || to == null || !Number.isFinite(to)) { el.textContent = fmt(to); el._t && cancelAnimationFrame(el._t); return; }
    const start = from ?? 0, t0 = performance.now(), dur = from == null ? 900 : 650;
    if (from != null && from !== to && flash) {
      const cls = to > from ? 'flash-up' : 'flash-down';
      el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(cls);
    }
    el._t && cancelAnimationFrame(el._t);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = k === 1 ? 1 : 1 - 2 ** (-10 * k);
      el.textContent = fmt(start + (to - start) * e);
      if (k < 1) el._t = requestAnimationFrame(step);
    };
    el._t = requestAnimationFrame(step);
  }

  // ---------- logo with letter-tile fallback ----------
  function logo(token, size) {
    const wrap = document.createElement('span');
    wrap.className = 'logo t' + tileIndex(token.address);
    if (size) wrap.style.width = wrap.style.height = size + 'px';
    const letter = () => { wrap.textContent = letterFor(token.symbol); };
    if (!token.imageUrl) { letter(); return wrap; }
    const img = new Image();
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.remove(); letter(); }, { once: true });
    img.src = token.imageUrl;
    wrap.append(img);
    return wrap;
  }

  // ---------- rows ----------
  function makeRow(token) {
    const li = document.createElement('li');
    li.className = 'row is-entering';
    li.innerHTML = `<span class="c-rank"></span><span class="c-token"><span class="nm"><strong></strong><span></span></span></span>
      <span class="c-num c-price" data-label="Price"><span></span></span><span class="c-num c-chg" data-label="24h"><span></span></span>
      <span class="c-num c-vol" data-label="Volume"><span></span></span><span class="c-num c-liq" data-label="Depth"><span></span></span>
      <span class="c-act"><button class="copy" type="button" data-row-copy><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button></span>`;
    const q = s => li.querySelector(s);
    const cells = { rank: q('.c-rank'), token: q('.c-token'), name: q('.nm strong'), sub: q('.nm span'), price: q('.c-price span'), chg: q('.c-chg span'), chgCell: q('.c-chg'), vol: q('.c-vol span'), liq: q('.c-liq span'), btn: q('[data-row-copy]') };
    cells.token.prepend(logo(token));
    li.addEventListener('pointermove', e => { const r = li.getBoundingClientRect(); li.style.setProperty('--sx', e.clientX - r.left + 'px'); li.style.setProperty('--sy', e.clientY - r.top + 'px'); });
    cells.btn.addEventListener('click', async () => {
      const ok = await copyText(entry.token.address);
      flashCopied(cells.btn, ok ? 'Address copied' : 'Copy failed');
    });
    const entry = { el: li, token, cells };
    return entry;
  }

  function fillRow(entry, token, rank) {
    const c = entry.cells; entry.token = token;
    c.rank.textContent = rank;
    c.name.textContent = token.symbol;
    c.sub.textContent = (token.name && token.name !== token.symbol ? token.name + ' · ' : '') + shortAddr(token.address);
    c.btn.setAttribute('aria-label', 'Copy address of ' + token.symbol);
    setNum(c.price, token.price, fmtPrice);
    setNum(c.chg, token.change, fmtPct);
    c.chgCell.classList.toggle('up', token.change > 0); c.chgCell.classList.toggle('down', token.change < 0);
    setNum(c.vol, token.volume, fmtCompact);
    setNum(c.liq, token.liquidity, fmtCompact);
  }

  function render(first) {
    const list = sortTokens(good, sortKey);
    const keep = new Set(list.map(t => t.address));
    for (const [a, e] of rowMap) if (!keep.has(a)) { e.el.remove(); rowMap.delete(a); }
    const before = new Map([...rowMap].map(([a, e]) => [a, e.el.getBoundingClientRect().top]));
    const fresh = [];
    list.forEach((t, i) => {
      let e = rowMap.get(t.address);
      if (!e) { e = makeRow(t); rowMap.set(t.address, e); fresh.push(e); }
      fillRow(e, t, i + 1);
      rowsEl.append(e.el);
    });
    // skeletons out, real rows in with a stagger
    rowsEl.querySelectorAll('[data-skeleton]').forEach(r => r.remove());
    fresh.forEach((e, i) => {
      if (reduced) { e.el.classList.remove('is-entering'); return; }
      e.el.style.transitionDelay = (first ? i * 60 : 0) + 'ms';
      requestAnimationFrame(() => requestAnimationFrame(() => e.el.classList.remove('is-entering')));
    });
    // FLIP for reorders
    if (!reduced) for (const [a, e] of rowMap) {
      if (!before.has(a)) continue;
      const d = before.get(a) - e.el.getBoundingClientRect().top;
      if (!d) continue;
      e.el.style.transition = 'none'; e.el.style.transform = `translateY(${d}px)`;
      requestAnimationFrame(() => { e.el.style.transition = ''; e.el.style.transform = ''; });
    }
    renderTiles(list); renderTicker(list); renderBars(list);
  }

  function renderTiles(list) {
    const sum = k => list.reduce((s, t) => s + (t[k] || 0), 0);
    const set = (k, v, fmt) => { const el = tileEls[k]; if (!el) return; let s = el.querySelector('.fl'); if (!s) { el.textContent = ''; s = document.createElement('span'); s.className = 'fl'; el.append(s); } setNum(s, v, fmt); };
    set('vol', sum('volume'), fmtCompact); set('liq', sum('liquidity'), fmtCompact);
    set('up', list.filter(t => t.change > 0).length, v => fmtInt(v) + ' of ' + fmtInt(list.length));
    set('cnt', list.length, fmtInt);
  }

  function renderTicker(list) {
    if (!tickerTrack) return;
    const sig = list.map(t => t.address).join();
    const items = list.map(t => ({ t }));
    if (tickerTrack.dataset.sig !== sig) {
      tickerTrack.textContent = '';
      for (let copy = 0; copy < 2; copy++) items.forEach(({ t }, i) => {
        const el = document.createElement('span');
        el.className = 'tick'; el.style.setProperty('--i', String(i)); el.dataset.addr = t.address;
        if (copy) el.setAttribute('aria-hidden', 'true');
        el.append(logo(t), Object.assign(document.createElement('span'), { className: 'sym', textContent: t.symbol }), Object.assign(document.createElement('span'), { className: 'px' }), Object.assign(document.createElement('span'), { className: 'ch' }));
        tickerTrack.append(el);
      });
      tickerTrack.dataset.sig = sig;
      tickerTrack.style.setProperty('--marquee', Math.max(30, list.length * 7) + 's');
    }
    const byAddr = new Map(list.map(t => [t.address, t]));
    tickerTrack.querySelectorAll('.tick').forEach(el => {
      const t = byAddr.get(el.dataset.addr); if (!t) return;
      el.querySelector('.px').textContent = fmtPrice(t.price);
      const ch = el.querySelector('.ch'); ch.textContent = fmtPct(t.change); ch.className = 'ch ' + (t.change > 0 ? 'up' : t.change < 0 ? 'down' : '');
    });
    if (reduced && ticker) ticker.classList.add('is-static');
  }

  function renderBars(list) {
    if (!barEls.length || !list.length) return;
    const max = Math.max(...list.map(t => t.volume)) || 1;
    barEls.forEach((b, i) => { const t = list[i % list.length]; b.style.setProperty('--h', (14 + 86 * Math.sqrt(t.volume / max)).toFixed(1) + '%'); b.style.setProperty('--k', String(i)); });
  }

  // ---------- fetching ----------
  async function getJson(url, signal) {
    const t = AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT) : undefined;
    const sig = t && AbortSignal.any ? AbortSignal.any([signal, t]) : signal;
    const res = await fetch(url, { signal: sig, headers: { accept: 'application/json' }, referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    return res.json();
  }

  async function load() {
    ctrl?.abort(); ctrl = new AbortController();
    const boosts = await getJson(record.url, ctrl.signal);
    const addrs = pickSolanaAddresses(boosts, PAIR_CHUNK * 2);
    if (!addrs.length) throw new Error('no solana entries');
    const pairs = [];
    for (const group of chunk(addrs, PAIR_CHUNK)) {
      const url = record.pairsUrl.replace('{addresses}', group.join(','));
      const data = await getJson(url, ctrl.signal);
      if (Array.isArray(data)) pairs.push(...data);
    }
    const tokens = topByVolume(buildTokens(pairs, addrs));
    if (!tokens.length) throw new Error('no pairs');
    return tokens;
  }

  function showDashes() {
    rowsEl.querySelectorAll('[data-skeleton]').forEach(r => r.remove());
    if (rowMap.size) return;
    for (let i = 0; i < 10; i++) {
      const li = document.createElement('li'); li.className = 'row'; li.setAttribute('aria-hidden', 'true');
      li.innerHTML = '<span class="c-rank">' + (i + 1) + '</span><span class="c-token"><span class="logo t0">—</span><span class="nm"><strong>—</strong></span></span><span class="c-num c-price" data-label="Price"><span>—</span></span><span class="c-num c-chg" data-label="24h"><span>—</span></span><span class="c-num c-vol" data-label="Volume"><span>—</span></span><span class="c-num c-liq" data-label="Depth"><span>—</span></span><span class="c-act"></span>';
      li.dataset.dash = ''; rowsEl.append(li);
    }
    Object.values(tileEls).forEach(el => { if (!el.querySelector('.fl')) el.textContent = '—'; });
  }

  async function refresh() {
    if (document.hidden) return;
    clearTimeout(timer);
    try {
      const tokens = await load();
      const first = !good.length;
      good = tokens; attempt = 0;
      rowsEl.querySelectorAll('[data-dash]').forEach(r => r.remove());
      errEl.hidden = true;
      setPill('live', 'Live');
      render(first);
      if (first && live) live.textContent = 'Market board loaded';
      timer = setTimeout(refresh, POLL_MS);
    } catch (err) {
      if (err?.name === 'AbortError' && document.hidden) return;
      attempt += 1;
      errEl.hidden = false;
      errEl.textContent = good.length ? 'Source unreachable. Showing the last good board and retrying with growing gaps.' : 'Source unreachable. Dashes stand in until it answers; retrying with growing gaps.';
      setPill(good.length ? 'retry' : 'down', good.length ? 'Retrying' : 'Feed down');
      if (!good.length) showDashes();
      timer = setTimeout(refresh, backoffDelay(attempt));
    }
  }

  // ---------- tabs ----------
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      sortKey = tab.dataset.sort;
      tabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      if (good.length) render(false);
    });
    tab.addEventListener('keydown', e => {
      const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!n) return;
      const next = tabs[(i + n + tabs.length) % tabs.length]; next.focus(); next.click(); e.preventDefault();
    });
  });

  // ---------- lifecycle: pause while hidden, fetch right away on visible ----------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); ctrl?.abort(); }
    else { attempt = 0; refresh(); }
  });
  setPill('idle', 'Warming up');
  if (!document.hidden) refresh();
  started = true;
  return { started };
}
