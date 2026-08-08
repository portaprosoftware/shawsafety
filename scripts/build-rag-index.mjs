/**
 * Embeds the knowledge corpus and writes the retrieval index.
 *
 *   pnpm rag:index
 *
 * Reads every chunk in src/content/knowledge/, asks OpenAI for an embedding of
 * each, and writes src/data_files/rag-index.json. That file is the whole
 * retrieval store — there is no vector database, because 30 chunks is small
 * enough that a linear scan in the API route costs less than a network hop to
 * one would.
 *
 * Runs as the first step of `pnpm build`, so deploying is the only thing an
 * operator has to do: set OPENAI_API_KEY in the host's environment and the
 * next deploy builds the index and turns the assistant on. The index is
 * generated rather than committed, and is gitignored to keep it that way.
 *
 * It must run before `astro build`, which reads the file at compile time.
 *
 * Embedding thirty chunks costs a fraction of a cent, so paying it per deploy
 * rather than per corpus edit is not worth optimising around.
 *
 * ## This never fails the build
 *
 * No key, or an upstream error, leaves the index unwritten and the assistant
 * switched off — reported loudly, but not fatally. An OpenAI outage should not
 * be able to block a pricing correction from reaching the storefront, which is
 * the same call the checkout tier check makes: loud, not offline.
 *
 * The tradeoff is that a broken assistant deploys quietly unless someone reads
 * the log, so `--report` prints the outcome again at the very end of the build
 * where it cannot scroll away.
 *
 * Modes:
 *   --dry-run  parse and report the corpus, no API call, nothing written.
 *              How to check a newly edited chunk without spending a request.
 *   --report   print whether an index was produced. Runs last in the build.
 *
 * Environment:
 *   OPENAI_API_KEY          required to produce an index; absent, the
 *                           assistant stays off and the build carries on.
 *   OPENAI_EMBEDDING_MODEL  optional, defaults to text-embedding-3-small.
 */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = resolve(root, 'src/content/knowledge');
const outFile = resolve(root, 'src/data_files/rag-index.json');

const MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

/**
 * Truncated embedding width.
 *
 * text-embedding-3 models are trained so a prefix of the vector is still a
 * usable embedding, so asking for 512 instead of the native 1536 cuts the
 * generated index to a third of its size at a retrieval quality difference
 * that does not show up on a corpus this small. The API route reads the width
 * back out of the index rather than assuming it, so changing this number here
 * and re-running is safe.
 */
const DIMENSIONS = 512;

/** Embedding requests per HTTP call. Well inside the API's input limit. */
const BATCH_SIZE = 32;

/**
 * Frontmatter parser for the subset this corpus uses: quoted scalars and
 * block lists of quoted scalars, one level deep.
 *
 * Astro parses these files properly at build time via the content collection —
 * this exists only because the script runs outside Astro, and pulling a YAML
 * parser into the dependency tree to read six keys is not a trade worth
 * making. It is intentionally strict: anything it cannot read is reported as a
 * malformed chunk rather than silently dropped.
 */
function parseFrontmatter(raw, file) {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${file}: missing frontmatter`);
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error(`${file}: unterminated frontmatter`);

  const data = {};
  let listKey = null;

  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;

    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!pair)
      throw new Error(`${file}: cannot parse frontmatter line: ${line}`);

    const [, key, value] = pair;
    if (value.trim() === '') {
      listKey = key;
      data[key] = [];
    } else {
      listKey = null;
      data[key] = unquote(value);
    }
  }

  return {
    data,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

function unquote(value) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^'(.*)'$/) || trimmed.match(/^"(.*)"$/);
  return quoted ? quoted[1] : trimmed;
}

/**
 * The text that actually gets embedded.
 *
 * Title and questions lead because they carry the buyer's vocabulary — a
 * question phrased the way someone would ask it is the closest thing in the
 * corpus to the query that will be matched against it. Keywords are included
 * for the same reason; the body follows as the substance.
 */
function embeddingText(chunk) {
  return [
    chunk.title,
    chunk.questions.join('\n'),
    chunk.keywords.join(', '),
    chunk.body,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function embedBatch(texts, apiKey) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      dimensions: DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`OpenAI returned ${response.status}: ${body}`);
  }

  const payload = await response.json();
  // The API documents index order as matching the input, but the index field
  // is authoritative and sorting by it costs nothing.
  return payload.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

const dryRun = process.argv.includes('--dry-run');
const reportOnly = process.argv.includes('--report');

/**
 * Say whether the assistant will be live, and why not when it will not.
 *
 * Printed at the end of the build precisely because the index is built at the
 * start: an operator who set the key and expected a chat widget needs the
 * answer where they will actually see it, not four hundred lines up.
 */
if (reportOnly) {
  try {
    const built = JSON.parse(await readFile(outFile, 'utf8'));
    console.log(
      `\nRAG assistant: ON — ${built.chunks.length} chunks, ${built.model} (${built.dimensions}d)\n`
    );
  } catch {
    console.log(
      '\nRAG assistant: OFF — no index was produced, so the chat widget is\n' +
        '  not rendered. Set OPENAI_API_KEY in the build environment and\n' +
        '  redeploy; look further up this log for the reason.\n'
    );
  }
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;

/*
 * A missing key is a configuration state, not a failure. It is how every
 * contributor without one builds the site, and how a preview deploy runs when
 * the variable is scoped to production only — neither should be a broken
 * build. The assistant simply stays off, which the widget already handles by
 * rendering nothing at all.
 */
if (!apiKey && !dryRun) {
  console.log(
    '\nRAG assistant: OPENAI_API_KEY is not set, so no index will be built\n' +
      '  and the chat widget will not render. Set it in the build environment\n' +
      '  (Vercel → Settings → Environment Variables) to switch the assistant on.\n' +
      '  Locally: put it in .env and re-run `pnpm rag:index`.\n'
  );
  /*
   * Remove a stale index rather than leaving one behind. Astro reads this file
   * at compile time, so a leftover from an earlier keyed build would ship a
   * widget that every visitor finds broken — worse than no widget.
   */
  await rm(outFile, { force: true });
  process.exit(0);
}

const files = (await readdir(corpusDir)).filter(
  f => f.endsWith('.md') && !f.startsWith('_')
);

if (!files.length) {
  console.error(`No chunks found in ${corpusDir}`);
  process.exit(1);
}

const chunks = [];
for (const file of files.sort()) {
  const raw = await readFile(resolve(corpusDir, file), 'utf8');
  const { data, body } = parseFrontmatter(raw, file);

  if (!data.title || !data.url || !body) {
    throw new Error(`${file}: needs a title, a url, and a body`);
  }

  chunks.push({
    id: file.replace(/\.md$/, ''),
    title: data.title,
    topic: data.topic ?? 'company',
    url: data.url,
    sourceLabel: data.sourceLabel ?? data.title,
    questions: data.questions ?? [],
    keywords: data.keywords ?? [],
    body,
  });
}

if (dryRun) {
  console.log(`\nParsed ${chunks.length} chunks from ${corpusDir}\n`);
  for (const chunk of chunks) {
    const words = embeddingText(chunk).split(/\s+/).length;
    console.log(
      `  ${chunk.id.padEnd(36)} ${String(words).padStart(4)} words  ` +
        `${String(chunk.questions.length).padStart(2)}q  ${chunk.url}`
    );
  }
  const topics = chunks.reduce((acc, c) => {
    acc[c.topic] = (acc[c.topic] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nTopics: ${Object.entries(topics)
      .map(([topic, n]) => `${topic} ${n}`)
      .join(', ')}`
  );
  console.log('\nDry run — nothing embedded, nothing written.\n');
  process.exit(0);
}

console.log(
  `\nEmbedding ${chunks.length} chunks with ${MODEL} (${DIMENSIONS}d)`
);

const embeddings = [];
try {
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    embeddings.push(...(await embedBatch(batch.map(embeddingText), apiKey)));
    console.log(
      `  ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`
    );
  }
} catch (error) {
  /*
   * A rejected key, a quota, an OpenAI outage. Loud, but not fatal: blocking a
   * deploy of the storefront because a chat widget cannot be built would let
   * an upstream problem hold up a pricing correction. The same call the
   * checkout tier check makes.
   *
   * The half-built index is discarded rather than written — a partial corpus
   * retrieves confidently from whichever chunks made it, which is a worse
   * failure than the assistant being off.
   */
  console.error(
    `\nRAG assistant: FAILED to build the index — ${error.message}`
  );
  console.error(
    '  The site will deploy without the chat widget. Fix the key or retry the\n' +
      '  deploy; nothing else on the site is affected.\n'
  );
  await rm(outFile, { force: true });
  process.exit(0);
}

const index = {
  model: MODEL,
  dimensions: DIMENSIONS,
  generatedAt: new Date().toISOString(),
  chunks: chunks.map((chunk, i) => ({
    id: chunk.id,
    title: chunk.title,
    topic: chunk.topic,
    url: chunk.url,
    sourceLabel: chunk.sourceLabel,
    text: chunk.body,
    // Six decimals is well past what cosine similarity can distinguish here
    // and roughly halves the file.
    embedding: embeddings[i].map(n => Number(n.toFixed(6))),
  })),
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(index)}\n`);

const kb = Math.round(JSON.stringify(index).length / 1024);
console.log(`\nWrote ${outFile} (${kb} KB)\n`);
console.log(
  'The API route serves retrieval straight from this file. It is gitignored\n' +
    '  and rebuilt by `pnpm build`, so there is nothing to commit.\n'
);
