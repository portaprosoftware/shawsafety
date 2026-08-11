/**
 * Retrieval over the knowledge corpus.
 *
 * The store is a single JSON file written by `pnpm rag:index`. At 30 chunks a
 * linear scan is microseconds, a vector database here would add a network
 * hop, a second credential, and an operational dependency to beat an
 * in-process loop that is already faster than the embedding call preceding it.
 *
 * Server-only: everything here runs inside an API route, and the embedding
 * call it feeds needs a key that must never reach the browser.
 */

export interface IndexedChunk {
  id: string;
  title: string;
  topic: string;
  /** Page the chunk came from, cited back to the visitor. */
  url: string;
  sourceLabel: string;
  text: string;
  embedding: number[];
}

export interface RagIndex {
  /** Embedding model the vectors were produced with. */
  model: string;
  /** Vector width. A query must be embedded at the same width to compare. */
  dimensions: number;
  generatedAt: string;
  chunks: IndexedChunk[];
}

export interface Retrieved {
  chunk: IndexedChunk;
  score: number;
}

/*
 * Globbed rather than imported.
 *
 * The index is generated, not authored, so a fresh clone does not have one
 * until someone runs the build script with a key. A static import of a missing
 * file is a build error; a glob that matches nothing is an empty object, which
 * lets the route answer "the assistant is not configured yet" instead of
 * taking the deploy down. Same reasoning as the product photos.
 */
const matches = import.meta.glob<{ default: RagIndex }>(
  '/src/data_files/rag-index.json',
  { eager: true }
);

export const ragIndex: RagIndex | null =
  Object.values(matches)[0]?.default ?? null;

/**
 * Cosine similarity between two vectors.
 *
 * OpenAI returns unit-length vectors, so the denominator is ~1 and a plain dot
 * product would usually do. It is computed anyway: the vectors in the index
 * have been rounded to six decimals, and normalising makes the score
 * independent of that and of any future change to how they are stored.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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
 * The `k` chunks closest to a query embedding, best first.
 *
 * `minScore` drops matches that are merely the least-bad of a bad set. Without
 * it an off-topic question ("what is the weather") still retrieves five chunks
 * at low similarity, and handing those to the model invites it to answer from
 * whatever it was given. Returning nothing is what lets the route say it does
 * not know.
 */
export function retrieve(
  queryEmbedding: number[],
  { k = 5, minScore = 0.25 }: { k?: number; minScore?: number } = {}
): Retrieved[] {
  if (!ragIndex) return [];

  return ragIndex.chunks
    .map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter(hit => hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Render retrieved chunks as the context block handed to the model.
 *
 * Numbered so the answer can cite `[2]` and the caller can map that back to a
 * real page, and titled so the model can tell two chunks apart when they
 * discuss the same product from different angles (specs versus pricing).
 */
export function formatContext(hits: Retrieved[]): string {
  return hits
    .map(
      (hit, i) =>
        `[${i + 1}] ${hit.chunk.title} (source: ${hit.chunk.url})\n${hit.chunk.text}`
    )
    .join('\n\n---\n\n');
}
