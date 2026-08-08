import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://shawsafety.com',
  // All images are local to src/images/ and go through Astro's build pipeline.
  // If assets ever move to a CDN, allowlist the host here AND in the `img-src`
  // CSP directive in vercel.json — missing either one silently blanks them.
  // https://docs.astro.build/en/guides/images/#authorizing-remote-images
  /*
   * Static by default — every page is still prerendered to HTML at build time.
   * The adapter exists only so the routes under src/pages/api/ can opt out with
   * `export const prerender = false` and run as serverless functions. The form
   * handlers need a server because the Resend API key must never reach the
   * client.
   */
  output: 'static',
  adapter: vercel(),
  prefetch: true,
  integrations: [sitemap(), mdx()],
  experimental: {
    clientPrerender: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
