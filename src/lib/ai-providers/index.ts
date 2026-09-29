// Provider-orchestratie voor de AI-assistent: bepaalt op basis van de
// AI_PROVIDER-environment variable welke keten van providers geprobeerd
// wordt, en valt bij een fout automatisch terug op de volgende provider
// in de keten (nooit stilzwijgend naar een betaalde provider, tenzij
// expliciet geconfigureerd — zie resolveProviderChain hieronder).
import { geminiProvider } from './gemini';
import { groqProvider } from './groq';
import { anthropicProvider } from './anthropic';
import type { AiProvider, ChatMessage, ToolDefinition } from './types';
import { categorizeProviderError } from '@/lib/error-classify.mjs';

export type { ChatMessage, ToolDefinition } from './types';

const PROVIDERS_BY_ID: Record<string, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  anthropic: anthropicProvider,
};

/**
 * AI_PROVIDER bepaalt de te gebruiken keten:
 * - onbekend/leeg/"free" (standaard, veilig): [groq] — gratis, nooit
 *   betaald, en zonder de juridische EER-beperking van Gemini hieronder.
 * - "free-with-paid-fallback": [groq, anthropic] — Anthropic als
 *   allerlaatste, betaald redmiddel wanneer Groq faalt.
 * - "gemini" / "groq" / "anthropic": alleen die ene provider (handig om
 *   gericht te testen, of om bijvoorbeeld volledig op Anthropic over te
 *   schakelen).
 *
 * BELANGRIJK — waarom Gemini niet meer in de standaardketen zit: Google's
 * Gemini API Additional Terms of Service staan het gebruik van de GRATIS
 * tier alleen toe als de applicatie geen gebruikers in de EER,
 * Zwitserland of het VK bedient ("You may use only Paid Services when
 * making API Clients available to users in the European Economic Area,
 * Switzerland, or the United Kingdom" — ai.google.dev/gemini-api/terms).
 * Avydo bedient Nederlandse mkb-ondernemers (dus EER-gebruikers), dus de
 * gratis Gemini-tier is voor déze site contractueel niet toegestaan,
 * ongeacht of het request technisch slaagt. Dit is zeer waarschijnlijk
 * (mede) de oorzaak van de "kon niet antwoorden"-melding: Google kan
 * verzoeken vanuit een EER-geregistreerd account/project weigeren of
 * beperken, los van of de sleutel en request verder correct zijn (en dat
 * zijn ze: header, model en tool-schema zijn stuk voor stuk live tegen de
 * echte API geverifieerd).
 *
 * De Gemini-adapter zelf is intact gelaten (zie gemini.ts) en blijft
 * bruikbaar via het expliciete AI_PROVIDER=gemini, voor wie bewust
 * Google Cloud Billing inschakelt op het AI Studio-project (dat maakt
 * het een "Paid Service", waarmee de EER-beperking vervalt — meestal
 * nog steeds vrijwel gratis bij dit gebruiksvolume, zie README).
 */
function resolveProviderChain(): AiProvider[] {
  const setting = (import.meta.env.AI_PROVIDER || 'free').trim().toLowerCase();

  if (setting === 'free-with-paid-fallback') return [groqProvider, anthropicProvider];
  if (setting in PROVIDERS_BY_ID) return [PROVIDERS_BY_ID[setting]];

  // "free" of een onbekende waarde: val terug op de veilige, gratis keten.
  return [groqProvider];
}

export interface AiCallOutcome {
  ok: boolean;
  input?: Record<string, unknown>;
  error?: string;
  providerId?: string;
  /** Welke provider-id's daadwerkelijk geprobeerd zijn, voor logging/diagnose. */
  attempted: string[];
  /**
   * Grove foutcategorie van de LAATST geprobeerde, mislukte provider (zie
   * categorizeProviderError hieronder) — laat de API-route onderscheid
   * maken tussen "Groq's eigen rate limit" (rate_limited) en een andere
   * providerstoring (server_error/timeout/network/malformed_response/...)
   * voor een specifiekere foutmelding aan de bezoeker. Ontbreekt/leeg als
   * er geen enkele provider geprobeerd is (not_configured).
   */
  errorCategory?: string;
}

export async function callAiWithFallback(args: {
  systemPrompt: string;
  messages: ChatMessage[];
  tool: ToolDefinition;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<AiCallOutcome> {
  const chain = resolveProviderChain().filter((p) => p.isConfigured());
  const attempted: string[] = [];

  if (chain.length === 0) {
    console.error(
      `[kenniscentrum-chat] geen enkele provider in de keten (AI_PROVIDER="${import.meta.env.AI_PROVIDER ?? ''}") heeft een geconfigureerde sleutel (GEMINI_API_KEY/GROQ_API_KEY/ANTHROPIC_API_KEY aanwezig? ${Boolean(import.meta.env.GEMINI_API_KEY)}/${Boolean(import.meta.env.GROQ_API_KEY)}/${Boolean(import.meta.env.ANTHROPIC_API_KEY)}).`,
    );
    return { ok: false, error: 'Geen enkele AI-provider is geconfigureerd.', attempted };
  }

  let lastError = '';
  let lastErrorCategory = 'unknown';
  for (const provider of chain) {
    attempted.push(provider.id);
    const startedAt = Date.now();
    const result = await provider.call(args);
    const durationMs = Date.now() - startedAt;
    const rateLimitSuffix = result.rateLimitInfo ? ` [${result.rateLimitInfo}]` : '';
    if (!result.ok) {
      // Veilig voor de serverlogs: result.error bevat uitsluitend de
      // HTTP-status en de (ingekorte) responstekst van de provider — nooit
      // de API-sleutel zelf (die staat alleen in de Authorization/
      // x-goog-api-key-header van het uitgaande verzoek, nooit in de
      // respons of in deze foutmelding), nooit de vraag van de bezoeker en
      // nooit het modelantwoord. De categorie/duur/rate-limit-headers zijn
      // toegevoegd om een providerfout (rate limit/timeout/serverfout/
      // misvormd antwoord) te kunnen onderscheiden van onze EIGEN limiter
      // zonder gevoelige data te loggen — zichtbaar in Vercel → project →
      // Deployments → Functions → Logs. Dit is precies het onderscheid dat
      // nodig is om de vraag "faalt de assistent door onze eigen limiter,
      // door Groq's RPM/TPM, of door een andere providerfout?" te
      // beantwoorden vanuit de logs alleen.
      const category = categorizeProviderError(result.error);
      lastErrorCategory = category;
      console.error(`[kenniscentrum-chat] provider "${provider.id}" faalde na ${durationMs}ms (categorie: ${category}): ${result.error}${rateLimitSuffix}`);
    } else {
      // Ook bij succes loggen (geen error-niveau): laat zien hoe dicht een
      // sessie bij Groq's eigen TPM/RPM-plafond zit, zodat een opeenvolging
      // van vragen ("vraag 1: ok, vraag 2: ok, vraag 3: faalt") in de logs
      // te herleiden is tot het daadwerkelijke, resterende Groq-budget.
      console.log(`[kenniscentrum-chat] provider "${provider.id}" slaagde na ${durationMs}ms${rateLimitSuffix}`);
    }
    if (result.ok) {
      return { ok: true, input: result.input, providerId: result.providerId, attempted };
    }
    lastError = result.error;
  }

  return { ok: false, error: lastError || 'Alle geconfigureerde providers faalden.', attempted, errorCategory: lastErrorCategory };
}
