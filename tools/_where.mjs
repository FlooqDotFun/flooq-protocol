import fs from 'node:fs';
import { sharedBigrams, pageText, words } from './copy-check.mjs';
const html = fs.readFileSync('dist/index.html', 'utf8');
const { shared } = sharedBigrams(html);
const segs = pageText(html).split(/\n+/).map(s => s.trim()).filter(Boolean);
for (const g of shared) {
  const hit = segs.find(s => (words(s).join(' ') + ' ').includes(g + ' ') || words(s).join(' ').includes(g));
  console.log(g.padEnd(16), '|', (hit || '').slice(0, 110));
}
