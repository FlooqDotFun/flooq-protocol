// Shared 2-gram check between the page copy and the reference corpus.
import fs from 'node:fs';

export const words = s => String(s).toLowerCase().replace(/[‘’]/g, "'").match(/[a-z][a-z']*/g) || [];
export const bigrams = text => {
  const out = new Set();
  // grams never cross a sentence or line boundary
  for (const part of String(text).split(/[\n.!?;:—·|]+/)) {
    const w = words(part);
    for (let i = 0; i < w.length - 1; i++) out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
};

export function pageText(html) {
  const attrs = [...html.matchAll(/(?:aria-label|content|alt)="([^"]*)"/g)].map(m => m[1]).filter(t => /\s/.test(t));
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<pre>[\s\S]*?<\/pre>/g, ' ') // command snippets are literal protocol text, not copy
    .replace(/<(?:\/?(?:p|div|li|h\d|section|summary|span|strong|dt|dd|button|a|details|article|ol|ul|header|footer|nav|main|dl|label|time|code|i|img|td|th|tr))\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return body + '\n' + attrs.join('\n');
}

export function sharedBigrams(html, corpusPath = 'tools/ref-corpus.txt') {
  const ref = bigrams(fs.readFileSync(corpusPath, 'utf8'));
  const mine = bigrams(pageText(html));
  return { shared: [...mine].filter(g => ref.has(g)), mineCount: mine.size, refCount: ref.size };
}

if (process.argv[1] && process.argv[1].endsWith('copy-check.mjs')) {
  const r = sharedBigrams(fs.readFileSync('dist/index.html', 'utf8'));
  console.log(JSON.stringify(r, null, 1));
}
