/**
 * Grounded question answering over the Shaw Safety knowledge corpus.
 *
 * POST { question, history? } → { ok, answer, sources }
 *
 * Retrieval-augmented rather than a bare model call: prices, tier breakpoints,
 * and compliance marks are exactly the facts a general model will invent
 * plausibly and wrongly, and a wrong price quoted by the site is a wrong price
 * the customer will expect to pay. Everything the answer may contain comes
 * from src/content/knowledge, retrieved per question.
 *
 * The route exists so the OpenAI key stays on the server; it is billable and
 * calling the API from the page would publish it to anyone with devtools.
 *
 * Environment (set in Vercel → Project → Settings → Environment Variables):
 *   OPENAI_API_KEY     required. Server-only; never prefix with PUBLIC_.
 *   OPENAI_CHAT_MODEL  optional, defaults to gpt-4o-mini.
 *
 * The retrieval index is built separately by `pnpm rag:index` and committed.
 */
import type { APIRoute } from 'astro';
import { readEnv } from '@utils/env';
import { formatContext, ragIndex, retrieve } from '@utils/rag';
import { check, clientKey, type RateLimitRule } from '@utils/rateLimit';

export const prerender = false;

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';

/** Chunks handed to the model per question. */
const TOP_K = 5;

/**
 * A question longer than this is not a question.
 *
 * Bounds what an unauthenticated caller can push through a billable API, and
 * the ceiling is generous — a buyer pasting a terminal's seal specification
 * into the box is a use worth supporting.
 */
const MAX_QUESTION_CHARS = 800;

/** Prior turns kept for context. Retrieval still runs on the latest question. */
const MAX_HISTORY_TURNS = 6;

/** Give up rather than hold a serverless function open indefinitely. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * Per-caller limits.
 *
 * Sized against how a person actually uses the widget: a real conversation is
 * a handful of questions with reading in between, so the burst rule barely
 * exists for them and bites immediately on a script. The hourly rule is the
 * one that bounds a day's worth of spend from a single source.
 *
 * Both are enforced per warm instance — see the note in @utils/rateLimit for
 * what that does and does not guarantee.
 */
const PER_CALLER: Record<string, RateLimitRule> = {
  burst: { limit: 6, windowMs: 60_000 },
  hourly: { limit: 40, windowMs: 60 * 60_000 },
};

/**
 * Instance-wide ceiling, on top of the per-caller rules.
 *
 * The per-caller limit is only as good as the caller's identity, and a
 * distributed source — or anything that reaches this without the edge setting
 * the forwarding headers — presents as many identities. This is the backstop
 * that bounds total spend regardless of how the traffic is spread. It is
 * generous enough that legitimate traffic will not reach it: forty simultaneous
 * conversations at the per-caller hourly limit still fit.
 */
const GLOBAL: Record<string, RateLimitRule> = {
  global: { limit: 600, windowMs: 60 * 60_000 },
};

/** Bucket every request shares, for the ceiling above. */
const GLOBAL_KEY = '__all__';

const SYSTEM_PROMPT = `You are the assistant for Shaw Safety, a direct supplier of fluorescent security zip ties and ANSI Class 2 hi-vis safety vests.

Answer using ONLY the numbered context passages provided. They are extracts from the Shaw Safety website.

Rules:
- If the context does not contain the answer, say so plainly and point the person to sales@shawsafety.com or (800) 555-0117. Never guess.
- Never invent or adjust a price, tier breakpoint, SKU, specification, or compliance mark. Quote them exactly as written in the context.
- Cite the passages you used with bracketed numbers, e.g. [1] or [2][3], placed at the end of the sentence they support.
- Be brief and concrete: two or three short paragraphs at most, and use a list when the answer is a set of numbers.
- Write in plain American English, in the same direct voice as the site. Do not use marketing filler.
- You take orders for nobody: if asked to place, change, or cancel an order, or to approve terms or a discount, explain that a person handles that and give the contact details.`;

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** "in 45 seconds" / "in 3 minutes" — a wait a person can act on. */
function humanWait(seconds: number): string {
  if (seconds < 90) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Answer GET rather than letting the router 404.
 *
 * Opening the endpoint in a browser is the first thing anyone does when the
 * assistant misbehaves, and the two things worth checking from outside are
 * whether the key is set and whether an index has been built and deployed.
 * Neither the key nor the corpus text is echoed.
 */
export const GET: APIRoute = () =>
  json(
    {
      ok: false,
      error: 'Method not allowed. POST { question } as JSON.',
      configured: Boolean(readEnv('OPENAI_API_KEY')),
      index: ragIndex
        ? {
            chunks: ragIndex.chunks.length,
            model: ragIndex.model,
            dimensions: ragIndex.dimensions,
            generatedAt: ragIndex.generatedAt,
          }
        : null,
    },
    405
  );

interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Keep only well-formed recent turns; anything else is dropped silently. */
function sanitizeHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is HistoryTurn =>
        !!turn &&
        typeof turn === 'object' &&
        ((turn as HistoryTurn).role === 'user' ||
          (turn as HistoryTurn).role === 'assistant') &&
        typeof (turn as HistoryTurn).content === 'string' &&
        (turn as HistoryTurn).content.trim().length > 0
    )
    .slice(-MAX_HISTORY_TURNS)
    .map(turn => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_QUESTION_CHARS),
    }));
}

async function embedQuestion(
  question: string,
  apiKey: string
): Promise<number[] | null> {
  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    /*
     * Model and width come from the index rather than from a constant here.
     * Vectors are only comparable to vectors from the same model at the same
     * width, and pinning them separately in two files is how they drift.
     */
    body: JSON.stringify({
      model: ragIndex!.model,
      input: question,
      dimensions: ragIndex!.dimensions,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(
      `[ask] embeddings returned ${response.status}`,
      await response.text().catch(() => '(no body)')
    );
    return null;
  }

  const payload = (await response.json()) as {
    data?: { embedding?: number[] }[];
  };
  return payload.data?.[0]?.embedding ?? null;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = readEnv('OPENAI_API_KEY');

  /*
   * Misconfiguration is reported as misconfiguration rather than as a failed
   * answer: without this the assistant looks broken to a visitor and
   * mysterious to whoever has to debug it.
   */
  if (!apiKey) {
    console.error('[ask] OPENAI_API_KEY is not set');
    return json(
      {
        ok: false,
        error:
          'The assistant is not configured. Email sales@shawsafety.com and we will answer directly.',
      },
      503
    );
  }

  if (!ragIndex || ragIndex.chunks.length === 0) {
    console.error('[ask] no retrieval index — run `pnpm rag:index` and deploy');
    return json(
      {
        ok: false,
        error:
          'The assistant is not configured. Email sales@shawsafety.com and we will answer directly.',
      },
      503
    );
  }

  /*
   * Limits are checked before the body is read, so a flood is rejected without
   * this route parsing anything — and long before either OpenAI call.
   *
   * Both sets of rules are tested before either is charged, so a request the
   * instance ceiling turns away does not also spend the caller's own
   * allowance on a question that was never answered.
   */
  const caller = clientKey(request);
  const now = Date.now();
  const callerLimit = check(caller, PER_CALLER, { now, record: false });
  const limited = callerLimit.allowed
    ? check(GLOBAL_KEY, GLOBAL, { now, record: false })
    : callerLimit;

  if (limited.allowed) {
    check(caller, PER_CALLER, { now });
    check(GLOBAL_KEY, GLOBAL, { now });
  }

  if (!limited.allowed) {
    // Logged at warn, not error: being rate limited is the system working.
    // The caller is logged because a sustained block is worth being able to
    // trace to a source.
    console.warn(
      `[ask] rate limited ${caller} on ${limited.rule}, retry in ${limited.retryAfter}s`
    );
    return json(
      {
        ok: false,
        error:
          limited.rule === 'global'
            ? `The assistant is busy right now. Try again ${humanWait(limited.retryAfter)}, or call (800) 555-0117.`
            : `That is a lot of questions at once. Try again ${humanWait(limited.retryAfter)}, or call (800) 555-0117 — Mon–Fri, 7am–6pm CT.`,
        retryAfter: limited.retryAfter,
      },
      429,
      { 'Retry-After': String(limited.retryAfter) }
    );
  }

  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Send JSON with a question.' }, 400);
  }

  const question =
    typeof body.question === 'string' ? body.question.trim() : '';

  if (!question) {
    return json({ ok: false, error: 'Ask a question first.' }, 400);
  }

  if (question.length > MAX_QUESTION_CHARS) {
    return json(
      {
        ok: false,
        error: `That is longer than the assistant takes. Trim it to ${MAX_QUESTION_CHARS} characters, or email sales@shawsafety.com.`,
      },
      413
    );
  }

  const history = sanitizeHistory(body.history);

  let queryEmbedding: number[] | null;
  try {
    queryEmbedding = await embedQuestion(question, apiKey);
  } catch (error) {
    console.error('[ask] embedding request failed:', error);
    return json({ ok: false, error: 'Could not reach the assistant.' }, 502);
  }

  if (!queryEmbedding) {
    return json({ ok: false, error: 'Could not reach the assistant.' }, 502);
  }

  const hits = retrieve(queryEmbedding, { k: TOP_K });

  /*
   * Nothing retrieved means the corpus has nothing to say. Answering anyway
   * from an empty context is precisely how a storefront assistant ends up
   * inventing a return window, so the route declines instead — and does it
   * without spending a completion call.
   */
  if (hits.length === 0) {
    return json(
      {
        ok: true,
        answer:
          'I do not have anything on that. For anything outside what is published on the site, email sales@shawsafety.com or call (800) 555-0117 — Monday to Friday, 7am–6pm CT.',
        sources: [],
      },
      200
    );
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user' as const,
      content: `Context passages:\n\n${formatContext(hits)}\n\n---\n\nQuestion: ${question}`,
    },
  ];

  let response: Response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: readEnv('OPENAI_CHAT_MODEL') || DEFAULT_CHAT_MODEL,
        messages,
        // Low but not zero: the answers are factual restatements, and the
        // wording should not wander between two people asking the same thing.
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[ask] completion request failed:', error);
    return json({ ok: false, error: 'Could not reach the assistant.' }, 502);
  }

  if (!response.ok) {
    // Logged, not returned: an upstream error body can name the account or its
    // quota state, which is nothing a visitor should see.
    console.error(
      `[ask] chat completions returned ${response.status}`,
      await response.text().catch(() => '(no body)')
    );
    return json({ ok: false, error: 'Could not answer that just now.' }, 502);
  }

  let answer: string;
  try {
    const payload = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    answer = typeof content === 'string' ? content.trim() : '';
  } catch (error) {
    console.error('[ask] unreadable response from OpenAI:', error);
    return json({ ok: false, error: 'Could not answer that just now.' }, 502);
  }

  if (!answer) {
    return json({ ok: false, error: 'Could not answer that just now.' }, 502);
  }

  /*
   * Sources are returned for every retrieved passage in citation order, so a
   * caller can render "[2]" as a link to the page it came from. Scores ride
   * along because they are the only signal available for tuning the retrieval
   * threshold against real questions.
   */
  return json(
    {
      ok: true,
      answer,
      sources: hits.map((hit, i) => ({
        n: i + 1,
        title: hit.chunk.sourceLabel,
        url: hit.chunk.url,
        score: Number(hit.score.toFixed(3)),
      })),
    },
    200
  );
};
