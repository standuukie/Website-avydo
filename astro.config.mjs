import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel/serverless';

export default defineConfig({
  site: 'https://www.avydo.nl',
  // "hybrid": alle pagina's blijven statisch geprerenderd (zoals voorheen),
  // behalve de expliciete server-route(s) die "export const prerender = false"
  // gebruiken — dat is uitsluitend de AI-assistent-API
  // (src/pages/api/kenniscentrum-chat.ts), nodig omdat die route de
  // ANTHROPIC_API_KEY server-side moet gebruiken en dus niet vooraf
  // gebouwd kan worden. De rest van de site verandert hierdoor niet van
  // renderwijze.
  output: 'hybrid',
  adapter: vercel(),
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      filter: (page) => !page.includes('/privacy'),
    }),
  ],
  trailingSlash: 'never',
});
