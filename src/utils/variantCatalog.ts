/**
 * The purchasable catalogue, flattened to one entry per variant and shaped
 * exactly like a cart line.
 *
 * Several features need to construct a real cart line from nothing but a
 * variant id: the `?reorder=` prefill on the cart page, the reorder block on
 * the order-confirmation page, and the assistant when it stages a cart. This
 * is the one place that mapping is built, so a variant renamed or repriced in
 * content frontmatter changes everywhere at once.
 *
 * Server-side only (it reads the content collection and the image pipeline);
 * pages serialize what they need of it into their own client scripts.
 */
import { getCollection } from 'astro:content';
import type { Tier } from '@scripts/pricing';
import { resolveProductImage } from './productImages';

export interface CatalogLine {
  productId: string;
  variantId: string;
  title: string;
  shortTitle: string;
  variantName: string;
  hex: string;
  /** Thumbnail src, sized for the drawer chip. */
  image: string;
  sku: string;
  unit: string;
  packSize: number;
  subUnit: string | null;
  inStock: boolean;
  tiers: Tier[];
  href: string;
}

export async function getVariantCatalog(): Promise<CatalogLine[]> {
  const products = (await getCollection('products')).sort(
    (a, b) => a.data.order - b.data.order
  );

  return Promise.all(
    products.flatMap(product =>
      product.data.variants.map(async variant => ({
        productId: product.id,
        variantId: variant.id,
        title: product.data.title,
        shortTitle: product.data.shortTitle,
        variantName: variant.name,
        hex: variant.hex,
        image: (await resolveProductImage(variant.images[0], 160, 160)).src,
        sku: variant.sku,
        unit: product.data.unit,
        packSize: product.data.packSize,
        subUnit: product.data.subUnit ?? null,
        inStock: variant.inStock,
        tiers: (variant.tiers ?? product.data.tiers) as Tier[],
        href: `/products/${product.id}?color=${variant.id}`,
      }))
    )
  );
}
