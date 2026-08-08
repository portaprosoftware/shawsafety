import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://shawsafety.com',
  image: {
    // https://docs.astro.build/en/guides/images/#authorizing-remote-images
    // TODO: replace with the Cloudflare R2 bucket hostname once provisioned,
    // and mirror the change in the `img-src` CSP directive in vercel.json.
    domains: ['assets.shawsafety.com'],
  },
  prefetch: true,
  integrations: [sitemap(), mdx()],
  experimental: {
    clientPrerender: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
