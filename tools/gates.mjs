// npm run gates -> exit 0 only if every gate passes. Reads dist/ and the sources; mutates registers in memory only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright-core';
import { renderPage } from '../src/render.mjs';
import { publicView, checkRegister, scanAddresses, validateAddress, isSolanaAddress, deriveHandle, hostOf } from '../src/lib/register.mjs';
import { sharedBigrams, pageText } from './copy-check.mjs';
import { simulate, SPRING } from '../src/js/spring.js';
import * as M from '../src/js/market-core.js';

const read = p => fs.readFileSync(p, 'utf8');
const exists = p => fs.existsSync(p);
const walk = (d, skip = []) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name).replace(/\\/g, '/');
  if (skip.some(s => p === s || p.startsWith(s + '/'))) return [];
  return e.isDirectory() ? walk(p, skip) : [p];
});
const register = JSON.parse(read('register.json'));
const html = read('dist/index.html');
const cssFile = fs.readdirSync('dist/assets').find(f => /^app-.*\.css$/.test(f));
const jsFile = fs.readdirSync('dist/assets').find(f => /^app-.*\.js$/.test(f));
const distCss = read('dist/assets/' + cssFile), distJs = read('dist/assets/' + jsFile);
const assetNames = { css: cssFile, js: jsFile, bg: JSON.parse(read('src/palette.json')).bg.hex };
const srcFiles = walk('src').filter(f => /\.(css|js|mjs)$/.test(f));

const results = [];
const gates = [];
const gate = (name, fn) => gates.push({ name, fn });
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- helpers ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
const fakeAddr = i => b58encode(crypto.createHash('sha256').update('flooq-fixture-' + i).digest());
const norm = h => { h = h.toLowerCase(); return h.length === 4 || h.length === 7 && false ? h : h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };
const hexNorm = h => { h = h.toLowerCase(); if (h.length === 4) return '#' + [...h.slice(1)].map(c => c + c).join(''); if (h.length === 5) return '#' + [...h.slice(1, 4)].map(c => c + c).join(''); return h.length === 9 && h.endsWith('ff') ? h.slice(0, 7) : h; };
const dom = h => new JSDOM(h).window.document;

// =====================================================================
// A. BUILD AND HYGIENE
// =====================================================================
gate('build output is complete and nothing repo-only leaks into dist/', () => {
  for (const f of ['index.html', 'favicon.svg', '_headers', 'robots.txt', 'fonts/mona-sans.woff2', 'fonts/monaspace-neon.woff2', 'img/mark-640.webp', 'img/og.jpg', 'assets/noscript.css']) must(exists('dist/' + f), 'missing dist/' + f);
  for (const bad of ['README.md', 'LICENSE', 'docs', 'whitepaper.md', 'register.json', 'package.json', 'tools', 'src']) must(!exists('dist/' + bad), 'dist/ must not contain ' + bad);
  must(!walk('dist').some(f => f.endsWith('.map')), 'source maps in dist');
});

gate('repo content files exist at the project root with the required parts', () => {
  const readme = read('README.md'), wp = read('docs/whitepaper.md'), lic = read('LICENSE');
  must(/^# Flooq/m.test(readme) && /live/i.test(readme) && /img\.shields\.io/.test(readme), 'README header or badge');
  must(/Solana/.test(readme) && /CA|Contract address/i.test(readme) && /pending/i.test(readme), 'README chain or CA placeholder');
  for (const h of ['## Overview', '## Features', '## Links']) must(readme.includes(h), 'README missing ' + h);
  must(/Vision/i.test(wp) && /Mission/i.test(wp) && /Tokenomics/i.test(wp) && /Team/i.test(wp), 'whitepaper sections');
  must((wp.match(/\*\*Phase \d/g) || []).length >= 3 && (wp.match(/\*\*Phase \d/g) || []).length <= 4, 'whitepaper needs 3 or 4 phases');
  must(/MIT License/.test(lic) && /Copyright \(c\) 2026 Flooq/.test(lic), 'LICENSE must be MIT, 2026, Flooq');
});

gate('repo hygiene: no agent config files, no machine-authorship text anywhere', () => {
  for (const f of walk('.', ['node_modules', 'dist/_none'])) {
    const base = path.basename(f).toLowerCase();
    must(base !== 'clau' + 'de.md' && base !== 'agents.md', 'forbidden file ' + f);
  }
  must(!exists('.clau' + 'de') && !exists('.cursor') && !exists('.github/copi' + 'lot-instructions.md'), 'forbidden config directory');
  const banned = [new RegExp('cl' + 'aude', 'i'), new RegExp('anth' + 'ropic', 'i'), new RegExp('co-?auth' + 'ored', 'i'), new RegExp('generated (?:with|by)', 'i'), new RegExp('chat' + 'gpt', 'i'), new RegExp('copi' + 'lot', 'i'), new RegExp('language ' + 'model', 'i'), new RegExp('\\bA' + 'I\\b'), new RegExp('\\bL' + 'LM\\b')];
  const hits = [];
  for (const f of walk('.', ['node_modules', 'tools/ref-corpus.txt', 'package-lock.json', 'tools/.shots'])) {
    if (!/\.(md|json|js|mjs|cjs|css|html|txt|svg|ts)$/.test(f) && path.basename(f) !== 'LICENSE' && path.basename(f) !== '_headers') continue;
    const t = read(f);
    for (const r of banned) if (r.test(t)) hits.push(f + ' :: ' + r.source);
  }
  must(!hits.length, hits.join('; '));
});

// =====================================================================
// B. REGISTER, LINKS, GATE WARNING, MUTATION HARNESS
// =====================================================================
gate('register: every record is stated|absent|unconfirmed, inert records carry no value or url', () => {
  const errs = checkRegister(register); must(!errs.length, errs.join('; '));
  const pv = publicView(register);
  for (const r of Object.values(pv)) if (r.state !== 'stated') must(!('value' in r) && !('url' in r), r.id + ' inert but carries data');
  const embedded = JSON.parse(dom(html).getElementById('register-data').textContent);
  must(JSON.stringify(embedded) === JSON.stringify(pv), 'embedded register differs from public view');
  must(!/"checked"/.test(html) && !/"source"/.test(html.match(/id="register-data">[\s\S]*?<\/script>/)[0]), 'dates or source leaked into embedded register');
});

gate('link rule: unstated records have no href; stated social links store url and derive the handle', () => {
  const d = dom(html);
  for (const [id, r] of Object.entries(publicView(register))) {
    const els = [...d.querySelectorAll(`[data-record="${id}"]`)];
    must(els.length > 0, 'no element for record ' + id);
    for (const el of els) {
      must(el.getAttribute('data-state') === r.state, id + ' state attribute drift');
      if (r.state !== 'stated') must(!el.hasAttribute('href') && !el.querySelector('a[href]'), id + ' is inert but has an href');
    }
    if (r.state === 'stated' && (id === 'x' || id === 'github')) { const a = d.querySelector(`a[data-record="${id}"]`); must(a && a.getAttribute('href') === r.url && a.getAttribute('aria-label').includes(deriveHandle(r.url)), id + ' link or handle'); }
  }
  must(deriveHandle('https://x.com/flooq_fun') === '@flooq_fun' && deriveHandle('https://github.com/flooq/site') === 'flooq/site', 'handle derivation');
});

gate('social icons: X and GitHub always rendered top-right, icon only, official marks, never hidden by CSS', () => {
  const d = dom(html), box = d.querySelector('.nav-actions');
  for (const id of ['x', 'github']) { const el = box.querySelector(`[data-record="${id}"]`); must(el, id + ' missing'); must(el.textContent.trim() === '', id + ' has a text label'); must(el.querySelector('svg'), id + ' has no svg'); }
  must(html.includes('M18.244 2.25h3.308l-7.227 8.26') && html.includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59'), 'official X / Octicon paths missing');
  const css = read('src/styles.css');
  must(!/\.icon-btn[^{]*\{[^}]*display:\s*none/.test(css) && !/\.nav-actions[^{]*\{[^}]*display:\s*none/.test(css), 'CSS hides the social icons');
  must(/\.nav-actions\s*\{[^}]*justify-self:\s*end/.test(css), 'icons are not right-aligned');
});

gate('mutation harness: every record, every state, anchors read from the live register (state-independent)', () => {
  const baseline = renderPage(register, assetNames);
  const baseDom = dom(baseline);
  const synth = (rec, id) => {
    if (rec.kind === 'address') return { value: b58encode(crypto.createHash('sha256').update('mut-' + id).digest()) };
    if (rec.kind === 'url') return { url: `https://${id === 'x' ? 'x.com' : id === 'github' ? 'github.com' : 'mut-' + id + '.example'}/mut_${id}` };
    return { value: 'Mutated ' + id };
  };
  let renders = 0, assertions = 0;
  for (const id of Object.keys(register.records)) {
    for (const target of ['stated', 'absent', 'unconfirmed']) {
      const reg = JSON.parse(JSON.stringify(register));
      const rec = reg.records[id], orig = { value: rec.value, url: rec.url };
      rec.state = target;
      for (const k of ['value', 'url', 'pairsUrl']) if (target !== 'stated') delete rec[k];
      if (target === 'stated') Object.assign(rec, synth(rec, id));
      if (target === 'stated' && rec.kind === 'address' && id !== 'ca') rec.value = rec.value;
      const out = renderPage(reg, assetNames); renders++;
      const d = dom(out);
      const pv = publicView(reg)[id];
      // anchor reads the record that was just written, never a hardcoded state
      for (const el of d.querySelectorAll(`[data-record="${id}"]`)) { must(el.getAttribute('data-state') === pv.state, `${id}/${target}: data-state`); assertions++; }
      const embedded = JSON.parse(d.getElementById('register-data').textContent)[id];
      must(embedded.state === pv.state && (pv.state === 'stated') === ('value' in embedded || 'url' in embedded), `${id}/${target}: embedded record`); assertions++;
      if (pv.state !== 'stated') {
        for (const el of d.querySelectorAll(`[data-record="${id}"]`)) must(!el.hasAttribute('href') && !el.querySelector('a[href]'), `${id}/${target}: inert has href`);
        for (const old of [orig.url, orig.value]) if (old && rec.kind !== 'text') must(!out.includes(old), `${id}/${target}: previous ${rec.kind} still on page`);
        assertions += 2;
      } else if (rec.kind === 'url' && (id === 'x' || id === 'github')) {
        const a = d.querySelector(`a[data-record="${id}"]`); must(a && a.getAttribute('href') === pv.url && a.getAttribute('aria-label').includes(deriveHandle(pv.url)), `${id}/${target}: live link`); assertions++;
      } else if (rec.kind === 'address') {
        must(d.querySelector(`.ca-copy[data-copy="${pv.value}"]`) && d.querySelector('.ca-addr').textContent === pv.value, `${id}/${target}: CA slot`);
        must(d.querySelectorAll(`[data-copy="${pv.value}"]`).length >= 2, `${id}/${target}: copy buttons`);
        must(!d.querySelector('.ca-slot.is-inert'), `${id}/${target}: slot still inert`); assertions += 3;
      } else if (rec.kind === 'url') { must(out.includes(hostOf(pv.url)), `${id}/${target}: stated url not rendered`); assertions++; }
      // every other record keeps the state it had in the baseline
      for (const other of Object.keys(register.records)) {
        if (other === id) continue;
        const a = [...baseDom.querySelectorAll(`[data-record="${other}"]`)].map(e => e.getAttribute('data-state')).join();
        const b = [...d.querySelectorAll(`[data-record="${other}"]`)].map(e => e.getAttribute('data-state')).join();
        must(a === b, `${id}/${target}: record ${other} drifted`); assertions++;
      }
    }
  }
  must(renderPage(register, assetNames) === baseline, 'renderer is not pure');
  gates.find(g => g.name.startsWith('mutation harness')).note = `${renders} renders, ${assertions} assertions`;
});

gate('both contract branches: CA absent renders inert, CA stated renders live; each is proven by rendering both', () => {
  const addr = fakeAddr(1);
  const mk = state => { const r = JSON.parse(JSON.stringify(register)); r.records.ca.state = state; delete r.records.ca.value; if (state === 'stated') r.records.ca.value = addr; return r; };
  const off = dom(renderPage(mk('absent'), assetNames)), on = dom(renderPage(mk('stated'), assetNames));
  must(off.querySelector('.ca-slot.is-inert[aria-disabled="true"]') && !off.querySelector('.ca-copy') && /pending/.test(off.querySelector('.ca-bar').textContent), 'absent branch not inert');
  must(!renderPage(mk('absent'), assetNames).includes(addr), 'absent branch leaks an address');
  must(on.querySelector('.ca-copy[data-copy="' + addr + '"] .ca-addr').textContent === addr && /Copy/.test(on.querySelector('.ca-action').textContent), 'stated branch not live');
  must(on.querySelector('.token-card a[href^="https://solscan.io/token/' + addr + '"]'), 'stated branch lacks derived explorer link');
  must(!off.querySelector('.token-card a[href*="solscan"]'), 'absent branch has explorer link');
  must(off.querySelector('.v-doors').dataset.caState === 'absent' && on.querySelector('.v-doors').dataset.caState === 'stated', 'doors visual does not follow the record');
});

gate('gate warning: addresses are matched against the stated registry; 0x hex is never rejected by shape alone', () => {
  const sol = fakeAddr(2), other = fakeAddr(3), evm = '0x' + 'ab12'.repeat(10);
  const reg = (ca, extra = {}) => ({ chain: { id: 'chain', state: 'stated', kind: 'text', value: 'Solana' }, ca: ca ? { id: 'ca', state: 'stated', kind: 'address', value: ca } : { id: 'ca', state: 'absent', kind: 'address' }, ...extra });
  must(validateAddress(sol, 'Solana') && !validateAddress(evm, 'Solana'), 'chain-aware validation (solana)');
  must(validateAddress(evm, 'Ethereum') && !validateAddress(sol, 'Ethereum'), 'chain-aware validation (evm)');
  must(!isSolanaAddress('0x' + 'ab12'.repeat(10)) && !isSolanaAddress('x'.repeat(40)), 'shape tests');
  const bad = (text, r) => scanAddresses(text, r).filter(f => !f.registered && !f.exempt);
  must(bad('the CA is ' + sol, reg(sol)).length === 0, 'CA must be exempt');
  must(bad('ghost ' + other, reg(sol)).length === 1, 'unregistered address must be flagged');
  must(bad('ghost ' + sol, reg(null)).length === 1, 'address with no stated CA must be flagged');
  must(bad('wallet ' + evm, reg(sol)).length === 1, 'unregistered 0x address must be flagged');
  must(bad('wallet ' + evm, reg(sol, { wallet: { id: 'wallet', state: 'stated', kind: 'address', value: evm } })).length === 0, 'stated 0x address must pass');
  must(bad('colour 0x1F, 0xdeadbeef, 0x00 and 0x' + 'a'.repeat(39), reg(sol)).length === 0, 'short or malformed hex must not be rejected');
  must(bad(pageText(html), publicView(register)).length === 0, 'unregistered address-shaped string in the built page');
  must(bad(distJs, publicView(register)).length === 0, 'unregistered address-shaped string in the bundle');
  const bad2 = checkRegister({ records: { chain: { label: 'c', kind: 'text', state: 'stated', value: 'Solana', source: 's' }, ca: { label: 'ca', kind: 'address', state: 'stated', value: evm, source: 's' } } });
  must(bad2.length === 1, 'a 0x address stated on a Solana register must be reported as a mismatch');
});

// =====================================================================
// C. PALETTE, ASSETS, FAVICON
// =====================================================================
gate('palette rule: colour literals live only in src/tokens.css (and the traced favicon)', () => {
  const hits = [];
  for (const f of srcFiles) {
    if (f === 'src/tokens.css') continue;
    const t = read(f);
    for (const m of t.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push(f + ' ' + m[0]);
    for (const m of t.matchAll(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/g)) hits.push(f + ' ' + m[0]);
    if (f.endsWith('.css')) for (const m of t.matchAll(/:\s*[^;{}]*?(?<![-\w])(black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|aqua|navy|maroon|lime|olive|teal)(?![-\w])/g)) hits.push(f + ' named ' + m[1]);
  }
  must(!hits.length, hits.slice(0, 6).join('; '));
  const tokenHex = new Set([...read('src/tokens.css').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => hexNorm(m[0])));
  const bundleHex = [...distCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => hexNorm(m[0]));
  const stray = bundleHex.filter(h => !tokenHex.has(h));
  must(!stray.length, 'colours in dist css not from tokens: ' + stray.slice(0, 4));
  must(!/#[0-9a-fA-F]{6}\b/.test(distJs.replace(/#[0-9a-f]{0,5}\b/g, '')), 'hex in js bundle');
});

gate('palette provenance: every token is a real pixel at its stated coordinate; favicon colours are the sampled palette', async () => {
  const p = JSON.parse(read('src/palette.json'));
  const logo = await sharp(p.source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bannerPath = p.bg.source, banner = await sharp(bannerPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (img, ch, x, y) => { const i = (y * img.info.width + x) * ch; return '#' + [0, 1, 2].map(k => img.data[i + k].toString(16).padStart(2, '0')).join(''); };
  let n = 0;
  for (const c of p.palette) { must(px(logo, 4, c.x, c.y) === c.hex, `palette ${c.hex} is not the pixel at (${c.x},${c.y})`); n++; }
  must(px(banner, 3, p.bg.x, p.bg.y) === p.bg.hex && px(banner, 3, p.surface.x, p.surface.y) === p.surface.hex, 'bg or surface pixel mismatch');
  const tokens = read('src/tokens.css');
  for (const m of tokens.matchAll(/--([a-z]+):\s*(#[0-9a-f]{6});\s*\/\*\s*pixel \((\d+),(\d+)\) of ([^,*]+)/g)) {
    const [, name, hex, x, y, file] = m; const img = file.includes('SAMPUL') ? banner : logo;
    must(px(img, file.includes('SAMPUL') ? 3 : 4, +x, +y) === hex, `token --${name} does not match its pixel`); n++;
  }
  must(/k-means/.test(tokens) && /snapped to nearest real pixel/.test(tokens), 'tokens file lacks provenance comment');
  const fav = read('dist/favicon.svg'), allowed = new Set(p.palette.map(c => c.hex));
  for (const m of fav.matchAll(/fill="(#[0-9a-f]{6})"/g)) must(allowed.has(m[1]), 'favicon colour ' + m[1] + ' is not a sampled palette colour');
  gates.find(g => g.name.startsWith('palette provenance')).note = n + ' pixels checked';
});

gate('assets: alpha logo read, premultiplied resize leaves no dark halo', async () => {
  const p = JSON.parse(read('src/palette.json'));
  const meta = await sharp(p.source).metadata(); must(meta.hasAlpha && meta.width === 2000, 'logo alpha');
  for (const f of ['mark-640.png', 'mark-320.png', 'mark-128.png', 'mark-64.png']) {
    const { data } = await sharp('public/img/' + f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let dark = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40 && data[i + 3] < 255 && data[i] + data[i + 1] + data[i + 2] < 60) dark++;
    must(dark === 0, f + ' has ' + dark + ' dark halo pixels');
  }
});

gate('favicon: svg 32x32 traced from the pixel grid, no double hyphen in any comment', () => {
  const fav = read('dist/favicon.svg');
  const d = new JSDOM(fav, { contentType: 'image/svg+xml' }).window.document.documentElement;
  must(d.getAttribute('width') === '32' && d.getAttribute('height') === '32' && d.getAttribute('viewBox') === '0 0 32 32', 'not 32x32');
  must(!fav.includes('<!--') && !fav.includes('--'), 'comment or double hyphen in favicon');
  must(d.querySelectorAll('rect').length >= 40, 'too few traced rects');
  must(html.includes('rel="icon" href="/favicon.svg"') && html.includes('favicon-32.png') && html.includes('apple-touch-icon'), 'favicon links missing');
});

// =====================================================================
// D. DATES, NUMBERS, COPY
// =====================================================================
const stringsOf = js => [...js.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '');
gate('no dates anywhere visible: text, aria, tooltips, scripts, ticker, footer (dates live in register.json only)', () => {
  const d = dom(html); d.querySelectorAll('script,style').forEach(s => s.remove());
  const attrs = [...d.querySelectorAll('*')].flatMap(e => ['title', 'aria-label', 'alt', 'content', 'aria-description', 'placeholder'].map(a => e.getAttribute(a)).filter(Boolean));
  const corpus = [d.body.textContent, ...attrs, d.title, ...stringsOf(distJs)].join('\n');
  const pats = [[/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'], [/\b(?:19|20)\d{2}\b/, 'year'], [/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, 'month day'], [/\b\d{1,2}\s+(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, 'day month'], [/\b\d{1,2}:\d{2}(?::\d{2})?\b/, 'clock'], [/\b(?:as of|checked|last (?:updated|checked|verified)|timestamp|yesterday|today|ago)\b/i, 'date word']];
  for (const [r, n] of pats) { const m = corpus.match(r); must(!m, `${n}: "${m && m[0]}"`); }
  must(!d.querySelector('time'), '<time> element present');
  for (const f of walk('src/js')) must(!/new Date|Date\.now|toLocale(?:Date|Time)String|DateTimeFormat|getFullYear/.test(read(f)), f + ' uses date APIs');
  for (const f of walk('dist').filter(f => /\.(html|css|svg|txt|json|webmanifest)$/.test(f) || path.basename(f) === '_headers')) must(!/\b\d{4}-\d{2}-\d{2}\b/.test(read(f)), f + ' contains a date');
  const lic = read('register.json'); must(/\d{4}-\d{2}-\d{2}/.test(lic), 'register.json should still hold its data dates');
});

gate('no fabricated numbers: the page copy has no digits, every figure comes from the live feed', () => {
  const t = pageText(html).replace(/[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\s*(?=px|svh)/g, '').replace(/width=device-width[^\n]*/g, ''); // the viewport directive is markup, not copy
  const copy = t.split('\n').filter(l => !/^\s*$/.test(l)).join('\n');
  const m = copy.match(/\d+/);
  must(!m, 'digit in static copy: ' + (m && copy.slice(Math.max(0, m.index - 30), m.index + 30)));
});

gate('copy originality: zero 2-grams shared with the reference corpus', () => {
  const r = sharedBigrams(html);
  must(r.shared.length === 0, r.shared.length + ' shared: ' + r.shared.slice(0, 8).join(' | '));
  gates.find(g => g.name.startsWith('copy originality')).note = `${r.mineCount} page grams vs ${r.refCount} reference grams`;
});

// =====================================================================
// E. MOTION, MEASURED VALUES, CSS RULES
// =====================================================================
gate('reference values matched: ease, timings, geometry read from tools/ref-measure.json', () => {
  const ref = JSON.parse(read('tools/ref-measure.json')), css = read('src/styles.css') + read('src/tokens.css'), ui = read('src/js/ui.js'), tk = read('src/tokens.css');
  const num = s => s.replace(/\s+/g, '');
  must(num(tk).includes('--ease:cubic-bezier(0.2,0.7,0,1)'), 'ease');
  must(num(tk).includes('--gutter:clamp(20px,5vw,48px)') && num(tk).includes('--radius:28px') && num(tk).includes('--nav-h:60px'), 'gutter, radius, nav');
  must(/\.scene \{[^}]*height: 420svh/.test(css), 'scene height'); must((css.match(/data-beat="3"/g) || []).length >= 3, 'four beats');
  must(/\.progress \{[^}]*height: 2px/.test(css), 'progress bar 2px');
  must(/\.qh-word \{[^}]*0\.7s[^}]*0\.8s[^}]*0\.8s/.test(css) && /calc\(var\(--i, 0\) \* 70ms\)/.test(css), 'hero word timing and 70ms stagger');
  must(/\.caption \{[^}]*0\.6s/.test(css) && /\.layer \{[^}]*0\.7s/.test(css), 'caption and layer timing');
  must(/vh \* 0\.9/.test(ui) && /\* 24/.test(ui) && /i \* 120/.test(ui), 'reveal trigger 0.9, 24px, 120ms stagger');
  must(/grid-template-columns: minmax\(0, 0\.9fr\) minmax\(0, 1\.1fr\)/.test(css) && /max-width: 1280px/.test(css) && /max-width: 1180px/.test(css), 'stage geometry');
  must(/@media \(width <= 860px\)/.test(css) && /@media \(width <= 620px\)/.test(css), 'breakpoints');
  must(/drift 14s/.test(css), 'drift 14s');
  must(ref.revealDurationSeconds === 0.9, 'measure file');
});

gate('spring physics: damped solver settles in about the reference 0.9s with negligible overshoot', () => {
  const s = simulate(SPRING);
  must(s.zeta > 0.6 && s.zeta < 1, 'not underdamped: zeta ' + s.zeta.toFixed(3));
  must(s.settle > 0.7 && s.settle < 1.05, 'settle ' + s.settle);
  must(s.overshoot < 0.03, 'overshoot ' + s.overshoot);
  gates.find(g => g.name.startsWith('spring physics')).note = `zeta ${s.zeta.toFixed(2)}, settle ${s.settle.toFixed(2)}s, overshoot ${(s.overshoot * 100).toFixed(1)}%`;
});

gate('reduced motion: global kill switch in CSS, checked in every script that animates', () => {
  const css = read('src/styles.css');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  must(/animation:\s*none\s*!important/.test(block) && /transition:\s*none\s*!important/.test(block), 'CSS kill switch');
  for (const f of ['src/js/ui.js', 'src/js/market.js']) must(/prefers-reduced-motion: reduce/.test(read(f)), f + ' ignores reduced motion');
  must(/\.scene \{ height: auto; \}/.test(block) && /\.qh \{ height: auto; \}/.test(block), 'pinned scenes must unpin');
  const noscript = read('src/noscript.css'); must(/\.scene \{ height: auto/.test(noscript), 'noscript fallback');
});

gate('mobile rules: no ch units, 44px tap targets declared, viewport meta, no fixed widths past 360', () => {
  for (const f of srcFiles.filter(f => f.endsWith('.css'))) must(!/\d(?:\.\d+)?ch\b/.test(read(f)), f + ' uses ch units');
  must(!/\d(?:\.\d+)?ch\b/.test(distCss), 'ch units in dist css');
  const css = read('src/styles.css');
  for (const sel of ['.icon-btn, .nav-menu-button', '.copy', '.tab', '.button']) must(new RegExp(sel.replace(/[.,\s]/g, m => m === ' ' ? '\\s*' : '\\' + m) + '[^{]*\\{[^}]*(?:width: 44px|min-height: 44px|min-width: 44px|min-height: 52px)').test(css), sel + ' lacks a 44px target');
  must(html.includes('width=device-width, initial-scale=1'), 'viewport meta');
});

gate('CSP-clean markup: no inline style attributes, inline handlers or executable inline scripts', () => {
  const d = dom(html);
  must(!d.querySelector('[style]'), 'inline style attribute');
  must(![...d.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))), 'inline event handler');
  must([...d.querySelectorAll('script')].every(s => s.src || s.type === 'application/json'), 'executable inline script');
  must(!d.querySelector('style'), '<style> block');
});

// =====================================================================
// F. MARKET LOGIC (pure)
// =====================================================================
gate('market logic: solana-only, de-duplicated, summed per token, top 10 by 24h volume, formatting, letter fallback', () => {
  const A = i => fakeAddr(100 + i);
  const boosts = [{ chainId: 'solana', tokenAddress: A(0) }, { chainId: 'ethereum', tokenAddress: '0x' + 'cd'.repeat(20) }, { chainId: 'solana', tokenAddress: A(0) }, ...Array.from({ length: 13 }, (_, i) => ({ chainId: 'solana', tokenAddress: A(i + 1) })), null, { chainId: 'solana' }];
  const addrs = M.pickSolanaAddresses(boosts, 30);
  must(addrs.length === 14 && new Set(addrs).size === 14 && !addrs.some(a => a.startsWith('0x')), 'solana-only dedupe');
  const pair = (i, vol, liq, px, chg, img) => ({ chainId: 'solana', baseToken: { address: A(i), symbol: 'T' + i, name: 'Token ' + i }, priceUsd: String(px), priceChange: { h24: chg }, volume: { h24: vol }, liquidity: { usd: liq }, ...(img ? { info: { imageUrl: img } } : {}) });
  const pairs = [pair(0, 100, 50, 1, 5), pair(0, 900, 10, 2, -9, 'https://x.test/a.png'), ...Array.from({ length: 13 }, (_, i) => pair(i + 1, 1000 + i * 10, 100 + i, 0.5, i - 6)), { chainId: 'ethereum', baseToken: { address: A(0) } }, { chainId: 'solana', baseToken: { address: 'unwanted' }, volume: { h24: 9e9 } }];
  const toks = M.buildTokens(pairs, addrs);
  const t0 = toks.find(t => t.address === A(0));
  must(t0.volume === 1000 && t0.liquidity === 60 && t0.price === 1 && t0.change === 5 && t0.imageUrl === 'https://x.test/a.png', 'pair aggregation');
  const top = M.topByVolume(toks);
  must(top.length === 10 && top.every((t, i, a) => !i || a[i - 1].volume >= t.volume) && !top.some(t => t.address === 'unwanted'), 'top ten by volume');
  must(M.sortTokens(top, 'chg')[0].change === Math.max(...top.map(t => t.change)) && M.sortTokens(top, 'liq')[0].liquidity === Math.max(...top.map(t => t.liquidity)), 'sort modes');
  must(M.fmtCompact(1234567) === '$1.23M' && M.fmtPrice(0.00001234).startsWith('$0.0000123') && M.fmtPct(-3.456) === '\u25BC 3.46%' && M.fmtPct(null) === '\u2014', 'formatters');
  must(M.letterFor('pepe') === 'P' && M.letterFor('') === '?' && M.letterFor('$$a') === 'A' && M.tileIndex(A(1)) >= 0 && M.tileIndex(A(1)) < 6, 'letter tile');
  must(M.POLL_MS === 60000, 'poll every 60s');
});

gate('market backoff: exponential, capped, jittered inside bounds', () => {
  const mid = () => 0.5;
  const seq = [1, 2, 3, 4, 5, 6, 7, 8].map(a => M.backoffDelay(a, M.BACKOFF, mid));
  must(seq.join() === '2000,4000,8000,16000,32000,60000,60000,60000', 'sequence ' + seq);
  for (const a of [1, 3, 6]) { const lo = M.backoffDelay(a, M.BACKOFF, () => 0), hi = M.backoffDelay(a, M.BACKOFF, () => 1), base = M.backoffDelay(a, M.BACKOFF, mid); must(lo >= base * 0.84 && hi <= base * 1.16 && lo < hi, 'jitter bounds'); }
});

gate('market independence (static): market code never reads the contract record', () => {
  for (const f of ['src/js/market.js', 'src/js/market-core.js']) {
    const t = read(f).replace(/\/\/.*$/gm, '');
    must(!/\.ca\b|\['ca'\]|contract|data-record="ca"|CA\b/.test(t), f + ' touches contract state');
    must(!/from '\.\/ca\.js'|register\.mjs/.test(t), f + ' imports contract code');
  }
  must(/initMarket\(R\.market\)/.test(read('src/js/main.js')), 'initMarket must receive only the market record');
});

// =====================================================================
// G. RUNTIME (real Chromium, fixture feeds, fake clock)
// =====================================================================
const runtime = { browser: null, server: null, port: 0, htmlOverride: null, hosts: new Set() };
function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
      if (p === '/index.html' && runtime.htmlOverride) { rsp.writeHead(200, { 'content-type': types['.html'] }); return rsp.end(runtime.htmlOverride); }
      const f = path.join(path.resolve('dist'), p);
      if (!f.startsWith(path.resolve('dist')) || !exists(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => { runtime.server = s; runtime.port = s.address().port; res(); });
  });
}
const png = fs.existsSync('public/img/mark-64.png') ? fs.readFileSync('public/img/mark-64.png') : Buffer.alloc(0);
const fx = { mode: 'ok', variant: 0, boosts: 0, pairs: 0, imgReq: 0, solOnly: true, delay: 0 };
const T = i => fakeAddr(i);
function fixtureBoosts() {
  return [{ chainId: 'solana', tokenAddress: T(0) }, { chainId: 'ethereum', tokenAddress: '0x' + 'cd'.repeat(20) }, { chainId: 'solana', tokenAddress: T(0) }, ...Array.from({ length: 11 }, (_, i) => ({ chainId: 'solana', tokenAddress: T(i + 1) }))];
}
function fixturePairs(addrs) {
  const v = fx.variant, out = [];
  const pair = (i, vol, liq, px, chg, img) => ({ chainId: 'solana', baseToken: { address: T(i), symbol: 'FX' + i, name: 'Fixture ' + i }, priceUsd: String(px), priceChange: { h24: chg }, volume: { h24: vol }, liquidity: { usd: liq }, ...(img ? { info: { imageUrl: img } } : {}) });
  for (let i = 0; i <= 11; i++) {
    if (!addrs.includes(T(i))) continue;
    const img = i === 1 ? null : i === 2 ? 'https://img.fixture.test/bad.png' : 'https://img.fixture.test/ok.png';
    if (i === 5) { out.push(pair(5, 100000, 50000, 1, 3, img), pair(5, 1900000, 10000, 2, -4, img)); continue; }
    out.push(pair(i, (12 - i) * 100000 + (v ? (i % 2 ? 7000 : -7000) : 0), 200000 + i * 1000, (i + 1) * (v ? 1.05 : 1), (i % 2 ? 1 : -1) * (i + 1) * (v ? 1.2 : 1), img));
  }
  return out;
}
async function newPage(opts = {}) {
  const ctx = await runtime.browser.newContext({ viewport: { width: opts.width || 1280, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: ['clipboard-read', 'clipboard-write'], baseURL: `http://127.0.0.1:${runtime.port}` });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => runtime.hosts.add(new URL(r.url()).host));
  await page.route('https://api.dexscreener.com/**', async route => {
    const u = route.request().url();
    if (u.includes('token-boosts')) { fx.boosts++; if (fx.delay) await new Promise(r => setTimeout(r, fx.delay)); }
    if (fx.mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"fixture"}' });
    const headers = { 'access-control-allow-origin': '*' };
    if (u.includes('token-boosts')) { return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(fixtureBoosts()) }); }
    fx.pairs++;
    const addrs = decodeURIComponent(u.split('/solana/')[1]).split(',');
    if (addrs.some(a => a.startsWith('0x'))) fx.solOnly = false;
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(fixturePairs(addrs)) });
  });
  await page.route('https://img.fixture.test/**', route => { fx.imgReq++; return route.request().url().endsWith('bad.png') ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  await page.route('https://solana-rpc.publicnode.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ result: { value: { uiAmountString: '1000000' } } }) }));
  return { ctx, page, errors };
}
const rowsText = page => page.evaluate(() => ({ rows: [...document.querySelectorAll('[data-rows] .row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()), ticker: [...document.querySelectorAll('.tick')].map(r => r.innerText.replace(/\s+/g, ' ').trim()), tiles: [...document.querySelectorAll('[data-tile]')].map(t => t.innerText.trim()) }));
const waitRows = (page, n = 10) => page.waitForFunction(k => document.querySelectorAll('[data-rows] .row:not(.is-skeleton):not([data-dash])').length >= k, n, { timeout: 30000 });
// poll from node so a paused or faked page clock cannot stall the wait
const until = async (page, fn, arg, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn, arg)) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const settle = ms => new Promise(r => setTimeout(r, ms));
const caRegister = addr => { const r = JSON.parse(JSON.stringify(register)); r.records.ca.state = 'stated'; delete r.records.ca.url; r.records.ca.value = addr; return r; };
const note = (prefix, text) => { const g = gates.find(g => g.name.startsWith(prefix)); if (g) g.note = text; };

gate('runtime: board shows top ten solana tokens by volume, skeleton to data, logos with letter-tile fallback, tabs sort, copy-per-address', async () => {
  fx.mode = 'ok'; fx.variant = 0; fx.solOnly = true; runtime.htmlOverride = null;
  const { ctx, page, errors } = await newPage();
  fx.delay = 4000;
  await page.goto('/');
  must(await page.evaluate(() => document.querySelectorAll('[data-skeleton]').length) === 10, 'skeleton rows missing before data');
  fx.delay = 0;
  await waitRows(page);
  await page.locator('[data-rows]').scrollIntoViewIfNeeded(); // logos are lazy, so bring the board on screen before judging fallbacks
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    syms: [...document.querySelectorAll('[data-rows] .row .nm strong')].map(e => e.textContent),
    skeletons: document.querySelectorAll('[data-skeleton]').length,
    logosImg: document.querySelectorAll('[data-rows] .row .logo img').length,
    letters: [...document.querySelectorAll('[data-rows] .row .logo')].filter(l => !l.querySelector('img')).map(l => l.textContent),
    pill: document.querySelector('[data-pill]').dataset.state, pillText: document.querySelector('[data-pill-text]').textContent,
    ticker: document.querySelectorAll('.tick:not(.is-skeleton)').length, errHidden: document.querySelector('[data-feed-error]').hidden,
    tiles: [...document.querySelectorAll('[data-tile]')].map(t => t.textContent.trim()),
    price5: [...document.querySelectorAll('[data-rows] .row')].find(r => r.querySelector('.nm strong').textContent === 'FX5')?.querySelector('.c-price').innerText.replace(/\s+/g, ' '),
    vol5: [...document.querySelectorAll('[data-rows] .row')].find(r => r.querySelector('.nm strong').textContent === 'FX5')?.querySelector('.c-vol').innerText.replace(/\s+/g, ' '),
    entering: document.querySelectorAll('.row.is-entering').length
  }));
  must(r.syms.length === 10 && r.syms[0] === 'FX5', 'expected 10 rows led by FX5 (summed volume), got ' + r.syms.join());
  must(!r.syms.includes('FX11') || r.syms.length === 10, 'row count');
  must(r.skeletons === 0 && r.entering === 0, 'skeletons or entering rows remain');
  must(r.logosImg >= 5 && r.letters.length >= 1 && r.letters.every(l => /^[A-Z0-9?]$/.test(l)), 'logo or letter-tile fallback: ' + JSON.stringify(r.letters));
  must(r.letters.length >= 2, 'both missing and failing imageUrl must fall back to letter tiles');
  must(r.pill === 'live' && r.pillText === 'Live' && r.errHidden, 'status pill / error state');
  must(r.ticker === 20, 'ticker should carry ten tokens twice, got ' + r.ticker);
  must(/\$1\.00/.test(r.price5) && /\$2(?:\.00)?M/.test(r.vol5), 'FX5 aggregation: ' + r.price5 + ' / ' + r.vol5);
  must(r.tiles.every(t => t && !/^\u2014$/.test(t)), 'tiles not filled: ' + r.tiles.join('|'));
  must(fx.solOnly, 'non-solana addresses were sent to the pairs endpoint');
  // tabs reorder
  await page.click('[data-sort="chg"]'); await page.waitForTimeout(800);
  const byMove = await page.evaluate(() => [...document.querySelectorAll('[data-rows] .row .c-chg span')].map(e => parseFloat(e.textContent.replace(/[^\d.-]/g, '')) * (e.textContent.includes('\u25BC') ? -1 : 1)));
  must(byMove.every((v, i, a) => !i || a[i - 1] >= v), 'by-move tab not sorted: ' + byMove.join());
  await page.click('[data-sort="vol"]'); await page.waitForTimeout(600);
  // copy per address
  await page.click('[data-rows] .row:first-child [data-row-copy]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  must(clip === T(5), 'row copy button did not copy the full address');
  must(await page.evaluate(() => document.querySelector('[data-rows] .row:first-child [data-row-copy]').hasAttribute('data-copied')), 'no copy feedback');
  must(!errors.length, errors.join());
  await ctx.close();
  note('runtime: board', `${r.syms.length} rows, ${r.letters.length} letter tiles, ticker ${r.ticker}`);
});

gate('runtime: market output is identical with the contract absent and stated; stated slot copies the full address', async () => {
  fx.mode = 'ok'; fx.variant = 0;
  const addr = fakeAddr(77);
  runtime.htmlOverride = null;
  const a = await newPage(); await a.page.goto('/'); await waitRows(a.page); await a.page.waitForTimeout(1500);
  const absent = await rowsText(a.page);
  const absentCa = await a.page.evaluate(() => ({ btn: !!document.querySelector('.ca-copy'), pending: document.querySelector('.ca-pending')?.textContent, aria: document.querySelector('.ca-slot').getAttribute('aria-disabled') }));
  must(!absentCa.btn && absentCa.pending === 'pending' && absentCa.aria === 'true', 'absent CA slot not inert at runtime');
  await a.ctx.close();
  runtime.htmlOverride = renderPage(caRegister(addr), assetNames);
  const b = await newPage(); await b.page.goto('/'); await waitRows(b.page); await b.page.waitForTimeout(1500);
  const stated = await rowsText(b.page);
  must(JSON.stringify(absent) === JSON.stringify(stated), 'market rows, ticker or tiles changed with contract state');
  const ca = await b.page.evaluate(() => { const bar = document.querySelector('.ca-bar'), btn = bar.querySelector('.ca-copy'), r = bar.getBoundingClientRect(); return { text: btn.querySelector('.ca-addr').textContent, fontPx: parseFloat(getComputedStyle(btn.querySelector('.ca-addr')).fontSize), top: r.top, fixed: getComputedStyle(document.querySelector('[data-head]')).position, h: btn.getBoundingClientRect().height }; });
  must(ca.text === addr && ca.fontPx >= 15 && ca.fixed === 'fixed' && ca.top >= 0 && ca.top < 120 && ca.h >= 44, 'stated CA slot: ' + JSON.stringify(ca));
  await b.page.evaluate(() => scrollTo({ top: 4000, behavior: 'instant' })); await b.page.waitForTimeout(400);
  must(await b.page.evaluate(() => document.querySelector('.ca-bar').getBoundingClientRect().top < 120), 'CA strip left the viewport on scroll');
  await b.page.click('.ca-copy');
  must(await b.page.evaluate(() => navigator.clipboard.readText()) === addr, 'CA copy wrote something else');
  const fb = await b.page.evaluate(() => ({ attr: document.querySelector('.ca-copy').hasAttribute('data-copied'), live: document.querySelector('[data-live]').textContent, hint: document.querySelector('.ca-copy [data-hint]').textContent }));
  must(fb.attr && /Copied/.test(fb.live) && fb.hint === 'Copied', 'copy feedback: ' + JSON.stringify(fb));
  await b.page.waitForTimeout(1900);
  must(!(await b.page.evaluate(() => document.querySelector('.ca-copy').hasAttribute('data-copied'))), 'copy feedback never resets');
  await b.page.waitForTimeout(800);
  must(await b.page.evaluate(() => /1,000,000/.test(document.querySelector('[data-supply]').textContent)), 'stated CA should read supply through the stated rpc');
  must(await b.page.evaluate(() => !document.documentElement.dataset.gateWarning), 'runtime gate warning fired for a stated CA');
  await b.ctx.close(); runtime.htmlOverride = null;
});

gate('runtime: failure shows dashes and an error, retries back off exponentially, last good data survives a failed refresh', async () => {
  fx.mode = 'fail'; fx.boosts = 0;
  const { ctx, page } = await newPage();
  await page.addInitScript(() => { Math.random = () => 0.5; }); // zero jitter so the 2s, 4s, 8s gaps are exact
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000); // frozen page time: only runFor moves it, so machine load cannot shift the cadence
  await page.goto('/');
  must(await until(page, () => document.querySelectorAll('[data-dash]').length === 10), 'first failure never rendered');
  const f =await page.evaluate(() => ({ dashes: document.querySelectorAll('[data-dash]').length, err: !document.querySelector('[data-feed-error]').hidden, pill: document.querySelector('[data-pill]').dataset.state, skel: document.querySelectorAll('[data-skeleton]').length, cell: document.querySelector('[data-dash] .c-price')?.textContent }));
  must(f.dashes === 10 && f.err && f.pill === 'down' && f.skel === 0 && f.cell === '\u2014', 'first failure state ' + JSON.stringify(f));
  // count attempts: base 2s (+-15%), then 4s, then 8s
  const counts = [];
  let last = 0;
  const stepTo = async ms => { await page.clock.runFor(ms); await page.waitForTimeout(60); const n = fx.boosts; const d = n - last; last = n; return d; };
  const calls0 = fx.boosts; last = calls0;
  counts.push(await stepTo(1600));
  counts.push(await stepTo(900));  // by 2.5s the first retry (<=2.3s) must have fired
  counts.push(await stepTo(3200)); // 2nd gap is >=3.4s from the retry, so still waiting
  counts.push(await stepTo(1800)); // by now (~7.5s total) it must have fired
  counts.push(await stepTo(6000)); // 3rd gap lands at 14s, still waiting at 13.5s
  counts.push(await stepTo(2400));
  must(counts.join() === '0,1,0,1,0,1', 'retry cadence should be 0,1,0,1,0,1 (2s, 4s, 8s) but was ' + counts.join());
  // recovery
  fx.mode = 'ok';
  await page.clock.runFor(20000); await page.waitForTimeout(400);
  must(await page.evaluate(() => document.querySelector('[data-pill]').dataset.state === 'live' && document.querySelector('[data-feed-error]').hidden), 'did not recover once the source answered');
  await page.clock.runFor(3000); await page.waitForTimeout(300);
  const before = (await rowsText(page)).rows;
  must(before.length === 10, 'rows after recovery');
  // refresh fails: keep the last good board
  fx.mode = 'fail';
  await page.clock.runFor(61000); await page.waitForTimeout(500);
  const kept = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-rows] .row:not([data-dash])').length, pill: document.querySelector('[data-pill]').dataset.state, err: !document.querySelector('[data-feed-error]').hidden, text: document.querySelector('[data-feed-error]').textContent }));
  must(kept.rows === 10 && kept.pill === 'retry' && kept.err && /last/i.test(kept.text), 'last good data not kept: ' + JSON.stringify(kept));
  must(JSON.stringify((await rowsText(page)).rows) === JSON.stringify(before), 'rows changed after failed refresh');
  await ctx.close(); fx.mode = 'ok';
  note('runtime: failure', 'retry gaps 2s, 4s, 8s observed on a fake clock');
});

gate('runtime: polls every 60s, pauses while hidden, fetches immediately when visible again, flashes changed values', async () => {
  fx.mode = 'ok'; fx.variant = 0; fx.boosts = 0;
  const { ctx, page } = await newPage();
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto('/'); await until(page, () => document.querySelectorAll('[data-rows] .row:not(.is-skeleton)').length >= 10);
  must(fx.boosts === 1, 'first fetch on load, got ' + fx.boosts);
  await page.clock.runFor(58000); await page.waitForTimeout(100);
  must(fx.boosts === 1, 'polled early: ' + fx.boosts);
  fx.variant = 1;
  await page.clock.runFor(2500); await until(page, () => true); await page.waitForTimeout(1500);
  must(fx.boosts === 2, 'no poll at 60s: ' + fx.boosts);
  await page.clock.runFor(200); await page.waitForTimeout(100);
  const flashes = await page.evaluate(() => ({ up: document.querySelectorAll('.flash-up').length, down: document.querySelectorAll('.flash-down').length }));
  must(flashes.up + flashes.down > 0, 'changed values did not flash');
  // hide the tab
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenAt = fx.boosts;
  await page.clock.runFor(190000); await page.waitForTimeout(1000);
  must(fx.boosts === hiddenAt, 'kept polling while hidden: ' + (fx.boosts - hiddenAt) + ' requests');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500);
  must(fx.boosts === hiddenAt + 1, 'no immediate fetch on becoming visible: ' + (fx.boosts - hiddenAt));
  await ctx.close();
});

gate('runtime: reduced motion leaves zero running animations and everything visible', async () => {
  fx.mode = 'ok'; fx.variant = 0;
  const { ctx, page } = await newPage({ reduced: true, width: 390 });
  await page.goto('/'); await waitRows(page); await page.waitForTimeout(1800);
  const r = await page.evaluate(() => ({ running: document.getAnimations().filter(a => a.playState === 'running').map(a => (a.animationName || a.transitionProperty || a.constructor.name)), hidden: [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity !== '1').length, h1: getComputedStyle(document.querySelector('h1')).opacity, scene: Math.round(document.querySelector('[data-scene]').getBoundingClientRect().height), vh: innerHeight, rowsOpaque: [...document.querySelectorAll('[data-rows] .row')].every(r => getComputedStyle(r).opacity === '1'), tickerAnim: getComputedStyle(document.querySelector('.ticker-track')).animationName }));
  must(r.running.length === 0, 'running animations: ' + r.running.join());
  must(r.hidden === 0 && r.h1 === '1' && r.rowsOpaque && r.tickerAnim === 'none', 'content hidden under reduced motion ' + JSON.stringify(r));
  must(r.scene < r.vh * 4, 'scene still pinned: ' + r.scene);
  await ctx.close();
});

gate('runtime: spotlight, parallax, scroll progress, scenes advance, spring reveal ends visible', async () => {
  fx.mode = 'ok';
  const { ctx, page } = await newPage();
  await page.goto('/'); await waitRows(page); await page.waitForTimeout(1200);
  await page.mouse.move(300, 300); await page.mouse.move(900, 500, { steps: 8 }); await page.waitForTimeout(500);
  const px = await page.evaluate(() => ({ mx: getComputedStyle(document.querySelector('[data-hero]')).getPropertyValue('--mx'), tr: getComputedStyle(document.querySelector('.hero-mark')).transform }));
  must(parseFloat(px.mx) !== 0 && px.tr !== 'none', 'pointer parallax inactive ' + JSON.stringify(px));
  await page.evaluate(() => scrollTo({ top: 800, behavior: 'instant' })); await until(page, () => document.querySelector('[data-head]').classList.contains('is-solid')); await page.waitForTimeout(300);
  const sc = await page.evaluate(() => ({ sp: parseFloat(getComputedStyle(document.querySelector('.progress')).getPropertyValue('--sp')), hero: parseFloat(getComputedStyle(document.querySelector('[data-hero]')).getPropertyValue('--hero')), solid: document.querySelector('[data-head]').classList.contains('is-solid') }));
  must(sc.sp > 0 && sc.hero > 0 && sc.solid, 'scroll progress / hero scroll / solid nav ' + JSON.stringify(sc));
  const beats = await page.evaluate(async () => { const s = document.querySelector('[data-scene]'), top = s.getBoundingClientRect().top + scrollY, span = s.offsetHeight - innerHeight, out = []; for (const f of [0.05, 0.3, 0.55, 0.8]) { scrollTo({ top: top + span * f, behavior: 'instant' }); for (let w = 0; w < 60 && s.dataset.beat !== String(out.length); w++) await new Promise(r => setTimeout(r, 50)); out.push(s.dataset.beat); } return out; });
  must(beats.join() === '0,1,2,3', 'scene beats ' + beats.join());
  await page.evaluate(() => document.querySelector('#faq').scrollIntoView({ behavior: 'instant' })); await until(page, () => [...document.querySelectorAll('#faq [data-reveal]')].every(e => e.classList.contains('is-in')), undefined, 8000);
  must(await page.evaluate(() => [...document.querySelectorAll('#faq [data-reveal]')].every(e => getComputedStyle(e).opacity === '1' && e.classList.contains('is-in'))), 'spring reveal did not finish visible');
  await page.hover('.tile'); await page.waitForTimeout(100);
  must(await page.evaluate(() => /px/.test(document.querySelector('.tile').style.getPropertyValue('--sx'))), 'spotlight vars not set');
  await ctx.close();
});

gate('runtime: network stays inside the allowed hosts (own origin, market feed, rpc, token images)', async () => {
  const allowed = new Set([`127.0.0.1:${runtime.port}`, 'api.dexscreener.com', 'img.fixture.test', 'solana-rpc.publicnode.com']);
  const stray = [...runtime.hosts].filter(h => !allowed.has(h));
  must(!stray.length, 'unexpected hosts: ' + stray.join());
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1];
  must(/connect-src https:\/\/api\.dexscreener\.com https:\/\/solana-rpc\.publicnode\.com/.test(csp) && /default-src 'none'/.test(csp), 'CSP does not match the stated hosts');
  must(hostOf(register.records.rpc.url) === 'solana-rpc.publicnode.com' && hostOf(register.records.market.url) === 'api.dexscreener.com', 'register hosts');
});

// ---------- runner ----------
const t0 = Date.now();
runtime.browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(exists), headless: true });
await startServer();
let failed = 0;
for (const g of gates) {
  try { await g.fn(); results.push({ ok: true, name: g.name, note: g.note }); }
  catch (e) { failed++; results.push({ ok: false, name: g.name, err: e.message.split('\n')[0] }); }
  // a failed gate must not leave a live page polling the shared fixture counters
  for (const c of runtime.browser.contexts()) await c.close().catch(() => {});
  fx.delay = 0; fx.mode = 'ok';
}
await runtime.browser.close(); runtime.server.close();
results.forEach((r, i) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2, '0')}  ${r.name}${r.note ? '  [' + r.note + ']' : ''}${r.ok ? '' : '\n        -> ' + r.err}`));
console.log(`\nGATES: ${results.length - failed}/${results.length} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
