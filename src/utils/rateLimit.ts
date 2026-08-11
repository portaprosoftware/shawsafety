/**
 * Sliding-window rate limiter for public API endpoints.
 *
 * A test one endpoint applies against several rules at once, `/api/ask`
 * enforces a burst rule and an hourly rule per caller, and an instance-wide
 * ceiling on top of that, so the interface takes a `rules` object rather than
 * a single limit and returns the name of the rule that rejected. Two independent
 * peek-then-commit checks then let a request be rejected by the ceiling without
 * charging its per-caller quota for a question that was never answered.
 *
 * Windows are a sliding log rather than a fixed bucket: the boundary of a
 * fixed bucket lets a caller spend its whole allowance at the tail of one
 * bucket and again at the head of the next, doubling the effective rate.
 *
 * ## Backend
 *
 * State is held either in **Upstash Redis** (via its HTTP API, no client SDK)
 * or in a module-scoped map. The module chooses at call time. Set the
 * `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` pair (or one of the
 * common aliases below) and every hit goes to Redis; leave them unset and it
 * runs in memory.
 *
 * The in-memory path only catches repeat calls landing on the same warm
 * serverless instance, so a scripted attacker cycling requests across cold
 * starts gets unlimited quota. It is meaningfully better than nothing, a
 * real user hammering a button hits it every time, but is not a guarantee.
 * The point of the Upstash path is to make the limit actually global. On
 * Upstash failure the limiter fails **open** with a loud log: a Redis outage
 * should not take these endpoints offline for real users, and monitoring
 * picks up a real outage without penalising visitors during a network blip.
 *
 * Server-only. Never import this from client code.
 */
import { readEnv } from './env';

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

export interface CheckOptions {
  now?: number;
  /**
   * Whether a passing check consumes the allowance.
   *
   * `false` tests without spending, which is what lets a caller be checked
   * against two independent sets of rules, its own and an instance-wide
   * ceiling, and only charged once both have passed. Charging as it goes
   * would make a request rejected by the second rule still cost the caller
   * its allowance under the first, for a question that was never answered.
   */
  record?: boolean;
}

/**
 * Backend contract.
 *
 * A store answers one question, "for this key, how many timestamps are
 * still inside each of these windows?", and, on `record`, adds one more.
 * The reject/allow decision itself lives in `check()`, so both backends stay
 * dumb: no rule vocabulary, no logging, no HTTP.
 */
interface Store {
  countsAndMaybeRecord(
    key: string,
    now: number,
    windowsMs: number[],
    record: boolean
  ): Promise<number[]>;
}

/* ────────────────────────────── memory backend ─────────────────────────── */

/*
 * Timestamps of recent hits, newest last, keyed by caller. A window log
 * rather than a counter: at these limits a key holds a few dozen numbers,
 * and an exact sliding window avoids the fixed-bucket edge.
 */
const hits = new Map<string, number[]>();

/**
 * Ceiling on tracked keys.
 *
 * Without it, one request per forged IP grows the table without bound, the
 * limiter becomes the memory leak it was added to prevent. At the cap the
 * least recently seen keys are dropped, which is the right thing to lose:
 * a key with no recent hits is a caller that is no longer near its limit.
 */
const MAX_KEYS = 10_000;

/** Drop the tenth of the table that has been quiet longest. */
function evictOldest(): void {
  const byAge = [...hits.entries()].sort(
    (a, b) => (a[1].at(-1) ?? 0) - (b[1].at(-1) ?? 0)
  );
  for (const [key] of byAge.slice(0, Math.ceil(MAX_KEYS / 10)))
    hits.delete(key);
}

const memoryStore: Store = {
  async countsAndMaybeRecord(key, now, windowsMs, record) {
    const horizon = Math.max(...windowsMs);
    const kept = (hits.get(key) ?? []).filter(at => now - at < horizon);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);

    const counts = windowsMs.map(w => kept.filter(at => now - at < w).length);

    if (record) {
      if (!hits.has(key) && hits.size >= MAX_KEYS) evictOldest();
      hits.set(key, [...kept, now]);
    }

    return counts;
  },
};

/* ────────────────────────────── Upstash backend ────────────────────────── */

interface UpstashConfig {
  url: string;
  token: string;
  source: string;
}

/**
 * Env-var names to try, in order.
 *
 * The bare names are the ones this repo documents and expects. The `KV_*`
 * pair matches Vercel's older KV integration. The absurd
 * `UPSTASH_REDIS_REST_KV_REST_API_*` names are what the current Vercel
 * Marketplace integration for Upstash actually injects, the Marketplace
 * prefixes every variable with the storage slug, and the integration's slug
 * happens to be `UPSTASH_REDIS_REST`. Recognising all three means a real
 * deploy works without adding manual aliases in the dashboard.
 */
const URL_VARS = [
  'UPSTASH_REDIS_REST_URL',
  'KV_REST_API_URL',
  'UPSTASH_REDIS_REST_KV_REST_API_URL',
] as const;

const TOKEN_VARS = [
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_KV_REST_API_TOKEN',
] as const;

function upstashConfig(): UpstashConfig | null {
  for (const urlVar of URL_VARS) {
    const url = readEnv(urlVar);
    if (!url) continue;
    for (const tokVar of TOKEN_VARS) {
      const token = readEnv(tokVar);
      if (token) {
        return {
          url: url.replace(/\/+$/, ''),
          token,
          source: `${urlVar}+${tokVar}`,
        };
      }
    }
  }
  return null;
}

/**
 * Sliding window against a Redis sorted set.
 *
 * ZREMRANGEBYSCORE prunes everything outside the widest window, ZCOUNT
 * measures each window individually, ZADD records the new hit with a member
 * unique enough to collide-proof (score is the timestamp, member includes a
 * random tail), and EXPIRE gives the whole key a hard TTL so a key that
 * stops being written to eventually vanishes. All in one pipeline call.
 */
async function upstashCountsAndMaybeRecord(
  cfg: UpstashConfig,
  key: string,
  now: number,
  windowsMs: number[],
  record: boolean
): Promise<number[]> {
  const horizon = Math.max(...windowsMs);
  const commands: unknown[][] = [
    ['ZREMRANGEBYSCORE', key, '-inf', String(now - horizon)],
  ];
  for (const w of windowsMs) {
    commands.push(['ZCOUNT', key, String(now - w), String(now)]);
  }
  if (record) {
    // Member must be unique per ZADD, so a random tail is appended. Score is
    // still the raw timestamp. That is what the window is measured against.
    const member = `${now}-${Math.floor(Math.random() * 1e9)}`;
    commands.push(['ZADD', key, String(now), member]);
    // Expiry is a hair over the horizon so an idle key gets cleaned up but
    // an active one is never truncated while a rule still cares about it.
    commands.push(['EXPIRE', key, String(Math.ceil(horizon / 1000) + 5)]);
  }

  let response: Response;
  try {
    response = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    console.error('[rateLimit] Upstash unreachable, failing open:', error);
    // Fail open: return zero counts so the request is allowed.
    return windowsMs.map(() => 0);
  }

  if (!response.ok) {
    console.error(
      '[rateLimit] Upstash returned',
      response.status,
      await response.text().catch(() => '(no body)')
    );
    return windowsMs.map(() => 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.error('[rateLimit] Upstash response was not JSON:', error);
    return windowsMs.map(() => 0);
  }

  if (!Array.isArray(payload)) return windowsMs.map(() => 0);
  // The first result is the ZREMRANGEBYSCORE we do not read; the ZCOUNTs
  // follow in order.
  const counts: number[] = [];
  for (let i = 0; i < windowsMs.length; i++) {
    const entry = payload[i + 1] as { result?: unknown } | undefined;
    const n = typeof entry?.result === 'number' ? entry.result : 0;
    // If we are recording, the new hit lands after the ZCOUNTs, so add one to
    // reflect the state a subsequent peek would see. That keeps peek/record
    // pairs consistent whether they run in memory or against Redis.
    counts.push(record ? n + 1 : n);
  }
  return counts;
}

function upstashStore(cfg: UpstashConfig): Store {
  return {
    countsAndMaybeRecord: (key, now, windowsMs, record) =>
      upstashCountsAndMaybeRecord(cfg, key, now, windowsMs, record),
  };
}

/* ──────────────────────────────── public API ───────────────────────────── */

function pickStore(): Store {
  const cfg = upstashConfig();
  return cfg ? upstashStore(cfg) : memoryStore;
}

/**
 * Test a caller against every rule, and record the hit if all of them pass.
 *
 * Nothing is recorded on rejection: a caller who keeps hammering while
 * limited would otherwise push their own window forward on every attempt and
 * never come back, a limiter that turns a burst into a permanent ban.
 */
export async function check(
  key: string,
  rules: Record<string, RateLimitRule>,
  { now = Date.now(), record = true }: CheckOptions = {}
): Promise<RateLimitResult> {
  const entries = Object.entries(rules);
  const windowsMs = entries.map(([, r]) => r.windowMs);

  const store = pickStore();
  const counts = await store.countsAndMaybeRecord(
    key,
    now,
    windowsMs,
    // Read first, without recording, the write only happens if every rule
    // passes.
    false
  );

  for (let i = 0; i < entries.length; i++) {
    const [name, rule] = entries[i]!;
    if (counts[i]! >= rule.limit) {
      // The window is w wide; the oldest slot expires roughly now - w + 1s.
      const retryAfter = Math.max(1, Math.ceil(rule.windowMs / 1000));
      return { allowed: false, retryAfter, rule: name };
    }
  }

  if (record) {
    await store.countsAndMaybeRecord(key, now, windowsMs, true);
  }

  return { allowed: true, retryAfter: 0, rule: null };
}

/**
 * Identify the caller.
 *
 * On Vercel every request arrives through the edge, which sets these headers
 * itself and overwrites anything the client sent, so they are trustworthy
 * *there*. Running this behind something that forwards client headers
 * blindly would let a caller pick its own bucket, which is worth knowing
 * before moving the deploy.
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
  if (first) return first;

  return 'unknown';
}

/**
 * Report which backend the limiter would use right now, without spending a
 * call. Consumed by the GET diagnostic on the endpoints.
 */
export function backendInfo(): {
  backend: 'upstash' | 'memory';
  source: string | null;
} {
  const cfg = upstashConfig();
  return cfg
    ? { backend: 'upstash', source: cfg.source }
    : { backend: 'memory', source: null };
}

/**
 * Test hook. Not part of the public interface, the in-memory store is a
 * module-scoped singleton and tests need a way to reset it between cases so
 * one case does not exhaust another's quota.
 */
export function __resetForTests(): void {
  hits.clear();
}
