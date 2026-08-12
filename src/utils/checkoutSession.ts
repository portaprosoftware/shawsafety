/**
 * Pure decision-making for Stripe Checkout.
 *
 * Deliberately imports neither `astro:content` nor the Stripe SDK: everything
 * that governs what gets charged is here, so it can be exercised directly.
 * `src/pages/api/checkout.ts` supplies the catalogue and performs the call.
 */
import { PRICE_ENV_BY_VARIANT } from './stripePrices';

/** Guards against a nonsense quantity reaching Stripe. */
export const MAX_QTY_PER_LINE = 9999;

export interface CatalogueVariant {
  /** Human label used in error messages, e.g. `11" Zip Tie, Fluorescent Pink`. */
  label: string;
  /** The variant's price ladder, for the tier-consistency check. */
  tiers: { minQty: number; maxQty: number | null; pricePerUnit: number }[];
}

export interface ResolvedLines {
  lineItems: { price: string; quantity: number }[];
  /** The validated lines behind `lineItems`, for the reorder metadata. */
  accepted: { variantId: string; qty: number }[];
  /** Real products with no Stripe Price configured yet. */
  unavailable: string[];
  /** Variant ids not in the catalogue at all. */
  unknown: string[];
  /** Set when the request itself is malformed. */
  invalid?: string;
}

/**
 * Turn a client request into Stripe line items.
 *
 * The request supplies variant ids and quantities and nothing else, any price
 * or amount it sends is ignored, so a tampered cart cannot choose what it pays.
 */
export function resolveLineItems(
  requested: unknown,
  catalogue: Map<string, CatalogueVariant>,
  lookupEnv: (name: string) => string | undefined
): ResolvedLines {
  const result: ResolvedLines = {
    lineItems: [],
    accepted: [],
    unavailable: [],
    unknown: [],
  };

  if (!Array.isArray(requested) || requested.length === 0) {
    return { ...result, invalid: 'Your cart is empty.' };
  }

  for (const line of requested) {
    const variantId = (line as { variantId?: unknown })?.variantId;
    if (typeof variantId !== 'string') continue;

    const entry = catalogue.get(variantId);
    if (!entry) {
      result.unknown.push(variantId);
      continue;
    }

    const qty = Math.floor(Number((line as { qty?: unknown })?.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      return { ...result, invalid: 'That quantity is not valid.' };
    }

    const envName = PRICE_ENV_BY_VARIANT[variantId];
    const priceId = envName ? lookupEnv(envName) : undefined;
    if (!priceId) {
      result.unavailable.push(entry.label);
      continue;
    }

    result.lineItems.push({ price: priceId, quantity: qty });
    result.accepted.push({ variantId, qty });
  }

  return result;
}

/**
 * Stripe caps each metadata value at 500 characters. An order with more
 * distinct lines than fits is simply not annotated; the order itself is
 * unaffected and the webhook email falls back to having no reorder link.
 */
export const MAX_REORDER_METADATA_CHARS = 490;

/**
 * The `reorder` metadata value: `variantId:qty` pairs the webhook turns into
 * a one-click reorder link in the order email. Built from the same validated
 * lines the session charges, so the link always mirrors what was bought.
 */
export function buildReorderMetadata(
  lines: { variantId: string; qty: number }[]
): string | null {
  const value = lines.map(line => `${line.variantId}:${line.qty}`).join(',');
  return value && value.length <= MAX_REORDER_METADATA_CHARS ? value : null;
}

/**
 * The Checkout Session request body.
 *
 * Collects a US shipping address and a phone number for fulfilment, and offers
 * an explicit zero-cost shipping rate so the customer sees the free shipping
 * the site promises rather than a blank line.
 */
export function buildSessionParams(
  lineItems: { price: string; quantity: number }[],
  origin: string,
  reorder: string | null = null
) {
  return {
    ...(reorder ? { metadata: { reorder } } : {}),
    mode: 'payment' as const,
    line_items: lineItems,
    shipping_address_collection: { allowed_countries: ['US' as const] },
    phone_number_collection: { enabled: true },
    billing_address_collection: 'auto' as const,
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount' as const,
          fixed_amount: { amount: 0, currency: 'usd' },
          display_name: 'Free U.S. shipping',
          delivery_estimate: {
            minimum: { unit: 'business_day' as const, value: 1 },
            maximum: { unit: 'business_day' as const, value: 5 },
          },
        },
      },
    ],
    allow_promotion_codes: true,
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cart`,
  };
}

/**
 * Compare a Stripe Price against the ladder the site advertises.
 *
 * A flat Stripe Price charges the same unit amount at every quantity, so a
 * published volume discount would silently never apply. Returns problems to
 * log rather than throwing, a pricing misconfiguration should be loud, but it
 * should not take the storefront offline, and the customer sees the real total
 * on Stripe's page before paying.
 */
export function auditPrice(
  price: { id: string; billing_scheme?: string; unit_amount?: number | null },
  tiers: { pricePerUnit: number }[]
): string[] {
  const problems: string[] = [];

  if (tiers.length > 1 && price.billing_scheme !== 'tiered') {
    problems.push(
      `Price ${price.id} is flat but the site advertises ${tiers.length} volume ` +
        `tiers. Configure volume tiers on the Stripe Price, or the published ` +
        `discount will never be applied.`
    );
  }

  const advertised = Math.round((tiers[0]?.pricePerUnit ?? 0) * 100);
  if (
    price.billing_scheme === 'per_unit' &&
    advertised &&
    price.unit_amount !== advertised
  ) {
    problems.push(
      `Price ${price.id} charges ${price.unit_amount} cents but the site lists ` +
        `${advertised} cents. These must match.`
    );
  }

  return problems;
}
