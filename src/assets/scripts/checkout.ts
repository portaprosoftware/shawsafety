/**
 * Checkout adapter, the single seam between this storefront and Stripe.
 *
 * The cart calls `checkout(items)` and that is the whole contract; no component
 * imports Stripe or knows how payment works.
 *
 * Only variant ids and quantities are sent. Prices shown in the cart are
 * display-only, `src/pages/api/checkout.ts` resolves the real Stripe Price for
 * each variant server-side, so a tampered cart cannot set its own price.
 */

import type { CartItem } from './cart';

export interface CheckoutResult {
  ok: boolean;
  message: string;
}

export async function checkout(items: CartItem[]): Promise<CheckoutResult> {
  if (!items.length) {
    return { ok: false, message: 'Your cart is empty.' };
  }

  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(item => ({
          variantId: item.variantId,
          qty: item.qty,
        })),
      }),
    });

    // A non-JSON body means something upstream failed; treat it as a failure
    // rather than throwing on the parse.
    const result = await response.json().catch(() => null);

    if (response.ok && result?.ok && result.url) {
      // Hand off to Stripe's hosted page. The cart is cleared on return by
      // /checkout/success, not here, abandoning checkout must keep the basket.
      window.location.assign(result.url);
      return { ok: true, message: 'Redirecting to secure checkout…' };
    }

    return {
      ok: false,
      message:
        result?.error ??
        'Could not start checkout. Please try again, or call (800) 555-0117.',
    };
  } catch {
    return {
      ok: false,
      message:
        'Could not reach the server. Check your connection and try again.',
    };
  }
}
