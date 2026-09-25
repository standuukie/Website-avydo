/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /**
   * Server-side only. Kiest de providerketen voor de AI-assistent
   * (src/lib/ai-providers/index.ts): "free" (standaard, alleen Groq —
   * Gemini's gratis tier mag niet gebruikt worden voor EER-gebruikers,
   * zie README), "free-with-paid-fallback" (Groq + Anthropic als laatste
   * redmiddel), of één losse provider-id ("gemini" | "groq" | "anthropic")
   * om te pinnen.
   */
  readonly AI_PROVIDER?: string;

  /** Server-side only. API-sleutel voor Google Gemini. Niet in de standaardketen — zie README ("Incident"). */
  readonly GEMINI_API_KEY?: string;
  /** Server-side only. Override van het standaard Gemini-modelalias ("gemini-flash-latest"). */
  readonly GEMINI_MODEL?: string;

  /** Server-side only. API-sleutel voor Groq (gratis tier, geen creditcard nodig). Zie README. */
  readonly GROQ_API_KEY?: string;
  /** Server-side only. Override van het standaard Groq-model ("llama-3.3-70b-versatile"). */
  readonly GROQ_MODEL?: string;

  /**
   * Server-side only. Gebruikt door zowel scripts/kenniscentrum/fetch-articles.mjs
   * (optionele AI-samenvatting) als, optioneel, src/pages/api/kenniscentrum-chat.ts
   * (AI-assistent, alleen als AI_PROVIDER dit expliciet inschakelt — zie
   * hierboven). Nooit blootgesteld aan de browser: alleen gelezen binnen
   * een API-route (prerender = false) of GitHub Actions-workflow die
   * server-side draait.
   */
  readonly ANTHROPIC_API_KEY?: string;
  /** Server-side only. Override van het standaard Anthropic-model ("claude-haiku-4-5-20251001"). */
  readonly ANTHROPIC_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}