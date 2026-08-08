import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  /*
   * The canonical origin for this deployment. Feeds canonical links, og:url,
   * the sitemap, and (via SITE.url in src/data_files/constants.ts, which must
   * be kept in step) every JSON-LD @id.
   *
   * Deliberately NOT shawsafety.com: that domain is run by someone else and
   * points at their own deployment. Declaring it here would tell search
   * engines their site is the original and this one a duplicate.
   */
  site: 'https://shaw.portaprosoftware.com',
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
