// Damped spring solver (semi-implicit Euler, fixed 1/240s substeps).
// Tuned so a 24px reveal settles in about 0.9s, matching the reference's 0.9s ease.
export const SPRING = { k: 34, c: 9.6, m: 1 };

const STEP = 1 / 240;
const EPS_X = 0.0005, EPS_V = 0.002;

// Pure simulation of x going 0 -> 1. Returns settle time (within 1%) and peak overshoot.
export function simulate({ k, c, m } = SPRING) {
  let x = 0, v = 0, t = 0, peak = 0, settled = null;
  for (let i = 0; i < 240 * 6; i++) {
    const a = (-k * (x - 1) - c * v) / m;
    v += a * STEP; x += v * STEP; t += STEP;
    if (x > peak) peak = x;
    if (settled === null && Math.abs(x - 1) < 0.01 && Math.abs(v) < 0.05) settled = t;
    if (settled !== null && Math.abs(x - 1) >= 0.01) settled = null;
  }
  return { settle: settled, overshoot: Math.max(0, peak - 1), zeta: c / (2 * Math.sqrt(k * m)) };
}

const active = new Set();
let raf = 0, last = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  for (const s of [...active]) {
    let acc = dt;
    while (acc > 0) {
      const h = Math.min(STEP, acc);
      const a = (-s.k * (s.x - s.to) - s.c * s.v) / s.m;
      s.v += a * h; s.x += s.v * h; acc -= h;
    }
    const done = Math.abs(s.x - s.to) < EPS_X && Math.abs(s.v) < EPS_V;
    if (done) { s.x = s.to; active.delete(s); s.set(s.x, true); if (s.resolve) s.resolve(); }
    else s.set(s.x, false);
  }
  raf = active.size ? requestAnimationFrame(frame) : 0;
}

// Animate a scalar from -> to. `set(value, done)` is called every frame.
export function spring(set, from, to, opts = {}) {
  const s = { x: from, v: opts.velocity || 0, to, set, k: opts.k || SPRING.k, c: opts.c || SPRING.c, m: opts.m || SPRING.m };
  const p = new Promise(r => { s.resolve = r; });
  const start = () => { active.add(s); set(from, false); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  if (opts.delay) setTimeout(start, opts.delay); else start();
  return p;
}
