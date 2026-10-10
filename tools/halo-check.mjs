import sharp from 'sharp';
const chk = async (f, label) => {
  const { data } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let semi = 0, dark = 0;
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; if (a > 0 && a < 255) { semi++; if (data[i] + data[i + 1] + data[i + 2] < 60 && a > 40) dark++; } }
  console.log(label, 'semi', semi, 'dark-with-alpha>40', dark, (100 * dark / semi).toFixed(1) + '%');
};
await chk('brand/LOGO FLOOQ PNG...png', 'source');
await chk('public/img/mark-640.png', 'resized-640');
