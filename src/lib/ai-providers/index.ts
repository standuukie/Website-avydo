// Provider-orchestratie voor de AI-assistent: bepaalt op basis van de
// AI_PROVIDER-environment variable welke keten van providers geprobeerd
// wordt, en valt bij een fout automatisch terug op de volgende provider
// in de keten (nooit stilzwijgend naar een betaalde provider, tenzij
// expliciet geconfigureerd — zie resolveProviderChain hieronder).
import { geminiProvider } from './gemini';
import { groqProvider } from './groq';
import { anthropicProvider } from './anthropic';
import type { AiProvider, ChatMessage, ToolDefinition } from './types';

export type { ChatMessage, ToolDefinition } from './types';

const PROVIDERS_BY_ID: Record<string, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  anthropic: anthropicProvider,
};

/**
 * AI_PROVIDER bepaalt de te gebruiken keten:
 * - onbekend/leeg/"free" (standaard, veilig): [gemini, groq] — beide
 *   gratis, nooit betaald, zodat een bezoeker nooit ongemerkt kosten kan
 *   veroorzaken doordat een gratis provider uitvalt.
 * - "free-with-paid-fallback": [gemini, groq, anthropic] — expliciete,
 *   bewuste opt-in om Anthropic als allerlaatste (betaald) redmiddel te
 *   gebruiken wanneer beide gratis providers falen.
 * - "gemini" / "groq" / "anthropic": alleen die ene provider (handig om
 *   gericht te testen, of om bijvoorbeeld volledig op Anthropic over te
 *   schakelen).
 */
function resolveProviderChain(): AiProvider[] {
  const setting = (import.meta.env.AI_PROVIDER || 'free').trim().toLowerCase();

  if (setting === 'free-with-paid-fallback') return [geminiProvider, groqProvider, anthropicProvider];
  if (setting in PROVIDERS_BY_ID) return [PROVIDERS_BY_ID[setting]];

  // "free" of een onbekende waarde: val terug op de veilige, gratis keten.
  return [geminiProvider, groqProvider];
}

export interface AiCallOutcome {
  ok: boolean;
  input?: Record<string, unknown>;
  error?: string;
  providerId?: string;
  /** Welke provider-id's daadwerkelijk geprobeerd zijn, voor logging/diagnose. */
  attempted: string[];
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
    return { ok: false, error: 'Geen enkele AI-provider is geconfigureerd.', attempted };
  }

  let lastError = '';
  for (const provider of chain) {
    attempted.push(provider.id);
    const result = await provider.call(args);
    if (result.ok) {
      return { ok: true, input: result.input, providerId: result.providerId, attempted };
    }
    lastError = result.error;
  }

  return { ok: false, error: lastError || 'Alle geconfigureerde providers faalden.', attempted };
}
