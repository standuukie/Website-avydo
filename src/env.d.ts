/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /**
   * Server-side only. Gebruikt door zowel scripts/kenniscentrum/fetch-articles.mjs
   * (optionele AI-samenvatting) als src/pages/api/kenniscentrum-chat.ts
   * (AI-assistent). Nooit blootgesteld aan de browser: alleen gelezen binnen
   * een API-route (prerender = false) die server-side draait.
   */
  readonly ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}