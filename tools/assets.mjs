// Asset pipeline: palette (k-means snapped to real pixels), premultiplied resize, traced favicon.
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = 'brand/LOGO FLOOQ PNG...png';
const BANNER = 'reference/SAMPUL FLOOQ JPG.jpg.jpeg';
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
fs.mkdirSync('public/img', { recursive: true });

// deterministic PRNG
let seed = 20260;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// bbox of visible pixels, and opaque-pixel list for the palette
let x0 = W, y0 = H, x1 = 0, y1 = 0;
const opaque = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, a = data[i + 3];
  if (a > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (a >= 240) opaque.push(i);
}

// k-means (k-means++ init) on a sample of opaque pixels
const K = 10;
const sample = [];
const step = Math.max(1, Math.floor(opaque.length / 60000));
for (let n = 0; n < opaque.length; n += step) { const i = opaque[n]; sample.push([data[i], data[i + 1], data[i + 2]]); }
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
let cent = [sample[Math.floor(rnd() * sample.length)]];
while (cent.length < K) {
  const ds = sample.map(p => Math.min(...cent.map(c => d2(p, c))));
  const tot = ds.reduce((a, b) => a + b, 0); let r = rnd() * tot, j = 0;
  for (; j < ds.length - 1; j++) { r -= ds[j]; if (r <= 0) break; }
  cent.push(sample[j]);
}
let assign = new Array(sample.length).fill(0);
for (let it = 0; it < 40; it++) {
  assign = sample.map(p => { let b = 0, bd = Infinity; cent.forEach((c, k) => { const d = d2(p, c); if (d < bd) { bd = d; b = k; } }); return b; });
  const sum = cent.map(() => [0, 0, 0, 0]);
  sample.forEach((p, n) => { const s = sum[assign[n]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
  cent = sum.map((s, k) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[k]);
}
const share = cent.map((_, k) => assign.filter(a => a === k).length / sample.length);

// snap each centroid to the nearest REAL pixel coordinate in the asset
const palette = cent.map((c, k) => {
  let best = -1, bd = Infinity;
  for (const i of opaque) { const d = d2([data[i], data[i + 1], data[i + 2]], c); if (d < bd) { bd = d; best = i; } }
  const p = best / 4;
  return { hex: hex(data[best], data[best + 1], data[best + 2]), x: p % W, y: Math.floor(p / W), share: +share[k].toFixed(4) };
}).sort((a, b) => b.share - a.share);

// page background: real pixel from the cover banner corners (modal colour, with its coordinate)
const bn = await sharp(BANNER).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const bw = bn.info.width, counts = new Map();
for (const [cx, cy] of [[0, 0], [bw - 40, 0], [0, bn.info.height - 40], [bw - 40, bn.info.height - 40]])
  for (let y = cy; y < cy + 40; y++) for (let x = cx; x < cx + 40; x++) {
    const i = (y * bw + x) * 3, k = hex(bn.data[i], bn.data[i + 1], bn.data[i + 2]);
    if (!counts.has(k)) counts.set(k, { n: 0, x, y });
    counts.get(k).n++;
  }
const bgTop = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
const bg = { hex: bgTop[0], x: bgTop[1].x, y: bgTop[1].y, source: BANNER };
// raised surface: first real banner pixel with luma 14..20 and near-neutral-violet cast
let surf = null;
for (let y = 0; y < bn.info.height && !surf; y += 3) for (let x = 0; x < bw; x += 3) {
  const i = (y * bw + x) * 3, r = bn.data[i], g = bn.data[i + 1], b = bn.data[i + 2], l = (r + g + b) / 3;
  if (l >= 14 && l <= 20 && Math.abs(r - b) < 14) { surf = { hex: hex(r, g, b), x, y, source: BANNER }; break; }
}
fs.writeFileSync('src/palette.json', JSON.stringify({ method: 'k-means (k=10, kmeans++ init, 40 iters) over alpha>=240 pixels of ' + SRC + ', each centroid snapped to nearest real pixel coordinate', source: SRC, size: [W, H], palette, bg, surface: surf }, null, 1));

// ---- premultiplied resize helper (RGB and alpha resized separately, then un-premultiplied) ----
async function resizePremult(rgba, w, h, ow, oh) {
  // exact-area box filter in premultiplied space; colour is recovered by dividing by coverage
  const out = Buffer.alloc(ow * oh * 4), sx = w / ow, sy = h / oh;
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
    const xa = ox * sx, xb = xa + sx, ya = oy * sy, yb = ya + sy;
    let r = 0, g = 0, bl = 0, al = 0, wt = 0;
    for (let y = Math.floor(ya); y < Math.min(h, Math.ceil(yb)); y++) {
      const wy = Math.min(y + 1, yb) - Math.max(y, ya);
      for (let x = Math.floor(xa); x < Math.min(w, Math.ceil(xb)); x++) {
        const wx = Math.min(x + 1, xb) - Math.max(x, xa), k = wx * wy, i = (y * w + x) * 4, a = rgba[i + 3] / 255;
        r += rgba[i] * a * k; g += rgba[i + 1] * a * k; bl += rgba[i + 2] * a * k; al += a * k; wt += k;
      }
    }
    const o = (oy * ow + ox) * 4;
    if (al > 0) { out[o] = Math.min(255, Math.round(r / al)); out[o + 1] = Math.min(255, Math.round(g / al)); out[o + 2] = Math.min(255, Math.round(bl / al)); }
    out[o + 3] = Math.round(255 * al / wt);
  }
  return out;
}

// crop to a padded square around the mark
const pad = 40, cw = x1 - x0 + 1, ch = y1 - y0 + 1, side = Math.max(cw, ch) + pad * 2;
const sq = Buffer.alloc(side * side * 4);
const ox = Math.floor((side - cw) / 2), oy = Math.floor((side - ch) / 2);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const s = ((y0 + y) * W + (x0 + x)) * 4, d = ((y + oy) * side + (x + ox)) * 4;
  sq[d] = data[s]; sq[d + 1] = data[s + 1]; sq[d + 2] = data[s + 2]; sq[d + 3] = data[s + 3];
}
const outs = {};
for (const s of [640, 320, 128, 64]) {
  const px = await resizePremult(sq, side, side, s, s);
  await sharp(px, { raw: { width: s, height: s, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(`public/img/mark-${s}.webp`);
  await sharp(px, { raw: { width: s, height: s, channels: 4 } }).png({ compressionLevel: 9 }).toFile(`public/img/mark-${s}.png`);
  outs[s] = px;
}
let halo = 0, semi = 0; const t = outs[640];
for (let i = 0; i < t.length; i += 4) if (t[i + 3] > 0 && t[i + 3] < 255) { semi++; if (t[i] + t[i + 1] + t[i + 2] < 60 && t[i + 3] > 40) halo++; }

// ---- favicon: 32x32 grid traced from the real pixel grid, colours snapped to the sampled palette ----
const g = await resizePremult(sq, side, side, 32, 32);
const pal = palette.map(p => ({ ...p, rgb: [parseInt(p.hex.slice(1, 3), 16), parseInt(p.hex.slice(3, 5), 16), parseInt(p.hex.slice(5, 7), 16)] }));
const cells = [];
for (let y = 0; y < 32; y++) {
  const row = [];
  for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    if (g[i + 3] < 128) { row.push(null); continue; }
    let b = pal[0], bd = Infinity;
    for (const p of pal) { const d = d2([g[i], g[i + 1], g[i + 2]], p.rgb); if (d < bd) { bd = d; b = p; } }
    row.push(b.hex);
  }
  cells.push(row);
}
let rects = '';
for (let y = 0; y < 32; y++) {
  let x = 0;
  while (x < 32) {
    const c = cells[y][x];
    if (!c) { x++; continue; }
    let e = x;
    while (e + 1 < 32 && cells[y][e + 1] === c) e++;
    rects += `<rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${c}"/>`;
    x = e + 1;
  }
}
fs.writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects}</svg>\n`);
await sharp(g, { raw: { width: 32, height: 32, channels: 4 } }).png().toFile('public/img/favicon-32.png');
const bgrgb = [parseInt(bg.hex.slice(1, 3), 16), parseInt(bg.hex.slice(3, 5), 16), parseInt(bg.hex.slice(5, 7), 16)];
const m = await sharp('public/img/mark-320.png').resize(140, 140).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 3, background: { r: bgrgb[0], g: bgrgb[1], b: bgrgb[2] } } }).composite([{ input: m, gravity: 'center' }]).png().toFile('public/img/apple-touch-icon.png');
await sharp(BANNER).jpeg({ quality: 88 }).toFile('public/img/og.jpg');

console.log(JSON.stringify({ bbox: [x0, y0, x1, y1], palette, bg, surface: surf, fringe: { semiTransparentPx: semi, darkHaloPx: halo }, faviconRects: (rects.match(/<rect/g) || []).length }, null, 1));
