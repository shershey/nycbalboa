import { defineConfig } from 'astro/config';

export default defineConfig({
  redirects: {
    '/offerings': '/learn',
    '/events': '/calendar',
  },
});
