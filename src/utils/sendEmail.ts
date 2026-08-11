/**
 * Outbound email via Resend.
 *
 * Shared by the contact/quote forms and the Stripe order webhook so recipient
 * parsing and configuration checks exist once.
 *
 * Server-only: reads RESEND_API_KEY, which must never reach the browser.
 */
import { readEnv } from './env';

/** Resend rejects a request with more recipients than this. */
const MAX_RECIPIENTS = 50;

export interface SendResult {
  ok: boolean;
  /** Why it failed, for logging. Never shown to a visitor. */
  reason?: string;
}

/**
 * Parse CONTACT_TO into a recipient list.
 *
 * Comma-separated so notifications can reach several people without a code
 * change. Invalid entries are dropped rather than passed through, one typo
 * would otherwise make Resend reject the whole send, taking the valid
 * recipients down with it.
 */
export function parseRecipients(raw: string): string[] {
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
    .slice(0, MAX_RECIPIENTS);
}

/** Recipients for team notifications, from CONTACT_TO. */
export function notificationRecipients(): string[] {
  return parseRecipients(readEnv('CONTACT_TO') || 'sales@shawsafety.com');
}

/**
 * Header injection guard. A newline in a header value lets an attacker append
 * their own headers, so a value containing one is dropped rather than
 * sanitised.
 */
export function safeHeaderValue(value: string): string | null {
  return /[\r\n]/.test(value) ? null : value;
}

/** Escape for interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEmail(message: {
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}): Promise<SendResult> {
  const apiKey = readEnv('RESEND_API_KEY');
  const from = readEnv('RESEND_FROM');
  const to = notificationRecipients();

  if (!apiKey || !from || to.length === 0) {
    return {
      ok: false,
      reason:
        'Misconfigured: check RESEND_API_KEY, RESEND_FROM, and that CONTACT_TO holds at least one valid address.',
    };
  }

  const replyTo = message.replyTo ? safeHeaderValue(message.replyTo) : null;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      // Resend rejects a From address whose domain is not verified on the
      // account. The sending domain is mail.portaprosoftware.com, not the
      // apex portaprosoftware.com, an address on the apex looks correct and
      // still fails, so name the cause rather than leaving the raw body.
      const hint = /domain is not verified/i.test(body)
        ? ` RESEND_FROM is "${from}"; it must be an address on a domain verified in Resend (mail.portaprosoftware.com).`
        : '';
      return {
        ok: false,
        reason: `Resend responded ${response.status}: ${body}${hint}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Request to Resend failed: ${error}` };
  }
}
