/**
 * Reports which product photos are still missing.
 *
 * Runs as part of `pnpm build` and never fails it, a missing photo renders a
 * labelled placeholder on the page rather than breaking the deploy. This is
 * purely so the build log tells you what is still outstanding.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = resolve(root, 'src/content/products');
const imagesDir = resolve(root, 'src/images/products');

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

/** Stems of every real image on disk. */
async function presentStems() {
  let files = [];
  try {
    files = await readdir(imagesDir);
  } catch {
    return new Set();
  }
  return new Set(
    files.filter(f => IMAGE_EXT.test(f)).map(f => f.replace(/\.[^.]+$/, ''))
  );
}

/**
 * Stems referenced by content.
 *
 * Scanned line by line rather than with one regex: an `images:` list is
 * followed by the next variant's `- id:` at a shallower indent, and a greedy
 * pattern happily swallows those too. Tracking indentation is what actually
 * bounds the block.
 */
async function referencedStems() {
  const files = (await readdir(contentDir)).filter(f => /\.mdx?$/.test(f));
  const refs = [];

  for (const file of files) {
    const all = (await readFile(resolve(contentDir, file), 'utf8')).split('\n');
    // Only the frontmatter can reference images; the body is prose.
    const end = all.indexOf('---', 1);
    const lines = end === -1 ? all : all.slice(1, end);

    // `undefined` = outside a block, `null` = inside awaiting the first item.
    let itemIndent = undefined;

    for (const line of lines) {
      // Spec sheets are single scalars rather than a list, but they are still
      // images resolved from the same folder, count them as referenced.
      const spec = line.match(/^\s*spec:\s*'?([^'\n]+?)'?\s*$/);
      if (spec) {
        refs.push(spec[1].trim());
        continue;
      }

      if (/^\s*images:\s*$/.test(line)) {
        itemIndent = null;
        continue;
      }
      if (itemIndent === undefined) continue;

      const item = line.match(/^(\s*)-\s*'?([^':\n]+?)'?\s*$/);
      const inBlock = itemIndent !== undefined;

      if (item && inBlock) {
        const indent = item[1].length;
        if (itemIndent === null) itemIndent = indent;
        // A shallower item belongs to the enclosing list, not to images.
        if (indent < itemIndent) {
          itemIndent = undefined;
          continue;
        }
        refs.push(item[2].trim());
      } else if (inBlock && line.trim() !== '') {
        itemIndent = undefined; // Any non-item line ends the block.
      }
    }
  }
  return refs;
}

const present = await presentStems();
const referenced = [...new Set(await referencedStems())];
const missing = referenced.filter(stem => !present.has(stem));

const have = referenced.length - missing.length;
console.log(`\nProduct photos: ${have}/${referenced.length} present`);

if (missing.length) {
  console.log(`  Missing ${missing.length}. Add to src/images/products/:`);
  for (const stem of missing) console.log(`    ${stem}.jpg`);
  console.log(
    '  (any of .jpg .jpeg .png .webp .avif; the extension is not referenced)\n'
  );
} else {
  console.log('  All referenced photos are present.\n');
}

// Unused files are worth knowing about too, usually a typo in a filename.
const orphans = [...present].filter(stem => !referenced.includes(stem));
if (orphans.length) {
  console.log(`  Note: ${orphans.length} image(s) present but unreferenced:`);
  for (const stem of orphans) console.log(`    ${stem}`);
  console.log('');
}
