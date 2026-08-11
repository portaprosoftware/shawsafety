/**
 * Retrieval checks against the built index.
 *
 *   pnpm rag:test
 *
 * Embeds a handful of real buyer questions, runs the same retrieval the API
 * route runs, and asserts that the chunks that should answer them actually
 * come back in the top results. This is the part that a dry run cannot tell
 * you: parsing proves the corpus is well-formed, but only retrieval proves a
 * question finds its answer.
 *
 * Two kinds of assertion:
 *
 *   expect  — source documents that must appear in the top `within` hits.
 *   forbid  — text that must not appear anywhere in the retrieved context.
 *
 * `forbid` exists because the corpus has standing content rules that are
 * invisible to a similarity score. A C-TPAT question retrieving a passage that
 * names an unaffiliated supplier is a correct retrieval and a wrong answer, so
 * it is asserted against directly.
 *
 * Requires OPENAI_API_KEY, since a query has to be embedded with the same model
 * the index was built with. Without one it reports what it cannot check and
 * exits 0 rather than failing a pipeline that was never going to have a key.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = resolve(root, 'src/data_files/rag-index.json');

/** Mirrors TOP_K in the API route, so this tests what visitors actually get. */
const TOP_K = 5;
const MIN_SCORE = 0.25;

const CASES = [
  {
    query: 'Are these C-TPAT compliant?',
    expect: ['02-compliance-and-standards', '12-faq-and-overflow'],
    within: 3,
    // The product does not qualify, and no traffic goes to an unaffiliated
    // supplier. Both halves of that are load-bearing.
    forbid: ['ziptie.com'],
    mustMention: ['ISO 17712'],
  },
  {
    query: 'How does volume pricing work?',
    expect: ['04-pricing-and-ordering'],
    within: 3,
  },
  {
    query: "What's the difference between the colors?",
    expect: ['01-products-and-specs', '03-use-cases'],
    within: 5,
    mustMention: ['pigment'],
  },
  {
    query: 'Do these work in cold weather?',
    expect: ['09-practical-usage'],
    within: 3,
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

/** Chunk id back to the document it came from: `04-pricing--007` -> `04-pricing`. */
const documentOf = id => id.split('--')[0];

let index;
try {
  index = JSON.parse(await readFile(indexFile, 'utf8'));
} catch {
  console.error(
    `\nNo index at ${indexFile}.\n` +
      '  Run `pnpm rag:index` first (needs OPENAI_API_KEY).\n'
  );
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.log(
    '\nrag:test — OPENAI_API_KEY is not set, so retrieval cannot be checked.\n' +
      `  The index itself looks readable: ${index.chunks.length} chunks, ` +
      `${index.model} (${index.dimensions}d).\n` +
      '  Set the key and re-run to verify the questions actually retrieve.\n'
  );
  process.exit(0);
}

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
  if (!response.ok) {
    throw new Error(`embeddings returned ${response.status}`);
  }
  return (await response.json()).data[0].embedding;
}

console.log(
  `\nRetrieval checks — ${index.chunks.length} chunks, ${index.model} (${index.dimensions}d)\n`
);

let failures = 0;

for (const testCase of CASES) {
  const queryEmbedding = await embed(testCase.query);
  const hits = index.chunks
    .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .filter(hit => hit.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  const problems = [];
  const within = hits.slice(0, testCase.within ?? TOP_K);
  const documents = within.map(hit => documentOf(hit.chunk.id));

  for (const wanted of testCase.expect ?? []) {
    if (!documents.includes(wanted)) {
      problems.push(`expected ${wanted} in the top ${testCase.within ?? TOP_K}`);
    }
  }

  const context = hits.map(hit => hit.chunk.text).join('\n').toLowerCase();
  for (const banned of testCase.forbid ?? []) {
    if (context.includes(banned.toLowerCase())) {
      problems.push(`retrieved context contains forbidden text "${banned}"`);
    }
  }
  for (const needed of testCase.mustMention ?? []) {
    if (!context.includes(needed.toLowerCase())) {
      problems.push(`retrieved context never mentions "${needed}"`);
    }
  }

  console.log(`${problems.length ? 'FAIL' : 'pass'}  ${testCase.query}`);
  for (const hit of hits) {
    console.log(`        ${hit.score.toFixed(3)}  ${hit.chunk.id}`);
  }
  for (const problem of problems) {
    console.log(`        ! ${problem}`);
  }
  console.log('');
  if (problems.length) failures++;
}

if (failures) {
  console.error(`${failures} of ${CASES.length} checks failed.\n`);
  process.exit(1);
}
console.log(`All ${CASES.length} checks passed.\n`);
