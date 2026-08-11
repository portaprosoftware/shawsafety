/**
 * Stripe order webhook.
 *
 * Listens for `checkout.session.completed` and emails the order to the team so
 * it can be picked and shipped. Without this, a paid order is only visible by
 * watching the Stripe dashboard.
 *
 * Point a Stripe webhook at https://shaw.portaprosoftware.com/api/stripe-webhook
 * `checkout.session.completed` event enabled, and put its signing secret in
 * STRIPE_CHECKOUT_WEBHOOK_SECRET.
 *
 * Environment:
 *   STRIPE_SECRET_KEY               required, to read the session's line items
 *   STRIPE_CHECKOUT_WEBHOOK_SECRET  required, verifies the payload really came
 *                                   from Stripe
 *   RESEND_API_KEY / RESEND_FROM / CONTACT_TO. See @utils/sendEmail
 */
import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { readEnv } from '@utils/env';
import { escapeHtml, sendEmail } from '@utils/sendEmail';

export const prerender = false;

/**
 * Event ids already handled on this instance.
 *
 * Best-effort only: serverless instances are ephemeral and several may run at
 * once, so this catches the common case of an immediate retry hitting a warm
 * instance and nothing more. Proper idempotency needs a datastore. Ids are
 * recorded only after the order email has actually been sent, so a genuine
 * failure still gets retried.
 */
const handled = new Set<string>();
const HANDLED_LIMIT = 500;

function remember(eventId: string): void {
  if (handled.size >= HANDLED_LIMIT) {
    handled.clear();
  }
  handled.add(eventId);
}

function money(amount: number | null | undefined, currency = 'usd'): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/**
 * Stripe has moved shipping details between fields across API versions, so
 * read whichever is populated rather than pinning to one shape.
 */
function readShipping(
  session: Stripe.Checkout.Session
): { name?: string | null; address?: Stripe.Address | null } | null {
  const loose = session as unknown as {
    shipping_details?: {
      name?: string | null;
      address?: Stripe.Address | null;
    };
    collected_information?: {
      shipping_details?: {
        name?: string | null;
        address?: Stripe.Address | null;
      };
    };
  };
  return (
    loose.collected_information?.shipping_details ??
    loose.shipping_details ??
    null
  );
}

function formatAddress(address?: Stripe.Address | null): string {
  if (!address) return '-';
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code]
      .filter(Boolean)
      .join(', '),
    address.country,
  ]
    .filter(Boolean)
    .join('\n');
}

export const POST: APIRoute = async ({ request }) => {
  const secretKey = readEnv('STRIPE_SECRET_KEY');
  const webhookSecret = readEnv('STRIPE_CHECKOUT_WEBHOOK_SECRET');

  if (!secretKey || !webhookSecret) {
    console.error(
      '[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_CHECKOUT_WEBHOOK_SECRET.'
    );
    return new Response('Not configured', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  // Verify against the exact bytes received; parse only after.
  const raw = await request.text();
  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;
  try {
    // Async variant works under every runtime, including edge.
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.warn('[stripe-webhook] Rejected bad signature:', error);
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge anything else so Stripe stops retrying it.
    return new Response('Ignored', { status: 200 });
  }

  if (handled.has(event.id)) {
    console.info(`[stripe-webhook] Duplicate ${event.id}; already handled.`);
    return new Response('Already handled', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  let lineItems: Stripe.LineItem[] = [];
  try {
    const list = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
    });
    lineItems = list.data;
  } catch (error) {
    // Worth an order email even without the itemisation, so carry on.
    console.error('[stripe-webhook] Could not list line items:', error);
  }

  const customer = session.customer_details;
  const shipping = readShipping(session);
  const currency = session.currency ?? 'usd';

  const rows: [string, string][] = [
    ['Name', customer?.name || shipping?.name || '-'],
    ['Email', customer?.email || '-'],
    ['Phone', customer?.phone || '-'],
    ['Ship to', formatAddress(shipping?.address ?? customer?.address)],
    ['Order total', money(session.amount_total, currency)],
    ['Payment', session.payment_status ?? '-'],
    ['Stripe session', session.id],
  ];

  const itemLines = lineItems.map(item => ({
    label: item.description ?? 'Item',
    qty: item.quantity ?? 1,
    amount: money(item.amount_total, currency),
  }));

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#171717">
      <h2 style="margin:0 0 4px;color:#9B1C2E">New Order</h2>
      <p style="margin:0 0 20px;color:#737373;font-size:13px">via Shaw Safety</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([label, value]) =>
              `<tr>
                 <td style="padding:5px 18px 5px 0;color:#737373;vertical-align:top">${label}</td>
                 <td style="padding:5px 0;font-weight:600;white-space:pre-line">${escapeHtml(value)}</td>
               </tr>`
          )
          .join('')}
      </table>
      <p style="margin:20px 0 6px;color:#737373;font-size:13px">Items</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${
          itemLines.length
            ? itemLines
                .map(
                  item =>
                    `<tr>
                       <td style="padding:5px 18px 5px 0">${escapeHtml(item.label)}</td>
                       <td style="padding:5px 18px 5px 0;color:#737373">&times;${item.qty}</td>
                       <td style="padding:5px 0;font-weight:600">${item.amount}</td>
                     </tr>`
                )
                .join('')
            : '<tr><td style="padding:5px 0;color:#737373">Line items unavailable. See the Stripe dashboard.</td></tr>'
        }
      </table>
    </div>`;

  const text = [
    'New Order via Shaw Safety',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Items:',
    ...(itemLines.length
      ? itemLines.map(i => `  ${i.label} x${i.qty}, ${i.amount}`)
      : ['  (unavailable. See the Stripe dashboard)']),
  ].join('\n');

  const result = await sendEmail({
    subject: `New order: ${money(session.amount_total, currency)}${
      customer?.name ? ` (${customer.name})` : ''
    }`,
    html,
    text,
    // Replying reaches the customer directly.
    replyTo: customer?.email ?? null,
  });

  if (!result.ok) {
    // Non-2xx makes Stripe retry, which is what we want for a dropped order
    // notification. The payment itself is unaffected.
    console.error(`[stripe-webhook] Order email failed: ${result.reason}`);
    return new Response('Notification failed', { status: 500 });
  }

  remember(event.id);
  console.info(
    `[stripe-webhook] Order emailed for session ${session.id} (${money(session.amount_total, currency)}).`
  );
  return new Response('OK', { status: 200 });
};

export const ALL: APIRoute = () =>
  new Response('Method not allowed', { status: 405 });
