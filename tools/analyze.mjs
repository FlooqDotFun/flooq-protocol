import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const dirs = ['brand', 'reference'];
const out = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const rec = { file: p, bytes: buf.length, sha };
    if (buf.readUInt32BE(0) === 0x89504e47) {
      rec.kind = 'png';
      rec.ihdr = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25], interlace: buf[28] };
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
      rec.kind = 'jpeg';
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xc3) { rec.sof = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] }; break; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    rec.decoded = { w: info.width, h: info.height, ch: info.channels };
    const hist = new Array(8).fill(0); // alpha buckets of 32
    let pureBlackTransparent = 0, pureBlackOpaque = 0, nonBlack = 0;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      hist[a >> 5]++;
      const black = data[i] + data[i + 1] + data[i + 2] === 0;
      if (black && a === 0) pureBlackTransparent++;
      else if (black) pureBlackOpaque++;
      else nonBlack++;
      const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      if (a > 0) counts.set(k, (counts.get(k) || 0) + 1);
    }
    rec.alphaHist32 = hist;
    rec.pureBlackTransparent = pureBlackTransparent;
    rec.pureBlackOpaque = pureBlackOpaque;
    rec.nonBlack = nonBlack;
    rec.dominant12bit = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, n]) => `#${((k >> 8) & 15).toString(16)}${((k >> 4) & 15).toString(16)}${(k & 15).toString(16)} x${n}`);
    out.push(rec);
  }
}
console.log(JSON.stringify(out, null, 1));
