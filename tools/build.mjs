// npm run build -> dist/  (the folder that gets dragged to Cloudflare)
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { buildTokens } from './tokens.mjs';
import { renderPage } from '../src/render.mjs';
import { checkRegister } from '../src/lib/register.mjs';

const out = 'dist';
const register = JSON.parse(fs.readFileSync('register.json', 'utf8'));

const errs = checkRegister(register);
if (errs.length) { console.error('Register invalid:\n - ' + errs.join('\n - ')); process.exit(1); }

buildTokens();
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/assets`, { recursive: true });
fs.mkdirSync(`${out}/fonts`, { recursive: true });

const common = { bundle: true, minify: true, outdir: `${out}/assets`, entryNames: '[name]-[hash]', metafile: true, logLevel: 'warning' };
const css = await build({ ...common, entryPoints: { app: 'src/app.css' }, external: ['/fonts/*'], target: ['chrome111', 'firefox113', 'safari16.4'] });
const js = await build({ ...common, entryPoints: { app: 'src/js/main.js' }, format: 'iife', target: ['es2020'] });
const nameOf = r => Object.keys(r.metafile.outputs).map(p => path.basename(p)).find(n => !n.endsWith('.map'));

fs.copyFileSync('src/noscript.css', `${out}/assets/noscript.css`);
fs.cpSync('public', out, { recursive: true });
fs.copyFileSync('node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2', `${out}/fonts/mona-sans.woff2`);
fs.copyFileSync('node_modules/@fontsource/monaspace-neon/files/monaspace-neon-latin-400-normal.woff2', `${out}/fonts/monaspace-neon.woff2`);

const palette = JSON.parse(fs.readFileSync('src/palette.json', 'utf8'));
fs.writeFileSync(`${out}/index.html`, renderPage(register, { css: nameOf(css), js: nameOf(js), bg: palette.bg.hex }));
fs.writeFileSync(`${out}/robots.txt`, 'User-agent: *\nAllow: /\n');
fs.writeFileSync(`${out}/_headers`, `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/img/*
  Cache-Control: public, max-age=604800
`);

const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`built ${out}/  css=${nameOf(css)} js=${nameOf(js)}  total ${(size(out) / 1024).toFixed(0)} KB`);
