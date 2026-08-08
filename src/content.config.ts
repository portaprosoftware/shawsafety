// https://docs.astro.build/en/guides/content-collections/#defining-collections

import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * A single volume-pricing bracket. `maxQty: null` means "and up".
 * Brackets are matched in order, so they must be authored ascending.
 */
const tierSchema = z.object({
  minQty: z.number(),
  maxQty: z.number().nullable(),
  pricePerUnit: z.number(),
});

const productsCollection = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.{md,mdx}',
    base: './src/content/products',
  }),
  schema: () =>
    z.object({
      title: z.string(),
      shortTitle: z.string(),
      description: z.string(),
      sku: z.string(),
      category: z.enum(['zip-ties', 'vests']),
      badge: z.string().optional(),
      // Units inside one purchasable item, e.g. 100 ties per pack.
      packSize: z.number(),
      // Noun for one purchasable item ("pack", "vest").
      unit: z.string(),
      // Noun for one item inside a pack ("tie"); omit for single-unit products.
      subUnit: z.string().optional(),
      rating: z.object({
        value: z.number(),
        count: z.number(),
      }),
      // Default price ladder. A variant may override it with its own `tiers`.
      tiers: z.array(tierSchema),
      variants: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          // Swatch color for the selector chip.
          hex: z.string(),
          sku: z.string(),
          inStock: z.boolean().default(true),
          /**
           * Extension-less filenames resolved against src/images/products/ at
           * render time by @utils/productImages. Deliberately NOT Astro's
           * `image()` helper: that resolves at build time and hard-fails on a
           * missing file, so removing a photo broke the deploy. Missing files
           * now render a labelled placeholder instead.
           */
          images: z.array(z.string()),
          tiers: z.array(tierSchema).optional(),
        })
      ),
      highlights: z.array(
        z.object({
          icon: z.string(),
          title: z.string(),
          body: z.string(),
        })
      ),
      specs: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        })
      ),
      compliance: z.array(z.string()),
      // Ordering on the products index (ascending).
      order: z.number().default(0),
    }),
});

export const collections = {
  products: productsCollection,
};
