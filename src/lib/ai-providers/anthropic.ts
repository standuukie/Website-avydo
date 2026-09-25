// Anthropic Claude-adapter (optionele, betaalde provider).
//
// Dit is de oorspronkelijke integratie, ongewijzigd qua gedrag maar nu
// achter de provider-abstractie gezet. Ze wordt NIET meer standaard
// gebruikt: de standaardketen (AI_PROVIDER=free, of geen waarde) gebruikt
// uitsluitend de gratis providers (Gemini, Groq). Anthropic wordt alleen
// aangeroepen als de beheerder dit expliciet configureert via
// AI_PROVIDER=anthropic (uitsluitend Anthropic) of
// AI_PROVIDER=free-with-paid-fallback (Anthropic pas als laatste, betaalde
// redmiddel ná de gratis providers) — zie src/lib/ai-providers/index.ts.
import type { AiProvider, ProviderCallResult } from './types';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude (betaald)',

  isConfigured() {
    return Boolean(import.meta.env.ANTHROPIC_API_KEY);
  },

  async call({ systemPrompt, messages, tool, maxOutputTokens, timeoutMs }): Promise<ProviderCallResult> {
    const apiKey = import.meta.env.ANTHROPIC_API_KEY;
    const model = import.meta.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    if (!apiKey) {
      return { ok: false, error: 'Anthropic is niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt).', providerId: 'anthropic' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          temperature: 0.3,
          system: systemPrompt,
          messages,
          tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
          tool_choice: { type: 'tool', name: tool.name },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Anthropic API ${res.status}: ${text.slice(0, 300)}`, providerId: 'anthropic' };
      }

      const data = await res.json();
      const toolUse = (data?.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
      if (!toolUse || typeof toolUse.input !== 'object') {
        return { ok: false, error: 'Geen geldig tool-antwoord ontvangen van Anthropic.', providerId: 'anthropic' };
      }

      return { ok: true, input: toolUse.input, providerId: 'anthropic' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'onbekende fout';
      return { ok: false, error: `Netwerkfout of timeout bij aanroep Anthropic: ${message}`, providerId: 'anthropic' };
    } finally {
      clearTimeout(timer);
    }
  },
};
