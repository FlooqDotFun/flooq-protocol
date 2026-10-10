// Measures the built site at 360/390/430/1366/1440 in a real Chromium (Edge) via playwright-core.
// usage: node tools/measure.mjs [outDirForScreenshots] [baseUrl]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const shots = process.argv[2] || null;
const base = process.argv[3] || 'http://localhost:4173/';
const sizes = [[360, 800], [390, 844], [430, 932], [1366, 768], [1440, 900]];
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const results = [];
let failures = 0;

for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: w < 800 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  // let the live board answer (or fail) before measuring rows
  await page.waitForFunction(() => document.querySelector('[data-rows] .row:not(.is-skeleton)'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
    const out = {};
    out.viewport = [innerWidth, innerHeight];
    out.overflowX = document.documentElement.scrollWidth - innerWidth;
    const ca = document.querySelector('.ca-bar'), slot = document.querySelector('.ca-slot'), pend = document.querySelector('.ca-pending');
    out.ca = { bar: rect(ca), slot: rect(slot), fontPx: parseFloat(getComputedStyle(pend || document.querySelector('.ca-addr')).fontSize), inViewportTop: rect(ca).y >= 0 && rect(ca).y < 120 };
    out.social = ['x', 'github'].map(id => { const el = document.querySelector(`.nav-actions [data-record="${id}"]`); return el ? { id, tag: el.tagName, href: el.getAttribute('href'), visible: vis(el), ...rect(el), text: el.textContent.trim() } : { id, missing: true }; });
    out.menuButtonVisible = vis(document.querySelector('[data-menu-button]'));
    out.headHeight = rect(document.querySelector('[data-head]')).h;
    // tap targets: every visible interactive control
    const small = [];
    document.querySelectorAll('a[href], button, summary, [role="tab"]').forEach(el => {
      if (!vis(el) || el.classList.contains('skip')) return;
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.bottom < 0) return;
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push({ el: el.tagName + '.' + (el.className || '').toString().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    });
    out.smallTargets = small;
    out.interactiveCount = document.querySelectorAll('a[href], button, summary, [role="tab"]').length;
    out.rows = document.querySelectorAll('[data-rows] .row:not(.is-skeleton):not([data-dash])').length;
    out.skeletons = document.querySelectorAll('[data-skeleton]').length;
    out.rowCopyButtons = [...document.querySelectorAll('[data-row-copy]')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }).slice(0, 3);
    out.pill = document.querySelector('[data-pill]')?.dataset.state;
    out.tiles = [...document.querySelectorAll('[data-tile]')].map(t => t.textContent.trim());
    out.fontLoaded = document.fonts.check('16px "Mona Sans"');
    out.h1 = { text: document.querySelector('h1').getAttribute('aria-label'), fontPx: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize), fits: document.querySelector('h1').getBoundingClientRect().right <= innerWidth };
    out.tickerItems = document.querySelectorAll('.tick:not(.is-skeleton)').length;
    out.chUnitsInCss = [...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => /\d(\.\d+)?ch\b/.test(r.cssText)).length;
    return out;
  });

  // scene beats by scrolling through the pinned scene
  const beats = await page.evaluate(async () => {
    const s = document.querySelector('[data-scene]'); const seen = [];
    const top = s.getBoundingClientRect().top + scrollY, span = s.offsetHeight - innerHeight;
    for (const f of [0.05, 0.3, 0.55, 0.8]) { scrollTo({ top: top + span * f, behavior: 'instant' }); await new Promise(r => setTimeout(r, 450)); seen.push(s.dataset.beat); }
    return seen;
  });
  m.sceneBeats = beats;
  if (shots) {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, `${w}-hero.png`) });
    for (const [name, sel] of [['market', '#market'], ['register', '#register'], ['path', '#path'], ['faq', '#faq']]) {
      await page.evaluate(s => { const t = document.querySelector(s); scrollTo({ top: t.getBoundingClientRect().top + scrollY - 150, behavior: 'instant' }); }, sel);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(shots, `${w}-${name}.png`) });
    }
    await page.evaluate(() => { const s = document.querySelector('[data-scene]'); const top = s.getBoundingClientRect().top + scrollY; scrollTo({ top: top + (s.offsetHeight - innerHeight) * 0.55, behavior: 'instant' }); });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(shots, `${w}-scene.png`) });
  }
  m.pageErrors = errors.filter(e => !/Failed to load resource|net::ERR/.test(e));

  const problems = [];
  if (m.overflowX > 0) problems.push('horizontal overflow ' + m.overflowX);
  if (!m.ca.inViewportTop) problems.push('CA strip not at top');
  for (const s of m.social) if (s.missing || !s.visible || s.w < 44 || s.h < 44 || s.right > w) problems.push('social ' + s.id + ' bad');
  if (m.smallTargets.length) problems.push('tap targets under 44: ' + JSON.stringify(m.smallTargets.slice(0, 6)));
  if (m.chUnitsInCss) problems.push('ch units in css');
  if (!m.h1.fits) problems.push('h1 overflows');
  if (m.pageErrors.length) problems.push('page errors ' + JSON.stringify(m.pageErrors.slice(0, 3)));
  m.problems = problems; failures += problems.length;
  results.push(m);
  await ctx.close();
}

// reduced motion: nothing may animate, everything must be visible
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    runningAnimations: document.getAnimations().filter(a => a.playState === 'running').length,
    hiddenReveals: [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity !== '1').length,
    heroTitleOpacity: getComputedStyle(document.querySelector('h1')).opacity,
    sceneHeight: Math.round(document.querySelector('[data-scene]').getBoundingClientRect().height),
    viewport: innerHeight
  }));
  results.push({ reducedMotion: r });
  if (r.runningAnimations || r.hiddenReveals || r.heroTitleOpacity !== '1') failures++;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log('MEASURE FAILURES:', failures);
process.exit(failures ? 1 : 0);
