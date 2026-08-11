/**
 * Product image resolution.
 *
 * Product frontmatter stores an extension-less *stem* (`tie-fluorescent-pink-1`)
 * rather than a path. This module maps that stem to whatever real file exists
 * in `src/images/products/`, in any supported format.
 *
 * Two things fall out of that:
 *
 * 1. Dropping `tie-fluorescent-pink-1.jpg` into the folder is the entire
 *    workflow. No content edit, because the extension is not written down
 *    anywhere.
 * 2. A missing photo renders a labelled placeholder instead of failing the
 *    build. The content collection previously used Astro's `image()` helper,
 *    which resolves at build time and hard-errors on a missing file
 *    (`[ImageNotFound]`), so deleting a placeholder broke deploys.
 */
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

/**
 * Eagerly glob every real image in the products folder. Vite requires a
 * literal pattern here, so the extension list is spelled out.
 */
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/images/products/*.{jpg,jpeg,png,webp,avif,gif}',
  { eager: true }
);

/** stem -> ImageMetadata, e.g. "tie-fluorescent-yellow-1" -> {...} */
const byStem = new Map<string, ImageMetadata>();
for (const [filePath, mod] of Object.entries(modules)) {
  const stem = filePath
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '');
  byStem.set(stem, mod.default);
}

export interface ResolvedImage {
  src: string;
  /** True when this is a "photo needed" placeholder rather than real artwork. */
  isPlaceholder: boolean;
}

export function hasProductImage(stem: string): boolean {
  return byStem.has(stem);
}

/**
 * A self-contained SVG naming the file to add, as a data URI.
 *
 * Returning a data URI rather than null keeps every call site simple: server
 * and client alike just get a `src` string that always renders. Allowed by the
 * `img-src 'self' data:` CSP.
 */
export function placeholderDataUri(stem: string): string {
  const label = `${stem}.jpg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720">
<rect width="720" height="720" fill="#FAFAFA"/>
<rect x="18" y="18" width="684" height="684" rx="20" fill="none" stroke="#A31D2E" stroke-width="4" stroke-dasharray="18 14" opacity="0.55"/>
<g transform="translate(360 292)">
<rect x="-46" y="-40" width="92" height="80" rx="14" fill="none" stroke="#A31D2E" stroke-width="7" opacity="0.75"/>
<circle cx="-16" cy="-12" r="11" fill="#A31D2E" opacity="0.75"/>
<path d="M-40 30 L-6 -4 L16 18 L32 4 L40 30 Z" fill="#A31D2E" opacity="0.75"/>
</g>
<text x="360" y="404" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="bold" fill="#A31D2E" letter-spacing="3">PHOTO NEEDED</text>
<text x="360" y="462" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="30" fill="#404040">${label}</text>
<text x="360" y="512" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#737373">add to src/images/products/</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

/**
 * Resolve a stem to a renderable `src` at the requested size.
 *
 * Real images go through Astro's pipeline (resize, format conversion, content
 * hashing). Missing ones fall back to the placeholder, which is already the
 * right size at any scale because it is vector.
 */
export async function resolveProductImage(
  stem: string,
  width: number,
  height: number
): Promise<ResolvedImage> {
  const found = byStem.get(stem);
  if (!found) {
    return { src: placeholderDataUri(stem), isPlaceholder: true };
  }
  const optimized = await getImage({ src: found, width, height });
  return { src: optimized.src, isPlaceholder: false };
}
