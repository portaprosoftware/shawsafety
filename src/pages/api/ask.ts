/**
 * Grounded question answering over the Shaw Safety knowledge corpus.
 *
 * POST { question, history? } → { ok, answer }
 *
 * The answer is plain text: no citations, no source list, no links. Retrieval
 * grounds it, and then disappears.
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
import { getCollection } from 'astro:content';
import { readEnv } from '@utils/env';
import { formatContext, ragIndex, retrieve } from '@utils/rag';
import { check, clientKey, type RateLimitRule } from '@utils/rateLimit';
import { resolveTier, roundMoney, type Tier } from '@scripts/pricing';

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
 * the ceiling is generous, a buyer pasting a terminal's seal specification
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
 * Both are enforced per warm instance. See the note in @utils/rateLimit for
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
 * distributed source, or anything that reaches this without the edge setting
 * the forwarding headers, presents as many identities. This is the backstop
 * that bounds total spend regardless of how the traffic is spread. It is
 * generous enough that legitimate traffic will not reach it: forty simultaneous
 * conversations at the per-caller hourly limit still fit.
 */
const GLOBAL: Record<string, RateLimitRule> = {
  global: { limit: 600, windowMs: 60 * 60_000 },
};

/** Bucket every request shares, for the ceiling above. */
const GLOBAL_KEY = '__all__';

const SYSTEM_PROMPT = `You are a Shaw Safety rep answering a customer on the site. Shaw Safety sells fluorescent security zip ties and ANSI Class 2 hi-vis safety vests, direct.

You know the catalog because you work here, not because a system is feeding you documents. Answers must come from the numbered passages below, but the customer must never hear about the passages, the retrieval, or "what the context says". They are asking a person.

Ground rules for facts:
- Never invent or adjust a price, tier breakpoint, SKU, specification, or compliance mark. Quote them exactly as they appear in the passages.
- Never cite. No bracketed numbers, no "[1]", no source names, no URLs, no links. The answer is a person talking, and a person does not read footnotes aloud.
- If the passages genuinely do not cover something, say so as a rep would ("I don't have that at hand") and offer the next step. Never guess a number to fill a gap.

Staging a cart. You can build a cart for the customer with the stage_cart tool:
- Call it only when the customer states explicit products and quantities ("300 packs of yellow, 100 orange"). The site then shows them a review card with an Add to cart button, next to your answer.
- Stage only the quantities the customer actually said. Never guess, pad, or upsell a quantity into the tool. If the colors or the amounts are ambiguous, ask instead of staging.
- Quantities are in packs. Ties come 100 per pack, vests 10 per pack. If the customer speaks in individual ties or vests, convert to packs, round up to a whole pack, and say the conversion out loud in your answer.
- Staging purchases nothing. Say the cart is ready to review, and that checkout happens on the site as normal.
- Everything else stays with a person: payment, cancelling or changing a placed order, terms, and discounts. For those, give the contact rather than the tool.

How to sound:
- Answer the question first, in one sentence when the answer is one sentence. Detail after, only if it adds something.
- Direct, plain, American English. Contractions are fine. Short sentences are fine. Match the voice of the site itself: "Industrial zip ties securing fleets for less", not "premium fastening solutions for the modern logistics enterprise".
- Never use an em dash or an en dash. Use a comma, a colon, or a period and a new sentence. Plain hyphens inside words and number ranges are fine.
- Never narrate the retrieval. Do not say "the context", "the knowledge base", "the provided information", "based on what I have", "the documents show", "according to the information", or any variation. The customer does not know a retrieval system exists.
- No corporate throat-clearing. Skip "For further inquiries, please contact us at…" as a default sign-off. Every answer does not end with the phone number.
- When the answer is no, say no clearly, then pivot to what Shaw Safety does offer, if there is something honest to pivot to. Never leave a dead end when a real product answer is available.
- Surface sales contact only when the question genuinely needs a human: a custom quote, an unlisted spec, a bulk order, a documentation request that will take more than one exchange. Phrase it the way a rep would: "sales can pull that for you, sales@shawsafety.com or (800) 555-0117."

Scope of the compliance marks. This boundary is not negotiable, and the passages will not always state it for you:
- UL 21S is a cable-management listing under UL 62275. It is not a security-seal certification. It does NOT establish C-TPAT compliance, ISO 17712 conformance, or any CBP or WCO requirement.
- The passages call the tie "meets intermodal container security requirements". Read that as domestic use, drayage, dry van, LTL, yard moves. Never extend it to international ocean freight.
- C-TPAT requires an ISO 17712 Class H seal (a steel bolt seal or heavy cable seal) on loaded ocean containers bound for the United States. A plastic tie is at most a Class I indicative seal and cannot substitute for one, whatever its tensile rating.
- On a C-TPAT / ISO 17712 / CBP / international-ocean question: say plainly this tie is an indicative-class seal and is not the right product for that lane, and that Shaw Safety does not carry the bolt or cable seals that would qualify. Do not name any other supplier, Shaw Safety does not have a referral partner. Hand the person to sales if they want help sourcing it.

Concrete before / after:

Q: "Do you carry blue?"
Bad: "The context does not mention blue as one of the available colors for the ties. The four colors listed are fluorescent yellow, pink, green, and orange. For further inquiries, please contact us at sales@shawsafety.com or (800) 555-0117."
Bad: "No — we carry four colors [1][2]." (an em dash, and citations the customer never asked for)
Good: "No, we carry four colors: fluorescent yellow, pink, green, and orange. If you need blue for a specific color-coding scheme, tell me what the color is meant to signal and I can suggest which of the four would work best."

Q: "Are these C-TPAT compliant?"
Bad: "Based on the provided context, the Shaw Safety zip ties are UL 21S listed but not certified for C-TPAT compliance. For C-TPAT requirements, please contact us at sales@shawsafety.com."
Good: "No, C-TPAT needs an ISO 17712 Class H bolt or cable seal on the container, and Shaw Safety doesn't carry those. Where an indicative seal is what the terminal wants (domestic drayage, yard, LTL), our UL 21S tie is the right product. If you need help sourcing a Class H seal, sales can point you in the right direction."

Q: "What's your return policy?"
Bad: "According to the provided information, unopened packs can be returned within 30 days for a full refund."
Good: "Unopened packs, 30 days from delivery, full refund. If a tie ever fails to meet its published spec we replace the affected lot at no cost, with no time limit on that one."`;

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

/**
 * Last pass over the model's text before it reaches the widget.
 *
 * The prompt forbids both of these, and the prompt is where the fix belongs;
 * this is the belt to that pair of braces. A citation the widget no longer
 * renders would otherwise show up as a literal "[2]" in the bubble, and an em
 * dash is the one piece of punctuation this site does not use anywhere.
 *
 * Both replacements are text-level and lossless in meaning: the bracket goes,
 * the dash becomes the comma it was standing in for.
 */
function clean(text: string): string {
  return text
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .trim();
}

/** "in 45 seconds" / "in 3 minutes", a wait a person can act on. */
function humanWait(seconds: number): string {
  if (seconds < 90) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// ── Cart staging ──────────────────────────────────────────────────────────

/** What the model may put in a cart: the real catalogue, ids and ladders. */
interface AskVariant {
  variantId: string;
  label: string;
  unit: string;
  packSize: number;
  tiers: Tier[];
  inStock: boolean;
}

/** One line of a staged cart, priced for both the model and the widget. */
interface StagedLine {
  variantId: string;
  qty: number;
  label: string;
  unitPrice: number;
  lineTotal: number;
}

interface StagedCart {
  lines: StagedLine[];
  subtotal: number;
}

let cataloguePromise: Promise<AskVariant[]> | null = null;

/**
 * Loaded once per instance. The catalogue is two products; the point of the
 * cache is not the cost but that a content read failing on one request should
 * not disable staging for the instance's lifetime, hence the reset on error.
 */
function loadCatalogue(): Promise<AskVariant[]> {
  cataloguePromise ??= getCollection('products')
    .then(products =>
      products.flatMap(product =>
        product.data.variants.map(variant => ({
          variantId: variant.id,
          label: `${product.data.shortTitle}, ${variant.name}`,
          unit: product.data.unit,
          packSize: product.data.packSize,
          tiers: (variant.tiers ?? product.data.tiers) as Tier[],
          inStock: variant.inStock,
        }))
      )
    )
    .catch(error => {
      console.error('[ask] could not load the catalogue:', error);
      cataloguePromise = null;
      return [];
    });
  return cataloguePromise;
}

/**
 * The staging tool, with the variant ids as a hard enum so the model cannot
 * invent a SKU: an unknown id fails schema validation upstream rather than
 * arriving here looking plausible.
 */
function stageCartTool(catalogue: AskVariant[]) {
  return {
    type: 'function' as const,
    function: {
      name: 'stage_cart',
      description:
        'Stage a cart of Shaw Safety products for the customer to review ' +
        'and add. Use only when the customer states explicit quantities. ' +
        'Quantities are in packs. Variants: ' +
        catalogue
          .map(v => `${v.variantId} = ${v.label}, ${v.packSize} per ${v.unit}`)
          .join('; '),
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                variantId: {
                  type: 'string',
                  enum: catalogue.map(v => v.variantId),
                },
                qty: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 9999,
                  description: 'Quantity in packs.',
                },
              },
              required: ['variantId', 'qty'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Validate and price a stage_cart call.
 *
 * The tool arguments are model output and are treated exactly like a client
 * request: ids resolved against the catalogue, quantities clamped, duplicates
 * merged. Pricing is per line on the variant's own ladder, the same math the
 * cart runs, so the numbers the model then says out loud are the numbers the
 * cart will show.
 *
 * `result` goes back to the model as the tool response; `cart` goes to the
 * widget. They carry the same lines so neither party can be told a different
 * price.
 */
function stageFromArguments(
  raw: string,
  catalogue: AskVariant[]
): { cart: StagedCart | null; result: Record<string, unknown> } {
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      cart: null,
      result: { staged: false, reason: 'Arguments were not valid JSON.' },
    };
  }

  const merged = new Map<string, number>();
  const rejected: string[] = [];
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    const variantId = (item as { variantId?: unknown })?.variantId;
    const qty = Math.floor(Number((item as { qty?: unknown })?.qty));
    const entry =
      typeof variantId === 'string'
        ? catalogue.find(v => v.variantId === variantId)
        : undefined;
    if (!entry || !Number.isFinite(qty) || qty < 1 || qty > 9999) {
      rejected.push(String(variantId ?? '(missing id)'));
      continue;
    }
    if (!entry.inStock) {
      rejected.push(`${entry.label} (backordered)`);
      continue;
    }
    merged.set(
      entry.variantId,
      Math.min(9999, (merged.get(entry.variantId) ?? 0) + qty)
    );
  }

  const lines: StagedLine[] = Array.from(merged.entries()).map(
    ([variantId, qty]) => {
      const entry = catalogue.find(v => v.variantId === variantId)!;
      const unitPrice = resolveTier(entry.tiers, qty).pricePerUnit;
      return {
        variantId,
        qty,
        label: entry.label,
        unitPrice,
        lineTotal: roundMoney(unitPrice * qty),
      };
    }
  );

  if (!lines.length) {
    return {
      cart: null,
      result: {
        staged: false,
        reason:
          'No valid items. Ask the customer for a color and a quantity in packs.',
        rejected,
      },
    };
  }

  const cart: StagedCart = {
    lines,
    subtotal: roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
  };
  return {
    cart,
    result: {
      staged: true,
      lines,
      subtotal: cart.subtotal,
      ...(rejected.length ? { rejected } : {}),
      note:
        'The customer sees this as a review card with an Add to cart button ' +
        'next to your answer. Nothing has been purchased. Unit prices are ' +
        'per-line volume pricing, the same math the cart shows.',
    },
  };
}

interface ToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface AssistantMessage {
  role?: string;
  content?: unknown;
  tool_calls?: ToolCall[];
}

/**
 * One chat completion. Returns the assistant message, or null on any upstream
 * failure (which is logged here, once, rather than at every call site).
 */
async function chatComplete(
  apiKey: string,
  messages: unknown[],
  tools?: unknown[]
): Promise<AssistantMessage | null> {
  const response = await fetch(CHAT_URL, {
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
      ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Logged, not returned: an upstream error body can name the account or
    // its quota state, which is nothing a visitor should see.
    console.error(
      `[ask] chat completions returned ${response.status}`,
      await response.text().catch(() => '(no body)')
    );
    return null;
  }

  try {
    const payload = (await response.json()) as {
      choices?: { message?: AssistantMessage }[];
    };
    return payload.choices?.[0]?.message ?? null;
  } catch (error) {
    console.error('[ask] unreadable response from OpenAI:', error);
    return null;
  }
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
    console.error('[ask] no retrieval index. Run `pnpm rag:index` and deploy');
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
   * this route parsing anything, and long before either OpenAI call.
   *
   * Both sets of rules are tested before either is charged, so a request the
   * instance ceiling turns away does not also spend the caller's own
   * allowance on a question that was never answered.
   */
  const caller = clientKey(request);
  const now = Date.now();
  const callerLimit = await check(caller, PER_CALLER, { now, record: false });
  const limited = callerLimit.allowed
    ? await check(GLOBAL_KEY, GLOBAL, { now, record: false })
    : callerLimit;

  if (limited.allowed) {
    await check(caller, PER_CALLER, { now });
    await check(GLOBAL_KEY, GLOBAL, { now });
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
            : `That is a lot of questions at once. Try again ${humanWait(limited.retryAfter)}, or call (800) 555-0117, Mon-Fri, 8am-5pm ET.`,
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
   * inventing a return window, so the route declines instead, and does it
   * without spending a completion call.
   */
  if (hits.length === 0) {
    return json(
      {
        ok: true,
        answer:
          'I do not have anything on that. For anything outside what is published on the site, email sales@shawsafety.com or call (800) 555-0117, Monday to Friday, 8am-5pm ET.',
        sources: [],
      },
      200
    );
  }

  const messages: unknown[] = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user' as const,
      content: `Context passages:\n\n${formatContext(hits)}\n\n---\n\nQuestion: ${question}`,
    },
  ];

  const catalogue = await loadCatalogue();
  const tools = catalogue.length ? [stageCartTool(catalogue)] : undefined;

  let first: AssistantMessage | null;
  try {
    first = await chatComplete(apiKey, messages, tools);
  } catch (error) {
    console.error('[ask] completion request failed:', error);
    return json({ ok: false, error: 'Could not reach the assistant.' }, 502);
  }

  if (!first) {
    return json({ ok: false, error: 'Could not answer that just now.' }, 502);
  }

  let answer = typeof first.content === 'string' ? first.content.trim() : '';
  let cart: StagedCart | null = null;

  /*
   * A tool call means the model wants to stage a cart. The call is validated
   * and priced here, then a second completion runs with the priced lines in
   * hand so the model can speak the answer with the real numbers. Only the
   * first stage_cart call is honoured; every call still gets a tool response,
   * which the API requires.
   */
  const toolCalls = first.tool_calls ?? [];
  if (toolCalls.length) {
    const toolResults = toolCalls.map(call => {
      let result: Record<string, unknown> = {
        staged: false,
        reason: 'Only one stage_cart call is honoured per answer.',
      };
      if (call.function?.name === 'stage_cart' && !cart) {
        const staged = stageFromArguments(
          call.function.arguments ?? '',
          catalogue
        );
        cart = staged.cart;
        result = staged.result;
      }
      return {
        role: 'tool' as const,
        tool_call_id: call.id,
        content: JSON.stringify(result),
      };
    });

    try {
      const second = await chatComplete(apiKey, [
        ...messages,
        first,
        ...toolResults,
      ]);
      answer =
        second && typeof second.content === 'string'
          ? second.content.trim()
          : '';
    } catch (error) {
      console.error('[ask] follow-up completion failed:', error);
      answer = '';
    }

    // A staged cart with a lost voice still beats a bare failure.
    if (!answer && cart) {
      answer =
        'Your cart is staged below, ready to review. Nothing is purchased until you check out.';
    }
  }

  if (!answer) {
    return json({ ok: false, error: 'Could not answer that just now.' }, 502);
  }

  /*
   * The answer ships as text, plus the staged cart when there is one. No
   * source list, no citation numbers, no links: the widget renders a rep
   * talking, and a rep does not hand over a bibliography. Retrieval is still
   * what the answer is built from, it just never surfaces.
   *
   * Which passages were used is logged rather than returned, because the
   * scores are the only signal available for tuning the retrieval threshold
   * against real questions and losing them would make that untunable.
   */
  console.info(
    `[ask] answered from ${hits
      .map(hit => `${hit.chunk.id}@${hit.score.toFixed(3)}`)
      .join(', ')}${cart !== null ? ` with a ${(cart as StagedCart).lines.length}-line staged cart` : ''}`
  );

  return json({ ok: true, answer: clean(answer), ...(cart ? { cart } : {}) }, 200);
};
