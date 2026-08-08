/**
 * Checkout adapter — the single seam between this storefront and a payment
 * processor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TO GO LIVE WITH STRIPE, EDIT ONLY THIS FILE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nothing else in the site imports Stripe or knows a processor exists; the
 * cart calls `checkout(items)` and that is the whole contract. The CSP in
 * vercel.json is already widened for js.stripe.com, hooks.stripe.com and
 * api.stripe.com, so the swap needs no infrastructure change.
 *
 * IMPORTANT: prices in the cart are display-only. Never trust a
 * client-supplied amount — resolve real Stripe Price IDs server-side (or use
 * fixed Price IDs as below) so a tampered cart cannot set its own price.
 *
 * Option A — Stripe Checkout (hosted page or embedded modal). Requires a
 * Price ID per variant/tier. Add `stripePriceId` to each variant in
 * src/content.config.ts and thread it through `CartItem`:
 *
 *   import { loadStripe } from '@stripe/stripe-js';
 *   const stripe = await loadStripe(import.meta.env.PUBLIC_STRIPE_KEY);
 *   await stripe!.redirectToCheckout({
 *     mode: 'payment',
 *     lineItems: items.map(i => ({ price: i.stripePriceId, quantity: i.qty })),
 *     successUrl: `${location.origin}/checkout/success`,
 *     cancelUrl: `${location.origin}/cart`,
 *   });
 *
 * Option B — Stripe Buy Button, for a drop-in popup with no JS wiring:
 * render <stripe-buy-button> in CartDrawer.astro and let this function be a
 * no-op. Simplest path, but it cannot carry a dynamic multi-line cart.
 *
 * Option C — Square: swap in Web Payments SDK or a hosted checkout link.
 * The signature below does not change.
 */

import type { CartItem } from './cart';

export interface CheckoutResult {
  ok: boolean;
  message: string;
}

/**
 * Hand the cart off for payment.
 *
 * Currently a stub: it validates the cart and surfaces a notice instead of
 * charging. Replace the body with one of the options above.
 */
export async function checkout(items: CartItem[]): Promise<CheckoutResult> {
  if (!items.length) {
    return { ok: false, message: 'Your cart is empty.' };
  }

  // Payload shape a processor will need, logged so the integration can be
  // verified before any key exists.
  const payload = items.map(i => ({
    sku: i.sku,
    productId: i.productId,
    variantId: i.variantId,
    quantity: i.qty,
  }));
  console.info('[checkout] pending processor integration', payload);

  return {
    ok: false,
    message:
      'Online checkout is being connected. Call or email us and we will process your order today.',
  };
}
