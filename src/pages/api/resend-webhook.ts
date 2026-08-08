/**
 * Resend delivery-event webhook.
 *
 * Resend POSTs here when a message is delivered, bounced, complained about,
 * opened, or clicked. Configure the endpoint at
 * https://resend.com/webhooks pointing to `https://shawsafety.com/api/resend-webhook`
 * and copy the signing secret into RESEND_WEBHOOK_SECRET.
 *
 * Note this is only for *receiving* events. Sending mail (src/pages/api/contact.ts)
 * uses RESEND_API_KEY and never touches this secret.
 *
 * Events are logged to the Vercel function log — enough to diagnose a bounce
 * or a spam complaint. Persisting them would need a datastore.
 */
import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from '@utils/env';

export const prerender = false;

/** Reject replays of anything older than this. Svix's own default. */
const TOLERANCE_SECONDS = 5 * 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Verify a Svix-format signature, which is what Resend uses.
 *
 * The signed payload is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the
 * secret, base64-encoded. The header can carry several space-separated
 * `v1,<sig>` entries so a secret can be rotated without downtime — any match
 * is a pass.
 */
function verifySignature(
  secret: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
  body: string
): boolean {
  // The secret is distributed as `whsec_<base64>`; the bytes are what sign.
  const key = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64'
  );

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  for (const entry of signatureHeader.split(' ')) {
    // Each entry is `v1,<base64>`; ignore versions we do not implement.
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;

    const candidate = Buffer.from(value, 'base64');
    // timingSafeEqual throws on a length mismatch, so check that first.
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  const secret = readEnv('RESEND_WEBHOOK_SECRET');
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set.');
    return json({ ok: false }, 503);
  }

  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');

  if (!id || !timestamp || !signature) {
    return json({ ok: false, error: 'Missing signature headers.' }, 400);
  }

  // Bound replays. Without this a captured request stays valid forever.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    console.warn(`[resend-webhook] Rejected stale timestamp (${timestamp}).`);
    return json({ ok: false, error: 'Timestamp outside tolerance.' }, 400);
  }

  // Must verify against the exact bytes received, so read the raw body and
  // parse only afterwards.
  const raw = await request.text();

  if (!verifySignature(secret, id, timestamp, signature, raw)) {
    console.warn('[resend-webhook] Rejected bad signature.');
    return json({ ok: false, error: 'Invalid signature.' }, 401);
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'Body is not JSON.' }, 400);
  }

  const to = Array.isArray(event.data?.to)
    ? (event.data.to as string[]).join(', ')
    : String(event.data?.to ?? 'unknown');

  // Bounces and complaints are the ones worth noticing in the log.
  const serious =
    event.type === 'email.bounced' || event.type === 'email.complained';
  const line = `[resend-webhook] ${event.type ?? 'unknown'} → ${to}`;
  if (serious) console.error(line, event.data);
  else console.info(line);

  return json({ ok: true }, 200);
};

export const ALL: APIRoute = () =>
  json({ ok: false, error: 'Method not allowed.' }, 405);
