// Generates src/tokens.css, the only stylesheet allowed to hold colour literals.
import fs from 'node:fs';

export function buildTokens() {
  const p = JSON.parse(fs.readFileSync('src/palette.json', 'utf8'));
  const byHex = Object.fromEntries(p.palette.map(c => [c.hex, c]));
  const names = {
    '#fcb247': 'sun', '#fb6649': 'coral', '#f22a8b': 'rose', '#f531c0': 'magenta', '#dd28f0': 'fuchsia',
    '#a135f1': 'violet', '#e375e8': 'orchid', '#efd8ea': 'mist', '#fdbf9a': 'peach', '#fb7f83': 'salmon'
  };
  const lines = [];
  for (const [h, n] of Object.entries(names)) {
    const c = byHex[h];
    if (!c) throw new Error(`palette drifted: ${h} (${n}) is not a sampled centroid any more; re-map names in tools/tokens.mjs`);
    lines.push(`  --${n}: ${h}; /* pixel (${c.x},${c.y}) of ${p.source}, cluster share ${c.share} */`);
  }
  const css = `/*
  Colour tokens. This is the only file with colour literals.
  Provenance: ${p.method}.
  Page background and surface are real pixels of the supplied cover banner, coordinates noted per line.
  Every other colour in the project is a var() of these or a color-mix() between them.
*/
:root {
${lines.join('\n')}
  --bg: ${p.bg.hex}; /* pixel (${p.bg.x},${p.bg.y}) of ${p.bg.source} */
  --surface: ${p.surface.hex}; /* pixel (${p.surface.x},${p.surface.y}) of ${p.surface.source} */

  --on-dark: var(--mist);
  --on-dark-2: color-mix(in srgb, var(--mist) 64%, var(--bg));
  --on-dark-3: color-mix(in srgb, var(--mist) 42%, var(--bg));
  --dark-line: color-mix(in srgb, var(--mist) 14%, transparent);
  --dark-line-strong: color-mix(in srgb, var(--mist) 30%, transparent);
  --veil: color-mix(in srgb, var(--mist) 6%, transparent);
  --veil-2: color-mix(in srgb, var(--mist) 10%, transparent);
  --scrim: color-mix(in srgb, var(--bg) 78%, transparent);
  --up: var(--sun);
  --down: var(--rose);
  --grad: linear-gradient(135deg, var(--sun), var(--rose), var(--violet));
  --grad-x: linear-gradient(90deg, var(--sun), var(--rose), var(--violet));

  --ease: cubic-bezier(0.2, 0.7, 0, 1);
  --gutter: clamp(20px, 5vw, 48px);
  --radius: 28px;
  --nav-h: 60px;
}
`;
  fs.writeFileSync('src/tokens.css', css);
  return css;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) buildTokens();
