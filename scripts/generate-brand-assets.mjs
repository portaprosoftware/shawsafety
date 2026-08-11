/**
 * Derives the Android maskable icon and the social share image from the
 * primary logo in `src/images/icon.png`.
 *
 * Those two were still carrying the upstream template's artwork, which is not
 * obvious because nothing on the site renders them, the maskable icon only
 * appears when a phone installs the PWA, and social.png only when a link is
 * shared. Generating both from the real logo keeps them in sync.
 *
 * Re-run after replacing icon.png:
 *   node scripts/generate-brand-assets.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const images = resolve(root, 'src/images');
const MAROON = '#A31D2E';

const source = await readFile(`${images}/icon.png`);
const meta = await sharp(source).metadata();
console.log(`Source logo: ${meta.width}x${meta.height} ${meta.format}`);

/*
 * Exports named .png are sometimes actually JPEGs. Everything downstream
 * detects format by content so it still works, but the mismatch misleads
 * anything that trusts the extension, normalize it.
 */
if (meta.format !== 'png') {
  await writeFile(`${images}/icon.png`, await sharp(source).png().toBuffer());
  console.log('  Re-encoded icon.png as a true PNG (was ' + meta.format + ')');
}

/*
 * Apple touch icon. iOS does not honour transparency on home-screen icons,
 * it composites them onto black, so this one is explicitly flattened onto
 * white. Generated separately rather than reusing icon.png, which may well
 * have an alpha channel.
 */
const APPLE = 180;
await sharp({
  create: { width: APPLE, height: APPLE, channels: 4, background: '#ffffff' },
})
  .composite([
    {
      input: await sharp(source)
        .resize(Math.round(APPLE * 0.82), Math.round(APPLE * 0.82), {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .toBuffer(),
      gravity: 'center',
    },
  ])
  .flatten({ background: '#ffffff' })
  .png()
  .toFile(`${images}/icon-apple.png`);

/*
 * Maskable icon: Android crops to a circle, so the mark sits at ~62% of the
 * canvas with the rest as bleed. Flattened onto white for the same reason as
 * above, a transparent maskable icon renders as a blank plate.
 */
const MASKABLE = 1024;
const markSize = Math.round(MASKABLE * 0.62);
const mark = await sharp(source)
  .resize(markSize, markSize, { fit: 'contain', background: '#ffffff' })
  .toBuffer();

await sharp({
  create: {
    width: MASKABLE,
    height: MASKABLE,
    channels: 4,
    background: '#ffffff',
  },
})
  .composite([{ input: mark, gravity: 'center' }])
  .flatten({ background: '#ffffff' })
  .png()
  .toFile(`${images}/icon-maskable.png`);

/*
 * Social card. White plate with the real logo and a maroon wordmark, matching
 * the site itself rather than inventing a separate treatment.
 */
const W = 1200;
const H = 600;
const logoSize = 260;
const logo = await sharp(source)
  .resize(logoSize, logoSize, { fit: 'contain', background: '#ffffff' })
  .toBuffer();

const text =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="0" y="0" width="18" height="${H}" fill="${MAROON}"/>
  <text x="420" y="268" font-family="Helvetica, Arial, sans-serif" font-size="82"
        font-weight="bold" font-style="italic" letter-spacing="-2" fill="${MAROON}">SHAW SAFETY</text>
  <text x="424" y="326" font-family="Helvetica, Arial, sans-serif" font-size="31"
        font-weight="500" fill="#404040">Industrial Zip Ties &amp; Hi-Vis Safety Gear</text>
  <rect x="424" y="366" width="116" height="6" rx="3" fill="${MAROON}"/>
  <text x="424" y="440" font-family="Helvetica, Arial, sans-serif" font-size="26"
        font-weight="500" fill="#737373">UL 21S Listed &#183; DOT Compliant &#183; Ships Next Business Day</text>
</svg>`);

await sharp({
  create: { width: W, height: H, channels: 4, background: '#ffffff' },
})
  .composite([
    { input: logo, left: 120, top: Math.round((H - logoSize) / 2) },
    { input: text, left: 0, top: 0 },
  ])
  .flatten({ background: '#ffffff' })
  .png()
  .toFile(`${images}/social.png`);

console.log(
  'Wrote icon-apple.png (180), icon-maskable.png (1024), social.png (1200x600)'
);
