const fs = require('fs');
let s = fs.readFileSync('src/render.mjs', 'utf8');
const pairs = [
  ['then morphs to a one-tap control once a record exists.', 'then morphs into single-tap copy control once a record exists.'],
  ['A public Solana price service that ranks', 'An open Solana price service that ranks'],
  ['and no feature goes live ahead of reality.', 'and no feature lights up ahead of reality.']
];
let miss = 0;
for (const [a, b] of pairs) {
  if (!s.includes(a)) { console.log('MISS', a.slice(0, 70)); miss++; continue; }
  s = s.split(a).join(b);
}
fs.writeFileSync('src/render.mjs', s);
console.log('done, misses', miss);
