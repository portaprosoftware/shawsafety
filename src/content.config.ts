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
          /**
           * Optional spec-sheet image stem, resolved the same way as `images`.
           * Rendered behind a "View Spec" link on the product page.
           */
          spec: z.string().optional(),
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

/**
 * Retrieval corpus for the RAG assistant.
 *
 * One file per chunk. Chunks are authored by hand rather than scraped from the
 * rendered site: the pages interleave copy with markup and price math, and a
 * scraper would produce fragments that read as fragments. Each chunk is
 * written to stand alone. It names the product it is about instead of relying
 * on a heading three sections up, because retrieval will hand it to the model
 * with no surrounding page.
 *
 * `questions` is the retrieval hook. Embedding the questions a chunk answers
 * alongside its prose closes the vocabulary gap between how a buyer asks
 * ("how fast do you ship?") and how the site states it ("dispatch"). The build
 * script prepends them to the embedded text; they are not shown to the model
 * as content.
 */
const knowledgeCollection = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/knowledge',
  }),
  schema: () =>
    z.object({
      title: z.string(),
      topic: z.enum([
        'product',
        'pricing',
        'shipping',
        'ordering',
        'policy',
        'company',
      ]),
      /** Page this chunk was drawn from, cited back to the visitor. */
      url: z.string(),
      /** Human label for that page, used in the citation list. */
      sourceLabel: z.string().optional(),
      questions: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      /**
       * Reference documents set this to split into one retrieval chunk per H2
       * heading. Left unset, the file embeds whole, which is what the
       * page-anchored chunks want.
       */
      chunkBy: z.literal('section').optional(),
    }),
});

export const collections = {
  products: productsCollection,
  knowledge: knowledgeCollection,
};
