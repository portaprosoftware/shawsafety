/**
 * Form submission handler, sends contact and wholesale-quote enquiries by
 * email through Resend.
 *
 * Runs on demand rather than being prerendered: the Resend API key is a server
 * secret and must never be shipped to the browser.
 *
 * Environment (set in Vercel → Project → Settings → Environment Variables):
 *   RESEND_API_KEY  required, `re_...`
 *   RESEND_FROM     required, must be an address on a domain verified in Resend
 *   CONTACT_TO      optional, comma-separated recipients. Defaults to
 *                   sales@shawsafety.com.
 */
import type { APIRoute } from 'astro';
import {
  escapeHtml,
  notificationRecipients,
  sendEmail,
} from '@utils/sendEmail';
import { readEnv } from '@utils/env';
import { check, clientKey } from '@utils/rateLimit';

export const prerender = false;

/** Longest accepted value per field, to bound the payload. */
const MAX = {
  name: 120,
  company: 160,
  email: 200,
  phone: 40,
  message: 5000,
} as const;

interface Submission {
  formType: 'contact' | 'quote';
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * True for a native (non-JS) form post. `fetch` sends `Accept: * / *`, whereas
 * a browser navigating a form asks for HTML, which is how we tell them apart.
 */
function wantsHtml(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * Minimal styled page for the no-JS path. Without this, submitting with
 * scripts disabled dumps raw JSON on screen, the message still sends, but it
 * looks broken.
 */
function htmlResponse(
  title: string,
  message: string,
  status: number
): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Shaw Safety</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;
    font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#171717;padding:24px}
  .card{max-width:34rem;text-align:center}
  h1{color:#9B1C2E;font-size:1.75rem;margin:0 0 .5rem}
  p{color:#525252;line-height:1.6;margin:0 0 1.5rem}
  a{display:inline-block;background:#9B1C2E;color:#fff;text-decoration:none;
    font-weight:700;padding:.75rem 1.5rem;border-radius:.5rem}
</style></head><body><div class="card">
<h1>${title}</h1><p>${message}</p><a href="/">Back to Shaw Safety</a>
</div></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** Answer in whichever format the caller asked for. */
function respond(
  request: Request,
  status: number,
  payload: { ok: boolean; error?: string },
  htmlTitle: string,
  htmlMessage: string
): Response {
  return wantsHtml(request)
    ? htmlResponse(htmlTitle, htmlMessage, status)
    : json(payload, status);
}

/**
 * Trim, cap length, and replace control characters with spaces.
 *
 * Done by character code rather than a regex: escape sequences for control
 * characters are easy to mangle when edited, and a literal NUL in source is
 * both invisible and a syntax hazard.
 */
function clean(value: FormDataEntryValue | null, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out.trim().slice(0, max);
}

/**
 * Deliberately permissive: the aim is to catch typos, not to police valid
 * addresses. Anything stricter rejects real ones.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Per-caller throttle. Contact form submissions cost time and Resend quota;
 * genuine visitors send one, spammers send hundreds. Five per minute leaves
 * room to fix a typo and resubmit while cutting off scripted floods.
 */
const RATE_LIMIT = {
  burst: { limit: 5, windowMs: 60_000 },
} as const;

export const POST: APIRoute = async ({ request }) => {
  // Rate limit before configuration or parsing, an abuser must not force
  // the function to touch the form body or send anything.
  const caller = clientKey(request);
  const gate = await check(`contact:${caller}`, RATE_LIMIT);
  if (!gate.allowed) {
    console.warn(
      `[contact] rate limit hit for ${caller} on ${gate.rule}; retry in ${gate.retryAfter}s`
    );
    return respond(
      request,
      429,
      {
        ok: false,
        error:
          'Too many submissions from your network. Please wait a moment and try again.',
      },
      'Please slow down',
      'We have received several submissions from your network in the last minute. Please wait a moment and try again.'
    );
  }

  // Check configuration before accepting anything: no valid recipient means
  // the enquiry would vanish silently.
  const configured =
    readEnv('RESEND_API_KEY') &&
    readEnv('RESEND_FROM') &&
    notificationRecipients().length > 0;

  if (!configured) {
    // A misconfigured deploy must not look like a delivered message.
    console.error(
      '[contact] Misconfigured: check RESEND_API_KEY, RESEND_FROM, and that ' +
        'CONTACT_TO holds at least one valid address. Refusing the submission.'
    );
    return respond(
      request,
      503,
      {
        ok: false,
        error:
          'Email is not configured yet. Please call (800) 555-0117 or email sales@shawsafety.com.',
      },
      'Not configured yet',
      'Email delivery is not switched on. Please call (800) 555-0117 or email sales@shawsafety.com.'
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Could not read the form.' }, 400);
  }

  // Honeypot: a hidden field real users never see, so anything that fills it
  // is a bot. Answer 200 so the bot cannot tell it was rejected.
  if (clean(form.get('website'), 200)) {
    console.info('[contact] Honeypot triggered; discarding.');
    return respond(
      request,
      200,
      { ok: true },
      'Thanks',
      'We have got your message.'
    );
  }

  const submission: Submission = {
    formType: form.get('formType') === 'quote' ? 'quote' : 'contact',
    name: clean(form.get('name'), MAX.name),
    company: clean(form.get('company'), MAX.company),
    email: clean(form.get('email'), MAX.email),
    phone: clean(form.get('phone'), MAX.phone),
    message: clean(form.get('message'), MAX.message),
  };

  const missing: string[] = [];
  if (!submission.name) missing.push('name');
  if (!submission.email) missing.push('email');
  if (!submission.message) missing.push('message');
  if (missing.length) {
    return respond(
      request,
      400,
      { ok: false, error: `Please fill in: ${missing.join(', ')}.` },
      'Something is missing',
      `Please go back and fill in: ${missing.join(', ')}.`
    );
  }
  if (!looksLikeEmail(submission.email)) {
    return respond(
      request,
      400,
      { ok: false, error: 'That email address looks wrong.' },
      'Check that email',
      'That email address looks wrong. Please go back and try again.'
    );
  }

  const isQuote = submission.formType === 'quote';
  const subject = isQuote
    ? `Bulk quote request: ${submission.company || submission.name}`
    : `Contact form: ${submission.name}`;

  const rows: [string, string][] = [
    ['Name', submission.name],
    ['Company', submission.company || '-'],
    ['Email', submission.email],
    ['Phone', submission.phone || '-'],
  ];

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#171717">
      <h2 style="margin:0 0 4px;color:#9B1C2E">
        ${isQuote ? 'Bulk Quote Request' : 'Contact Form Submission'}
      </h2>
      <p style="margin:0 0 20px;color:#737373;font-size:13px">via Shaw Safety</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([label, value]) =>
              `<tr>
                 <td style="padding:5px 18px 5px 0;color:#737373">${label}</td>
                 <td style="padding:5px 0;font-weight:600">${escapeHtml(value)}</td>
               </tr>`
          )
          .join('')}
      </table>
      <p style="margin:20px 0 6px;color:#737373;font-size:13px">
        ${isQuote ? 'Quantities and requirements' : 'Message'}
      </p>
      <div style="white-space:pre-wrap;border-left:3px solid #9B1C2E;padding:8px 0 8px 14px;font-size:14px">${escapeHtml(
        submission.message
      )}</div>
    </div>`;

  const text = [
    isQuote ? 'Bulk Quote Request' : 'Contact Form Submission',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    submission.message,
  ].join('\n');

  const result = await sendEmail({
    subject,
    html,
    text,
    // Replying to the notification reaches the customer directly.
    replyTo: submission.email,
  });

  if (!result.ok) {
    // Log the provider's reason server-side; never surface it to the visitor.
    console.error(`[contact] ${result.reason}`);
    return respond(
      request,
      502,
      {
        ok: false,
        error:
          'We could not send that just now. Please email sales@shawsafety.com.',
      },
      'That did not send',
      'Something went wrong on our side. Please email sales@shawsafety.com.'
    );
  }

  return respond(
    request,
    200,
    { ok: true },
    'Thanks. We have got it',
    'We reply within one business day.'
  );
};

export const ALL: APIRoute = () =>
  json({ ok: false, error: 'Method not allowed.' }, 405);
