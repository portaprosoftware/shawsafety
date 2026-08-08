/**
 * Generates placeholder product artwork.
 *
 * These stand in until the real photography is served from the Cloudflare R2
 * bucket. They are committed (rather than generated at build time) so the
 * build has no extra step; re-run with `node scripts/generate-placeholder-images.mjs`
 * only if the color list changes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/images/products');

const tieColors = [
  { id: 'fluorescent-yellow', fill: '#E8FF00', shade: '#C4D600' },
  { id: 'fluorescent-pink', fill: '#FF4B6E', shade: '#D62D4E' },
  { id: 'fluorescent-green', fill: '#8CFF1A', shade: '#6BD900' },
  { id: 'fluorescent-orange', fill: '#FF8A1F', shade: '#E06A00' },
];

const vestColors = [
  { id: 'hi-vis-lime', fill: '#D6F94A', shade: '#B4D62E' },
  { id: 'hi-vis-orange', fill: '#FF8A1F', shade: '#E06A00' },
];

/** A single tie laid diagonally, head at top-left. */
const tieSingle = ({ fill, shade }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <rect width="800" height="800" fill="#ffffff"/>
  <g transform="rotate(38 400 400)">
    <rect x="352" y="150" width="96" height="86" rx="20" fill="${fill}" stroke="${shade}" stroke-width="6"/>
    <rect x="381" y="176" width="38" height="42" rx="8" fill="#ffffff" stroke="${shade}" stroke-width="5"/>
    <path d="M368 236 h64 l-14 400 q-18 34 -36 0 z" fill="${fill}" stroke="${shade}" stroke-width="6" stroke-linejoin="round"/>
    ${Array.from({ length: 26 }, (_, i) => {
      const y = 262 + i * 13;
      const inset = 4 + i * 0.35;
      return `<line x1="${370 + inset}" y1="${y}" x2="${430 - inset}" y2="${y}" stroke="${shade}" stroke-width="3" opacity="0.65"/>`;
    }).join('\n    ')}
  </g>
</svg>`;

/** The same tie cinched into a loop, the way it ships on a container. */
const tieLooped = ({ fill, shade }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <rect width="800" height="800" fill="#ffffff"/>
  <path d="M400 250 C 205 250 160 430 260 545 C 350 648 460 648 545 545 C 640 428 595 250 400 250 Z"
        fill="none" stroke="${fill}" stroke-width="34" stroke-linecap="round"/>
  <path d="M400 250 C 205 250 160 430 260 545 C 350 648 460 648 545 545 C 640 428 595 250 400 250 Z"
        fill="none" stroke="${shade}" stroke-width="34" stroke-linecap="round" opacity="0.18"/>
  <rect x="352" y="196" width="96" height="86" rx="20" fill="${fill}" stroke="${shade}" stroke-width="6"/>
  <rect x="381" y="222" width="38" height="42" rx="8" fill="#ffffff" stroke="${shade}" stroke-width="5"/>
  <path d="M448 214 h150 q22 12 0 24 h-150 z" fill="${fill}" stroke="${shade}" stroke-width="6" stroke-linejoin="round"/>
</svg>`;

/** A loose stack, standing in for the 100-count bag shot. */
const tieBundle = ({ fill, shade }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <rect width="800" height="800" fill="#ffffff"/>
  <g>
    ${Array.from({ length: 16 }, (_, i) => {
      const y = 250 + i * 20;
      const skew = (i % 4) * 9 - 14;
      return `<path d="M${150 + skew} ${y} h520 q26 10 0 20 h-520 z" fill="${fill}" stroke="${shade}" stroke-width="4" opacity="${0.75 + (i % 3) * 0.08}"/>
    <rect x="${118 + skew}" y="${y - 9}" width="40" height="38" rx="9" fill="${fill}" stroke="${shade}" stroke-width="4"/>`;
    }).join('\n    ')}
  </g>
</svg>`;

/** Class 2 vest, front view. */
const vest = ({ fill, shade }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <rect width="800" height="800" fill="#ffffff"/>
  <path d="M300 170 L250 200 L215 620 H385 V300 L400 250 L415 300 V620 H585 L550 200 L500 170 L400 260 Z"
        fill="${fill}" stroke="${shade}" stroke-width="8" stroke-linejoin="round"/>
  <g stroke="#C0C6CC" stroke-width="22" opacity="0.95">
    <line x1="228" y1="420" x2="382" y2="420"/>
    <line x1="418" y1="420" x2="572" y2="420"/>
    <line x1="240" y1="520" x2="382" y2="520"/>
    <line x1="418" y1="520" x2="560" y2="520"/>
    <line x1="300" y1="205" x2="330" y2="620"/>
    <line x1="500" y1="205" x2="470" y2="620"/>
  </g>
</svg>`;

await mkdir(outDir, { recursive: true });

for (const color of tieColors) {
  await writeFile(`${outDir}/tie-${color.id}-1.svg`, tieSingle(color).trim());
  await writeFile(`${outDir}/tie-${color.id}-2.svg`, tieLooped(color).trim());
  await writeFile(`${outDir}/tie-${color.id}-3.svg`, tieBundle(color).trim());
}

for (const color of vestColors) {
  await writeFile(`${outDir}/vest-${color.id}-1.svg`, vest(color).trim());
}

console.log(
  `Wrote ${tieColors.length * 3 + vestColors.length} placeholder images to ${outDir}`
);
