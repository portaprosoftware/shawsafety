/**
 * Per-IP rate limiting for public API endpoints.
 *
 * Serverless functions do not share memory — one invocation cannot see what
 * another handled — so any limit that has to hold across requests needs shared
 * state. This module prefers Upstash Redis (via its HTTP API, no client SDK)
 * and falls back to an in-memory map when Upstash is not configured.
 *
 * In-memory is best-effort: it only catches repeat calls landing on the same
 * warm instance, so a scripted attacker cycling requests across cold starts
 * gets unlimited quota. It is still meaningfully better than nothing — a real
 * user hammering the button hits it every time — but the whole point of the
 * Upstash path is to make the limit actually global.
 *
 * Server-only. Never import this from client code.
 */
import { readEnv } from './env';

export interface Options {
  /** Maximum requests allowed per IP per window. */
  limit: number;
  /** Window size, in seconds. */
  windowSec: number;
}

export interface Result {
  allowed: boolean;
  /** Seconds until the window rolls over, sent as `Retry-After` on 429. */
  retryAfterSec: number;
  /** Requests still available in the current window. */
  remaining: number;
}

/**
 * Resolve the client's IP.
 *
 * Astro's `clientAddress` already respects `x-forwarded-for` under the Vercel
 * adapter — Vercel's edge rewrites that header on the way in, so a client
 * cannot spoof it. The direct-header reads are a fallback for other adapters
 * or for calls made from routes that do not pass `clientAddress` through.
 *
 * `unknown` collapses every unidentified caller onto one bucket, which is on
 * purpose: it means a request without a resolvable IP still counts against
 * something, rather than getting a free pass.
 */
export function resolveIp(request: Request, clientAddress?: string): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // The list is client, proxy1, proxy2, …; the client is first.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xreal = request.headers.get('x-real-ip');
  if (xreal) return xreal.trim();
  if (clientAddress) return clientAddress;
  return 'unknown';
}

/*
 * In-memory bucket store. Module-scoped so it survives across requests on the
 * same warm serverless instance; a cold start starts empty, which is the
 * documented limitation of this path.
 */
interface Bucket {
  count: number;
  expiresAt: number;
}
const memory = new Map<string, Bucket>();

/**
 * Cap on the map's size, so a random flood of unique IPs cannot grow it
 * without bound and OOM the function. Evicts the entry that was inserted
 * first, matching a rough LRU under append-only writes.
 */
const MEMORY_MAX_KEYS = 5000;

function memoryIncr(key: string, ttlSec: number): number {
  const now = Date.now();

  const existing = memory.get(key);
  if (existing && existing.expiresAt > now) {
    existing.count += 1;
    return existing.count;
  }

  if (memory.size >= MEMORY_MAX_KEYS) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { count: 1, expiresAt: now + ttlSec * 1000 });
  return 1;
}

interface UpstashConfig {
  url: string;
  token: string;
}

function upstashConfig(): UpstashConfig | null {
  const url = readEnv('UPSTASH_REDIS_REST_URL');
  const token = readEnv('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

/**
 * Atomic INCR + EXPIRE against Upstash.
 *
 * `EXPIRE key ttl NX` only sets the TTL when there is not one already, so the
 * window starts from the first hit and never gets extended by later ones in
 * the same window — a stable fixed-window bucket. The pipeline endpoint runs
 * both commands in one round trip.
 *
 * Fails open: an Upstash outage should not take dictation offline for real
 * users. Logged loudly so the operator notices and either fixes it or
 * tightens the failure mode.
 */
async function upstashIncr(
  cfg: UpstashConfig,
  key: string,
  ttlSec: number
): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(ttlSec), 'NX'],
      ]),
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    console.error('[rateLimit] Upstash unreachable, failing open:', error);
    return 1;
  }

  if (!response.ok) {
    console.error(
      '[rateLimit] Upstash returned',
      response.status,
      await response.text().catch(() => '(no body)')
    );
    return 1;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.error('[rateLimit] Upstash response was not JSON:', error);
    return 1;
  }

  const first = Array.isArray(payload) ? payload[0] : null;
  const result = (first as { result?: unknown } | null)?.result;
  return typeof result === 'number' ? result : 1;
}

/**
 * Consume one hit against a rate-limit bucket.
 *
 * `scope` names the endpoint (`transcribe`, `contact`), so two endpoints on
 * the same IP cannot exhaust each other's quota. Buckets are aligned to fixed
 * `windowSec` intervals — trivially predictable, occasionally lets a burst
 * across the window boundary through, and correct enough for anti-abuse on
 * this shape of endpoint.
 */
export async function check(
  scope: string,
  ip: string,
  opts: Options
): Promise<Result> {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / opts.windowSec);
  const retryAfterSec = (bucket + 1) * opts.windowSec - nowSec;
  const key = `rl:${scope}:${ip}:${bucket}`;

  const cfg = upstashConfig();
  const count = cfg
    ? await upstashIncr(cfg, key, opts.windowSec)
    : memoryIncr(key, opts.windowSec);

  const allowed = count <= opts.limit;
  return {
    allowed,
    retryAfterSec: allowed ? 0 : retryAfterSec,
    remaining: Math.max(0, opts.limit - count),
  };
}

/**
 * Standard 429 response body. `Retry-After` in seconds — a real seconds value,
 * per RFC 9110, so clients can back off automatically.
 */
export function tooManyRequests(result: Result, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(1, result.retryAfterSec)),
    },
  });
}

/**
 * Test hook. Not part of the public interface — the in-memory store is a
 * module-scoped singleton and tests need a way to reset it between cases so
 * one case does not exhaust another's quota.
 */
export function __resetForTests(): void {
  memory.clear();
}
