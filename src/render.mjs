// Pure renderer: renderPage(register, assets) -> html string. No clock, no network, no dates.
import { publicView, deriveHandle, hostOf } from './lib/register.mjs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ico = {
  // official X mark
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  // official GitHub Octicon mark-github
  gh: '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg>'
};

export function renderPage(register, assets = {}) {
  const R = publicView(register);
  const css = assets.css || 'app.css', js = assets.js || 'app.js';
  const chain = R.chain.state === 'stated' ? R.chain.value : null;
  const domainUrl = R.domain.state === 'stated' ? R.domain.url : '';
  const ca = R.ca;

  // ---- record renderers (all state-dependent output lives here) ----
  const social = (id, icon) => {
    const r = R[id];
    if (r.state === 'stated') {
      const handle = deriveHandle(r.url);
      return `<a class="icon-btn" data-record="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)} ${esc(handle)}">${icon}</a>`;
    }
    return `<span class="icon-btn is-inert" data-record="${id}" data-state="${r.state}" role="img" aria-label="${esc(r.label)}, pending">${icon}</span>`;
  };

  const caBar = ca.state === 'stated'
    ? `<div class="ca-bar" data-record="ca" data-state="stated"><span class="ca-label">${esc(ca.label)}</span>
        <button class="ca-slot ca-copy" type="button" data-copy="${esc(ca.value)}" aria-label="Copy contract"><code class="ca-addr">${esc(ca.value)}</code><span class="ca-action"><span class="ico-copy">${ico.copy}</span><span class="ico-done">${ico.check}</span><span class="ca-hint" data-hint>Copy</span></span></button></div>`
    : `<div class="ca-bar" data-record="ca" data-state="${ca.state}"><span class="ca-label">${esc(ca.label)}</span>
        <div class="ca-slot is-inert" aria-disabled="true"><span class="ca-ghost" aria-hidden="true"></span><span class="ca-pending">pending</span></div></div>`;

  const pendingChip = '<span class="chip-pending">pending</span>';
  const factValue = r => {
    if (r.state !== 'stated') return pendingChip;
    if (r.kind === 'address') return `<code class="fact-code">${esc(r.value)}</code>`;
    if (r.kind === 'url') {
      const h = r.id === 'x' || r.id === 'github' ? deriveHandle(r.url) : hostOf(r.url);
      return r.id === 'x' || r.id === 'github'
        ? `<a class="text-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(h)}</a>`
        : `<code class="fact-code">${esc(h)}</code>`;
    }
    return esc(r.value);
  };
  const fact = r => `<div data-record="${r.id}" data-state="${r.state}"><dt>${esc(r.label)}</dt><dd>${factValue(r)}</dd></div>`;

  const caInline = ca.state === 'stated'
    ? `<div class="caption-ca"><code>${esc(ca.value)}</code><button class="copy" type="button" data-copy="${esc(ca.value)}" aria-label="Copy contract"><span data-hint>Copy</span></button></div>`
    : `<div class="caption-ca"><span class="chip-pending">Contract pending</span></div>`;

  const contractCard = ca.state === 'stated'
    ? `<code class="token-addr">${esc(ca.value)}</code>
       <p class="supply" data-supply hidden></p>
       <div class="token-links"><button class="copy" type="button" data-copy="${esc(ca.value)}" aria-label="Copy contract"><span data-hint>Copy</span></button>
       <a class="button" href="https://solscan.io/token/${esc(ca.value)}" target="_blank" rel="noopener noreferrer">Open explorer</a></div>`
    : `<p>Nothing is filed yet. This card wakes the moment a record lands, bringing copy plus explorer links.</p>
       <div class="token-links">${pendingChip}</div>`;

  const rpcRow = R.rpc.state === 'stated' ? `<code class="fact-code">${esc(hostOf(R.rpc.url))}</code>` : pendingChip;

  const snippetRpc = R.rpc.state === 'stated'
    ? `curl -s ${R.rpc.url} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTokenSupply","params":["&lt;contract&gt;"]}'`
    : null;
  const snippetMarket = R.market.state === 'stated' ? `curl -s ${R.market.url}` : null;
  const codeBlock = (txt, label) => txt
    ? `<div class="code verify-code"><pre>${txt}</pre><button class="copy" type="button" data-copy="${esc(txt.replace(/&lt;/g, '<').replace(/&gt;/g, '>'))}" aria-label="Copy ${esc(label)} command"><span data-hint>Copy</span></button></div>`
    : `<div class="code verify-code is-inert"><pre>${pendingChip}</pre></div>`;

  const nav = [['flow', 'Flow'], ['market', 'Tape'], ['register', 'Register'], ['path', 'Path'], ['faq', 'FAQ']];
  const links = nav.map(([id, t]) => `<a href="#${id}" data-nav="${id}">${t}</a>`).join('');
  const menuLinks = nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('');

  const faq = [
    ['So what exactly is Flooq?', 'Flooq is Solana-native, wearing one ribbon folded over itself. This site works as its notice board: live tape, register of filed facts, brief path ahead.'],
    ['Where does our contract live?', 'Not filed yet. The strip fixed above reserves its place, then morphs into single-tap copy control once a record exists. Nothing else here will ever impersonate it.'],
    ['Why do the two social icons look switched off?', 'Neither handle got filed, so the icons refuse to point at guesses. Each wakes and links out separately when its link arrives.'],
    ['Does the board care about our contract?', 'Never. It follows public market data alone and keeps running whether our contract is pending or posted.'],
    ['Whose numbers feed the board?', 'An open Solana price service that ranks boosted tokens and returns their trading pairs. Calls originate client-side, rest while the tab is hidden, and space out when the service struggles.'],
    ['Is this financial guidance?', 'No. Tokens swing violently and can hit zero. Treat everything here as information, read the register, decide independently.']
  ].map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');

  const phases = [
    ['One', 'Signal', 'Brand, site and register go live. Channels light up once their handles are filed.'],
    ['Two', 'Current', 'Our contract gets announced, then followed along the tape beside rival movers.'],
    ['Three', 'Tide', 'Community drives and tooling shaped around the ribbon, built where everyone can watch.'],
    ['Four', 'Delta', 'The line branches: partners, listings and integrations, each entering the register ahead of any mention here.']
  ].map(([n, t, d], i) => `<li data-reveal data-i="${i}"><span class="phase-n">${n}</span><div><strong>${t}</strong><p>${d}</p></div></li>`).join('');

  const beats = [
    ['Part one · Ribbon anatomy', 'One stroke, four turns.', 'Flooq is traced with one continuous stroke that doubles back four times. No seams. No joins. Nothing pulls apart.'],
    ['Part one · Ribbon anatomy', 'Each turn hands off speed.', 'At every bend the line passes its momentum forward. The silhouette is our pitch: stay in motion, nothing sticks.'],
    ['Part one · Ribbon anatomy', 'Sealed first, open later.', 'The strip pinned above stays sealed while no record exists. Once one lands, every screen opens simultaneously.'],
    ['Part one · Ribbon anatomy', 'Meanwhile, the tape rolls.', 'Further down sits a board following Solana\u2019s busiest names. Public numbers only; our own contract status never touches it.']
  ];
  const captions = beats.map(([e, h, p], i) => `<div class="caption c-${i}"><h3>${esc(h)}</h3><p>${esc(p)}</p>${i === 2 ? caInline : ''}</div>`).join('');

  const skeletonRows = Array.from({ length: 10 }, (_, i) => `<li class="row is-skeleton" data-skeleton aria-hidden="true"><span class="sk sk-rank"></span><span class="sk sk-logo"></span><span class="sk sk-name"></span><span class="sk sk-cell"></span><span class="sk sk-cell"></span><span class="sk sk-cell"></span><span class="sk sk-cell"></span><span class="sk sk-btn"></span></li>`).join('');
  const tiles = [['vol', 'Combined volume'], ['liq', 'Combined depth'], ['up', 'Gaining'], ['cnt', 'Tokens shown']]
    .map(([k, t], i) => `<div class="tile" data-spot data-reveal data-i="${i}"><span class="tile-label">${t}</span><strong class="tile-value" data-tile="${k}"><span class="sk sk-tile"></span></strong></div>`).join('');

  const dots = Array.from({ length: 22 }, (_, i) => `<i data-dot="${i}"></i>`).join('');
  const bars = Array.from({ length: 14 }, (_, i) => `<i data-bar="${i}"></i>`).join('');

  const og = domainUrl ? `${domainUrl.replace(/\/$/, '')}/img/og.jpg` : '/img/og.jpg';
  const registerJson = JSON.stringify(R).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src https://api.dexscreener.com${R.rpc.state === 'stated' ? ' ' + new URL(R.rpc.url).origin : ''}; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Flooq | one ribbon, no seams</title>
<meta name="description" content="Flooq folds one unbroken ribbon across Solana: a live market tape, a register of filed facts, and no feature lights up ahead of reality.">
<meta name="theme-color" content="${esc(assets.bg || '')}">
<meta property="og:type" content="website">
<meta property="og:title" content="Flooq | one ribbon, no seams">
<meta property="og:description" content="Live Solana tape plus a register of filed facts. Built by the Floq.">
<meta property="og:image" content="${esc(og)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/img/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/mona-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/${css}">
<noscript><link rel="stylesheet" href="/assets/noscript.css"></noscript>
</head>
<body>
<a class="skip" href="#main">Jump to main</a>
<div class="progress" aria-hidden="true"><span></span></div>

<header class="head" data-head>
  <div class="nav" data-nav-root>
    <a class="brand" href="#top" aria-label="Flooq home"><img class="mark" src="/img/mark-64.webp" width="30" height="30" alt=""><span>FLOOQ</span></a>
    <nav class="nav-links" aria-label="Sections">${links}</nav>
    <div class="nav-actions">
      ${social('x', ico.x)}
      ${social('github', ico.gh)}
      <button class="nav-menu-button" type="button" aria-expanded="false" aria-controls="menu" aria-label="Menu" data-menu-button>${ico.menu}</button>
    </div>
    <div class="nav-menu" id="menu" hidden>${menuLinks}</div>
  </div>
  ${caBar}
</header>
<div class="visually-hidden" role="status" aria-live="polite" data-live></div>

<main id="main">
  <section class="qh" id="top" data-hero aria-labelledby="hero-title">
    <div class="qh-stage">
      <div class="mesh" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i></div>
      <div class="dust" aria-hidden="true" data-depth="0.5">${dots}</div>
      <div class="qh-object" aria-hidden="true">
        <span class="halo" data-depth="0.25"></span>
        <img class="hero-mark" data-depth="1" src="/img/mark-640.webp" width="640" height="640" alt="" fetchpriority="high">
      </div>
      <div class="qh-copy">
        <span class="pill" data-pill data-state="idle"><i class="live-dot"></i><span data-pill-text>Warming up</span></span>
        <h1 class="qh-title" id="hero-title" data-words>Fold the flow.</h1>
        <p class="qh-lead">Flooq folds one lone ribbon through the Solana crowd. Study the tape, read the register, trust only filed facts.</p>
        <div class="actions qh-actions"><a class="button button-light" href="#market">See the tape</a><a class="button button-ghost" href="#register">Read the register</a></div>
      </div>
    </div>
  </section>

  <div class="ticker" aria-label="Live market ticker" data-ticker>
    <div class="ticker-track" data-ticker-track><span class="tick is-skeleton"><i class="sk sk-tick"></i></span><span class="tick is-skeleton"><i class="sk sk-tick"></i></span><span class="tick is-skeleton"><i class="sk sk-tick"></i></span><span class="tick is-skeleton"><i class="sk sk-tick"></i></span></div>
  </div>

  <section class="scene scene-flow" id="flow" data-scene data-beats="4" data-beat="0" aria-label="Ribbon walkthrough">
    <div class="scene-stage">
      <div class="scene-copy">
        <p class="eyebrow">${esc(beats[0][0])}</p>
        <div class="captions">${captions}</div>
        <div class="scene-progress"></div>
      </div>
      <div class="scene-visual" aria-hidden="true">
        <div class="layer v-line"><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span><img src="/img/mark-320.webp" width="320" height="320" alt=""></div>
        <div class="layer v-fold"><img class="ghost" src="/img/mark-640.webp" width="640" height="640" alt=""><img class="sweep" src="/img/mark-640.webp" width="640" height="640" alt=""></div>
        <div class="layer v-doors" data-ca-state="${ca.state}">
          <div class="door door-sealed" data-gate="sealed"><strong>Sealed</strong><span>Address pending</span></div>
          <div class="door door-open" data-gate="open"><strong>Open</strong><span>Address stated</span></div>
        </div>
        <div class="layer v-bars"><div class="bars" data-bars>${bars}</div><span class="layer-label">Volume pulse mirrored off the board</span></div>
      </div>
    </div>
  </section>

  <section class="section section-market" id="market" aria-labelledby="market-title">
    <div class="wrap">
      <p class="eyebrow eyebrow-center" data-reveal>Live tape</p>
      <h2 class="title" id="market-title" data-reveal data-i="1">Solana\u2019s loudest tokens, ranked.</h2>
      <p class="subtitle" data-reveal data-i="2">Ten tokens ordered by trading volume across the past day. Price, depth and direction refresh automatically whenever this tab stays visible.</p>
      <div class="tiles">${tiles}</div>
      <div class="board-head" data-reveal>
        <div class="tabs" role="tablist" aria-label="Sort the board">
          <button class="tab" role="tab" aria-selected="true" tabindex="0" data-sort="vol" type="button">By volume</button>
          <button class="tab" role="tab" aria-selected="false" tabindex="-1" data-sort="chg" type="button">By move</button>
          <button class="tab" role="tab" aria-selected="false" tabindex="-1" data-sort="liq" type="button">By depth</button>
        </div>
        <span class="pill pill-inline" data-pill-b data-state="idle"><i class="live-dot"></i><span data-pill-text>Warming up</span></span>
      </div>
      <p class="feed-error" data-feed-error hidden>Feed unreachable. Whatever loaded last stays on screen while retries space themselves out.</p>
      <div class="board" data-board>
        <div class="board-cols" aria-hidden="true"><span>#</span><span>Token</span><span>Price</span><span>Day</span><span>Volume</span><span>Depth</span><span></span></div>
        <ol class="rows" data-rows aria-live="off">${skeletonRows}</ol>
      </div>
    </div>
  </section>

  <section class="section section-register" id="register" aria-labelledby="register-title">
    <div class="wrap open" data-reveal>
      <p class="eyebrow">Register</p>
      <h2 class="title" id="register-title">One record per outside fact.</h2>
      <p class="subtitle">Each record reads stated or pending. Pending ones stay dark, link nowhere and never fake a value.</p>
      <ol class="proof-steps">
        <li><strong>Stated or silent</strong><span>Facts surface only after being filed. Until then a slot carries its label alongside the word pending.</span></li>
        <li><strong>Links follow records</strong><span>Buttons point outward solely when a record stores a link. Handles get derived off the stored link, never typed.</span></li>
        <li><strong>Contract first</strong><span>Whenever a contract lands, compare it here, through any block explorer and across the team's own channels before acting.</span></li>
      </ol>
      <div class="live-card" data-spot>
        <dl class="live-facts">${[R.chain, R.domain, R.rpc, R.ca, R.x, R.github, R.market].map(fact).join('')}</dl>
      </div>
      <div class="prove">
        <article><h3>Read the supply yourself</h3><p>After a contract is stated, query one open node directly.${R.rpc.state === 'stated' ? ' ' : ' The node record is pending.'}</p>${codeBlock(snippetRpc, 'supply')}</article>
        <article><h3>Read the board yourself</h3><p>The tape sits one public request away.</p>${codeBlock(snippetMarket, 'board')}</article>
      </div>
    </div>
  </section>

  <section class="section section-tint" id="path" aria-labelledby="path-title">
    <div class="wrap">
      <p class="eyebrow eyebrow-center" data-reveal>Path ahead</p>
      <h2 class="title" id="path-title" data-reveal data-i="1">Four stretches, in order.</h2>
      <p class="subtitle" data-reveal data-i="2">Sequence rather than calendar. Each stretch begins once its predecessor wraps.</p>
      <ol class="moments">${phases}</ol>
    </div>
  </section>

  <section class="section section-cards" aria-label="Contract and network">
    <div class="token-grid">
      <article class="token-card" data-spot data-reveal data-record="ca" data-state="${ca.state}"><img src="/img/mark-128.webp" width="96" height="96" alt=""><h3>Contract</h3>${contractCard}</article>
      <article class="token-card" data-spot data-reveal data-i="1"><img src="/img/mark-128.webp" width="96" height="96" alt=""><h3>Network</h3><p>${chain ? esc(chain) + ' is home. Reads travel via an open node.' : 'The chain record is pending.'}</p><div class="token-links">${chain ? `<code class="fact-code">${esc(chain)}</code>` : pendingChip}${rpcRow}</div></article>
    </div>
  </section>

  <section class="section" id="faq" aria-labelledby="faq-title">
    <div class="wrap faq">
      <h2 class="title" id="faq-title" data-reveal>Plain answers.</h2>
      <div data-reveal data-i="1">${faq}</div>
    </div>
  </section>

  <section class="section section-final" aria-label="Closing">
    <div class="wrap final" data-reveal>
      <img class="mark" src="/img/mark-320.webp" width="160" height="160" alt="">
      <h2>Keep the line unbroken.</h2>
      <div class="actions"><a class="button" href="#market">Jump back to tape</a><a class="button button-quiet" href="#top">Return to top</a></div>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="wrap footer-inner">
    <a class="brand" href="#top"><img class="mark" src="/img/mark-64.webp" width="26" height="26" alt=""><span>FLOOQ</span></a>
    <nav aria-label="Footer">${links}</nav>
    <span>${domainUrl ? esc(hostOf(domainUrl)) : pendingChip}${chain ? ' · ' + esc(chain) : ''}</span>
  </div>
</footer>

<script type="application/json" id="register-data">${registerJson}</script>
<script src="/assets/${js}" defer></script>
</body>
</html>
`;
}
