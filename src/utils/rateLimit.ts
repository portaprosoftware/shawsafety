/**
 * In-memory sliding-window rate limiter.
 *
 * Free of Astro and OpenAI imports so it can be exercised directly, and it
 * takes `now` as an argument rather than reading the clock, so a test can walk
 * a window forward without sleeping through it.
 *
 * ## What this does and does not protect
 *
 * State lives in the module, which on Vercel means **per warm instance**. Two
 * concurrent instances each enforce the limits independently, and a cold start
 * begins with an empty table. So this is a spend and abuse *brake*, not a
 * guarantee: a determined caller with many IPs, hitting hard enough to fan out
 * across instances, gets more than the numbers below suggest.
 *
 * It is still worth having. The realistic failure here is a script pointed at
 * an unauthenticated endpoint that costs two OpenAI calls per hit, and a
 * per-instance window stops that flat. A hard guarantee needs shared state —
 * Vercel KV or Upstash — which is a credential and a dependency this project
 * does not otherwise have. Swapping one in means reimplementing `check()`
 * against it; nothing outside this file assumes the store is local.
 *
 * Same honesty as the webhook's duplicate suppression, which is best-effort
 * for exactly the same reason.
 */

export interface RateLimitRule {
  /** Requests permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry. Zero when allowed. */
  retryAfter: number;
  /** Which rule rejected the request, for logging. Null when allowed. */
  rule: string | null;
}

/**
 * Timestamps of recent hits, newest last, keyed by caller.
 *
 * A window log rather than a counter: at these limits a key holds a few dozen
 * numbers, and an exact sliding window avoids the edge a fixed bucket has,
 * where a caller spends its whole allowance at the end of one bucket and again
 * at the start of the next.
 */
const hits = new Map<string, number[]>();

/**
 * Ceiling on tracked keys.
 *
 * Without it, one request per forged IP grows the table without bound — the
 * limiter becomes the memory leak it was added to prevent. At the cap the
 * least recently seen keys are dropped, which is the right thing to lose:
 * a key with no recent hits is a caller that is no longer near its limit.
 */
const MAX_KEYS = 10_000;

/** Drop expired timestamps, and the key itself once nothing is left. */
function prune(key: string, now: number, horizonMs: number): number[] {
  const recent = (hits.get(key) ?? []).filter(at => now - at < horizonMs);
  if (recent.length) hits.set(key, recent);
  else hits.delete(key);
  return recent;
}

export interface CheckOptions {
  now?: number;
  /**
   * Whether a passing check consumes the allowance.
   *
   * `false` tests without spending, which is what lets a caller be checked
   * against two independent sets of rules — its own and an instance-wide
   * ceiling — and only charged once both have passed. Charging as it goes
   * would make a request rejected by the second rule still cost the caller its
   * allowance under the first, for a question that was never answered.
   */
  record?: boolean;
}

/**
 * Test a caller against every rule, and record the hit if all of them pass.
 *
 * Nothing is recorded on rejection: a caller who keeps hammering while limited
 * would otherwise push their own window forward on every attempt and never
 * come back — a limiter that turns a burst into a permanent ban.
 */
export function check(
  key: string,
  rules: Record<string, RateLimitRule>,
  { now = Date.now(), record = true }: CheckOptions = {}
): RateLimitResult {
  const entries = Object.entries(rules);
  const horizon = Math.max(...entries.map(([, rule]) => rule.windowMs));
  const recent = prune(key, now, horizon);

  for (const [name, rule] of entries) {
    const inWindow = recent.filter(at => now - at < rule.windowMs);
    if (inWindow.length >= rule.limit) {
      // The oldest hit in the window is the one whose expiry frees a slot.
      const oldest = inWindow[0];
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil((rule.windowMs - (now - oldest)) / 1000)
        ),
        rule: name,
      };
    }
  }

  if (record) {
    if (!hits.has(key) && hits.size >= MAX_KEYS) evictOldest();
    hits.set(key, [...recent, now]);
  }

  return { allowed: true, retryAfter: 0, rule: null };
}

/**
 * Drop the tenth of the table that has been quiet longest.
 *
 * A batch rather than a single key, so a sustained flood of new keys does not
 * pay for a full scan on every request.
 */
function evictOldest(): void {
  const byAge = [...hits.entries()].sort(
    (a, b) => (a[1].at(-1) ?? 0) - (b[1].at(-1) ?? 0)
  );
  for (const [key] of byAge.slice(0, Math.ceil(MAX_KEYS / 10)))
    hits.delete(key);
}

/**
 * Identify the caller.
 *
 * On Vercel every request arrives through the edge, which sets these headers
 * itself and overwrites anything the client sent — so they are trustworthy
 * *there*. Running this behind something that forwards client headers blindly
 * would let a caller pick its own bucket, which is worth knowing before moving
 * the deploy.
 *
 * `x-forwarded-for` may be a chain; the client is the first entry.
 *
 * A request with none of them is bucketed as `unknown`, so the whole
 * unidentifiable population shares one allowance rather than each getting a
 * fresh one.
 */
export function clientKey(request: Request): string {
  const headers = request.headers;
  const direct =
    headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip');
  if (direct?.trim()) return direct.trim();

  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || 'unknown';
}

/** Reset the table. Test seam — not called in production. */
export function reset(): void {
  hits.clear();
}
