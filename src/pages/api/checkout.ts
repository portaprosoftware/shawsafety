/**
 * Creates a Stripe Checkout Session for the cart and returns its URL.
 *
 * Runs on demand: the Stripe secret key is a server secret.
 *
 * The client sends only variant ids and quantities. Everything that decides
 * money, which Price to charge, what it costs, is resolved here from the
 * content collection and from Stripe itself, so a tampered cart cannot set its
 * own price. The decision logic lives in @utils/checkoutSession so it can be
 * tested without Astro or a network.
 *
 * Environment:
 *   STRIPE_SECRET_KEY     required, `sk_...`
 *   STRIPE_PRICE_<COLOR>  one per purchasable variant; see @utils/stripePrices
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import Stripe from 'stripe';
import { readEnv } from '@utils/env';
import { PRICE_ENV_BY_VARIANT } from '@utils/stripePrices';
import {
  auditPrice,
  buildSessionParams,
  resolveLineItems,
  type CatalogueVariant,
} from '@utils/checkoutSession';

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  const secretKey = readEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    console.error('[checkout] STRIPE_SECRET_KEY is not set.');
    return json(
      {
        ok: false,
        error:
          'Checkout is not configured yet. Please call (800) 555-0117 to order.',
      },
      503
    );
  }

  let payload: { items?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Could not read the cart.' }, 400);
  }

  // Authoritative catalogue. The request supplies ids only.
  const products = await getCollection('products');
  const catalogue = new Map<string, CatalogueVariant>(
    products.flatMap(product =>
      product.data.variants.map(variant => [
        variant.id,
        {
          label: `${product.data.shortTitle}, ${variant.name}`,
          tiers: variant.tiers ?? product.data.tiers,
        },
      ])
    )
  );

  const resolved = resolveLineItems(payload.items, catalogue, readEnv);

  if (resolved.invalid) {
    return json({ ok: false, error: resolved.invalid }, 400);
  }
  if (resolved.unknown.length) {
    console.warn(
      `[checkout] Ignored unknown variants: ${resolved.unknown.join(', ')}`
    );
  }

  // Refuse a partial order rather than quietly dropping what someone chose.
  if (resolved.unavailable.length) {
    const list = resolved.unavailable.join(', ');
    const pronoun = resolved.unavailable.length === 1 ? 'it' : 'them';
    return json(
      {
        ok: false,
        error: `Not yet available to buy online: ${list}. Remove ${pronoun} to check out, or call (800) 555-0117 to order.`,
      },
      409
    );
  }

  if (resolved.lineItems.length === 0) {
    return json(
      { ok: false, error: 'Nothing in the cart can be purchased.' },
      400
    );
  }

  const stripe = new Stripe(secretKey);

  try {
    // Surface pricing misconfiguration in the logs. Does not block the sale;
    // Stripe shows the real total before the customer pays.
    await Promise.all(
      resolved.lineItems.map(async item => {
        try {
          const price = await stripe.prices.retrieve(item.price);
          const variantId = Object.keys(PRICE_ENV_BY_VARIANT).find(
            id => readEnv(PRICE_ENV_BY_VARIANT[id]) === item.price
          );
          const tiers = variantId
            ? (catalogue.get(variantId)?.tiers ?? [])
            : [];
          for (const problem of auditPrice(price, tiers)) {
            console.error(`[checkout] ${problem}`);
          }
        } catch (error) {
          console.warn('[checkout] Could not verify price:', error);
        }
      })
    );

    const session = await stripe.checkout.sessions.create(
      buildSessionParams(resolved.lineItems, url.origin)
    );

    if (!session.url) {
      console.error('[checkout] Stripe returned a session with no URL.');
      return json(
        { ok: false, error: 'Could not start checkout. Please try again.' },
        502
      );
    }

    return json({ ok: true, url: session.url }, 200);
  } catch (error) {
    // Stripe's message can name internal configuration; keep it server-side.
    console.error('[checkout] Stripe session creation failed:', error);
    return json(
      {
        ok: false,
        error:
          'Could not start checkout. Please try again, or call (800) 555-0117.',
      },
      502
    );
  }
};

export const ALL: APIRoute = () =>
  json({ ok: false, error: 'Method not allowed.' }, 405);
