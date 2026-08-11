/**
 * Response-style checks for the assistant.
 *
 *   pnpm rag:style
 *
 * `rag:test` proves a question retrieves the right passages. This proves the
 * answer built from them sounds like a rep rather than a search result read
 * aloud — the failure that prompted the prompt rewrite, where a two-word
 * question came back as a paragraph about what the retrieval did or did not
 * contain.
 *
 * Runs the real pipeline: embed the question, retrieve with the same top-k and
 * threshold as the route, then complete against the route's own system prompt.
 * The prompt is read out of src/pages/api/ask.ts rather than copied here, so
 * this cannot drift into testing a stale version of it.
 *
 * Style is graded by assertion where it can be — banned phrases are exact
 * strings — and printed in full where it cannot. A human still reads the
 * answers; the assertions catch the regressions that are mechanical.
 *
 * Requires OPENAI_API_KEY. Without one it explains what it could not check and
 * exits 0, rather than failing a pipeline that was never going to have a key.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = resolve(root, 'src/data_files/rag-index.json');
const routeFile = resolve(root, 'src/pages/api/ask.ts');

/** Mirrors the route. Retrieval has to match or the answers are not comparable. */
const TOP_K = 5;
const MIN_SCORE = 0.25;

/**
 * Phrases that give the machinery away.
 *
 * These are the exact strings the assistant was producing before the rewrite.
 * Matching is substring, case-insensitive: "The context does not mention blue"
 * and "based on the provided context" both land on `the context`.
 */
const BANNED = [
  'the context',
  'the provided context',
  'provided information',
  'the knowledge base',
  'based on what i have',
  'the documents show',
  'according to the information',
  'the passages',
  'the retrieved',
  'the excerpt',
  'the information provided',
  'i do not have access',
  "i don't have access",
];

/** Standing rule: this domain is not affiliated and is never named. */
const FORBIDDEN_REFERRAL = ['ziptie.com', 'ziptie .com', 'zip tie.com'];

const CONTACT = ['sales@shawsafety.com', '555-0117'];

const CASES = [
  {
    query: 'do you carry blue',
    // A flat no, then the four colours. Contact is not a handoff case.
    expectContact: false,
    mustStartWith: /^(no\b|we\b)/i,
    mustMention: ['yellow', 'pink', 'green', 'orange'],
  },
  {
    query: 'are these ctpat compliant',
    // The one case where offering sales is legitimate: sourcing a Class H seal
    // is real human follow-up. Allowed, not required.
    expectContact: null,
    mustStartWith: /^no\b/i,
    mustMention: ['17712'],
    mustNotMention: ['ziptie'],
  },
  {
    query: "what's your return policy",
    expectContact: false,
    mustMention: ['30 day'],
  },
  {
    query: 'how fast do they ship',
    expectContact: false,
    mustMention: ['next business day'],
  },
];

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Lift SYSTEM_PROMPT out of the route.
 *
 * A copy in this file would be a second prompt to keep in sync, and the first
 * time they diverged this would start certifying text the route does not send.
 * The template literal contains no backticks, so the match is unambiguous;
 * if that ever changes this throws rather than testing a truncated prompt.
 */
async function readSystemPrompt() {
  const source = await readFile(routeFile, 'utf8');
  const match = source.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!match) {
    throw new Error(
      `Could not extract SYSTEM_PROMPT from ${routeFile}. If the literal now ` +
        'contains a backtick or was renamed, update this matcher.'
    );
  }
  return match[1];
}

let index;
try {
  index = JSON.parse(await readFile(indexFile, 'utf8'));
} catch {
  console.error(
    `\nNo index at ${indexFile}.\n  Run \`pnpm rag:index\` first (needs OPENAI_API_KEY).\n`
  );
  process.exit(1);
}

const systemPrompt = await readSystemPrompt();
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.log(
    '\nrag:style — OPENAI_API_KEY is not set, so no answer can be generated.\n' +
      `  Prompt read OK: ${systemPrompt.length} chars from src/pages/api/ask.ts\n` +
      `  Index read OK:  ${index.chunks.length} chunks\n` +
      `  Would check ${CASES.length} queries: ${CASES.map(c => `"${c.query}"`).join(', ')}\n\n` +
      '  Set the key and re-run to grade the answers.\n'
  );
  process.exit(0);
}

const chatModel = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

async function embed(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: index.model,
      input: text,
      dimensions: index.dimensions,
    }),
  });
  if (!response.ok) throw new Error(`embeddings returned ${response.status}`);
  return (await response.json()).data[0].embedding;
}

async function answer(question) {
  const queryEmbedding = await embed(question);
  const hits = index.chunks
    .map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter(hit => hit.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  if (!hits.length) return { text: '(nothing retrieved)', hits };

  const context = hits
    .map(
      (hit, i) =>
        `[${i + 1}] ${hit.chunk.title} (source: ${hit.chunk.url})\n${hit.chunk.text}`
    )
    .join('\n\n---\n\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Context passages:\n\n${context}\n\n---\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });
  if (!response.ok) throw new Error(`completions returned ${response.status}`);
  const payload = await response.json();
  return { text: (payload.choices?.[0]?.message?.content ?? '').trim(), hits };
}

/** Strip citation markers before length checks — they are not the rep's words. */
const withoutCitations = text => text.replace(/\[\d+\]/g, '').trim();

console.log(
  `\nResponse-style checks — ${chatModel}, ${index.chunks.length} chunks\n`
);

let failures = 0;

for (const testCase of CASES) {
  const { text } = await answer(testCase.query);
  const clean = withoutCitations(text);
  const lower = clean.toLowerCase();
  const problems = [];

  for (const phrase of BANNED) {
    if (lower.includes(phrase))
      problems.push(`narrates retrieval: "${phrase}"`);
  }
  for (const phrase of FORBIDDEN_REFERRAL) {
    if (lower.includes(phrase)) problems.push(`names ${phrase}`);
  }

  const hasContact = CONTACT.some(c => lower.includes(c.toLowerCase()));
  if (testCase.expectContact === false && hasContact) {
    problems.push('appends sales contact to an answer that needs no handoff');
  }
  if (testCase.expectContact === true && !hasContact) {
    problems.push('should offer the sales contact and does not');
  }

  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  if (testCase.mustStartWith && !testCase.mustStartWith.test(clean)) {
    problems.push(
      `does not lead with a direct answer (starts "${firstSentence.slice(0, 60)}…")`
    );
  }
  if (firstSentence.length > 160) {
    problems.push(
      `opening sentence is ${firstSentence.length} chars — too long`
    );
  }

  for (const needed of testCase.mustMention ?? []) {
    if (!lower.includes(needed.toLowerCase())) {
      problems.push(`never mentions "${needed}"`);
    }
  }
  for (const banned of testCase.mustNotMention ?? []) {
    if (lower.includes(banned.toLowerCase())) {
      problems.push(`mentions "${banned}"`);
    }
  }

  console.log(`${problems.length ? 'FAIL' : 'pass'}  "${testCase.query}"`);
  console.log(
    text
      .split('\n')
      .map(line => `        ${line}`)
      .join('\n')
  );
  for (const problem of problems) console.log(`        ! ${problem}`);
  console.log('');
  if (problems.length) failures++;
}

if (failures) {
  console.error(`${failures} of ${CASES.length} answers need work.\n`);
  process.exit(1);
}
console.log(`All ${CASES.length} answers passed the style checks.\n`);
