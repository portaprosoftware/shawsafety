/**
 * Maps a product variant to the environment variable holding its Stripe Price
 * ID.
 *
 * Price IDs are deployment configuration, not content — the same repo points
 * at test prices locally and live prices in production — so they live in env
 * rather than in the Markdown frontmatter.
 *
 * A variant with no configured price simply cannot be bought yet; the checkout
 * endpoint reports it by name rather than failing obscurely. Only the yellow
 * tie is set up so far.
 */
export const PRICE_ENV_BY_VARIANT: Record<string, string> = {
  'fluorescent-yellow': 'STRIPE_PRICE_YELLOW',
  'fluorescent-pink': 'STRIPE_PRICE_PINK',
  'fluorescent-green': 'STRIPE_PRICE_GREEN',
  'fluorescent-orange': 'STRIPE_PRICE_ORANGE',
  'hi-vis-lime': 'STRIPE_PRICE_VEST_LIME',
  'hi-vis-orange': 'STRIPE_PRICE_VEST_ORANGE',
};
