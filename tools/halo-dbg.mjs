import sharp from 'sharp';
const { data, info } = await sharp('public/img/mark-640.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let n = 0; const hist = {};
for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; if (a > 40 && a < 255 && data[i] + data[i + 1] + data[i + 2] < 60) { hist[a >> 4] = (hist[a >> 4] || 0) + 1; if (n++ < 6) console.log((i / 4) % info.width, Math.floor(i / 4 / info.width), [...data.slice(i, i + 4)]); } }
console.log(hist);
