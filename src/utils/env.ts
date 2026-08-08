/**
 * Read a server-side environment variable.
 *
 * Prefers `process.env`, which is read at request time on Vercel. Vite can
 * inline `import.meta.env` references at build time, which would freeze a
 * secret into the deployed bundle — rotating the key in the Vercel dashboard
 * then has no effect until the next deploy. Reading `process.env` first avoids
 * that; `import.meta.env` remains the fallback so `astro dev` still picks up a
 * local `.env`.
 *
 * Server-only. Never call this from client-side script.
 */
export function readEnv(name: string): string | undefined {
  const fromProcess =
    typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (fromProcess) return fromProcess;

  const viteEnv = import.meta.env as Record<string, string | undefined>;
  return viteEnv?.[name];
}
