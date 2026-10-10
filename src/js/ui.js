// Page motion: scroll scenes, spring reveals, hero parallax, head state, spotlight.
import { spring } from './spring.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = v => Math.min(1, Math.max(0, v));
const root = document.documentElement;

export function initUi() {
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  const head = document.querySelector('[data-head]');
  const progress = document.querySelector('.progress span');
  const hero = document.querySelector('[data-hero]');
  const navLinks = [...document.querySelectorAll('.nav-links a[data-nav]')];
  const sections = navLinks.map(a => document.getElementById(a.dataset.nav)).filter(Boolean);

  // measured head height keeps every sticky stage clear of the nav + contract strip
  const setHead = () => root.style.setProperty('--head-h', Math.round(head.getBoundingClientRect().height) + 'px');
  new ResizeObserver(setHead).observe(head); setHead();

  // ---------- reveals: same trigger line as the reference (top < 90% of the viewport), spring instead of a fixed ease ----------
  const pending = new Set(reveals);
  reveals.forEach(el => { if (!reduced) el.style.transform = 'translateY(24px)'; else { el.style.opacity = '1'; } });
  const run = el => {
    pending.delete(el);
    if (reduced) { el.style.opacity = '1'; el.style.transform = ''; el.classList.add('is-in'); return; }
    const i = Number(el.dataset.i || 0);
    spring((p, done) => {
      el.style.opacity = String(clamp01(p * 1.15));
      // the spring tail past 0.5% is under a tenth of a pixel; land visible there instead of waiting for the solver's strict rest
      const landed = done || Math.abs(1 - p) < 0.005;
      el.style.transform = landed ? '' : `translateY(${((1 - p) * 24).toFixed(2)}px)`;
      if (landed) { el.style.opacity = '1'; el.classList.add('is-in'); }
    }, 0, 1, { delay: i * 120 });
  };

  // ---------- scroll loop ----------
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY, vh = innerHeight, doc = root.scrollHeight - vh;
    progress.parentElement.style.setProperty('--sp', doc > 0 ? (y / doc).toFixed(4) : '0');
    head.classList.toggle('is-solid', y > 8);
    for (const s of scenes) {
      const { top, height } = s.getBoundingClientRect();
      const n = Number(s.dataset.beats || 1);
      const p = reduced ? 1 : clamp01(-top / Math.max(1, height - vh));
      const b = Math.min(n - 1, Math.floor(p * n));
      s.style.setProperty('--p', p.toFixed(4));
      s.style.setProperty('--bp', clamp01(p * n - b).toFixed(4));
      if (s.dataset.beat !== String(b)) s.dataset.beat = String(b);
    }
    if (hero && !reduced) {
      const { top, height } = hero.getBoundingClientRect();
      hero.style.setProperty('--hero', clamp01(-top / Math.max(1, height - vh)).toFixed(4));
    }
    for (const el of pending) if (el.getBoundingClientRect().top < vh * 0.9) run(el);
    // active nav link
    let current = null;
    for (const s of sections) if (s.getBoundingClientRect().top <= vh * 0.35) current = s.id;
    navLinks.forEach(a => a.setAttribute('aria-current', String(a.dataset.nav === current)));
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();

  // ---------- hero: words, dust, pointer parallax ----------
  if (hero) {
    const h1 = hero.querySelector('[data-words]');
    const copy = hero.querySelector('.qh-copy');
    if (h1) {
      const words = h1.textContent.trim().split(/\s+/);
      h1.setAttribute('aria-label', h1.textContent.trim());
      h1.textContent = '';
      words.forEach((w, i) => {
        const s = document.createElement('span'); s.className = 'qh-word'; s.setAttribute('aria-hidden', 'true'); s.textContent = w; s.style.setProperty('--i', String(i));
        h1.append(s); if (i < words.length - 1) h1.append(' ');
      });
      const go = () => { h1.classList.add('is-ready'); copy.classList.add('is-in'); };
      if (reduced) go(); else Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 900))]).then(() => requestAnimationFrame(go));
    }
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    hero.querySelectorAll('[data-dot]').forEach(d => {
      d.style.setProperty('--x', (rnd() * 100).toFixed(1) + '%'); d.style.setProperty('--y', (rnd() * 100).toFixed(1) + '%');
      d.style.setProperty('--s', (2 + rnd() * 4).toFixed(1) + 'px'); d.style.setProperty('--t', (4 + rnd() * 6).toFixed(1) + 's'); d.style.setProperty('--dl', (-rnd() * 8).toFixed(1) + 's');
    });
    hero.querySelectorAll('[data-depth]').forEach(el => el.style.setProperty('--depth', el.dataset.depth));
    if (!reduced && matchMedia('(pointer: fine)').matches) {
      let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
      const loop = () => {
        cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
        hero.style.setProperty('--mx', cx.toFixed(4)); hero.style.setProperty('--my', cy.toFixed(4));
        raf = (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) ? requestAnimationFrame(loop) : 0;
      };
      addEventListener('pointermove', e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; if (!raf) raf = requestAnimationFrame(loop); }, { passive: true });
    }
  }

  // ---------- spotlight ----------
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.('[data-spot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--sx', e.clientX - r.left + 'px'); el.style.setProperty('--sy', e.clientY - r.top + 'px');
  }, { passive: true });

  // ---------- menu ----------
  const mb = document.querySelector('[data-menu-button]'), menu = document.getElementById('menu');
  if (mb && menu) {
    const set = open => { mb.setAttribute('aria-expanded', String(open)); menu.hidden = !open; };
    mb.addEventListener('click', () => set(menu.hidden));
    menu.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
    matchMedia('(width > 860px)').addEventListener('change', () => set(false));
  }
}
