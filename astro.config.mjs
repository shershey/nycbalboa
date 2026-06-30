import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  redirects: {
    '/offerings': '/learn',
    '/events': '/calendar',
  },

  output: "hybrid",
  adapter: cloudflare()
});