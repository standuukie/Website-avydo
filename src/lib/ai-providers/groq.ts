// Groq-adapter (secundaire, gratis fallback-provider).
//
// Waarom Groq als fallback: net als Gemini biedt Groq een daadwerkelijk
// gratis API-sleutel zonder creditcard, met eigen (lagere maar nog steeds
// bruikbare) gratis-tier-limieten die volledig onafhankelijk zijn van
// Google — zo vallen beide providers niet tegelijk uit bij bijvoorbeeld
// een storing of een uitgeputte quota bij één van de twee. Groq's API is
// OpenAI-compatibel en ondersteunt een gedwongen tool_choice, wat dezelfde
// betrouwbare structured-outputgarantie geeft.
import type { AiProvider, ProviderCallResult } from './types';

// Override met de GROQ_MODEL-env-var indien gewenst. 70B-versie gekozen
// (i.p.v. de kleinere/snellere 8B-variant) omdat deze provider alleen als
// fallback dient (dus minder gevoelig voor het hogere quotumverbruik van
// het grotere model) en een merkbaar betere Nederlandstalige kwaliteit
// geeft voor fiscale uitleg.
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export const groqProvider: AiProvider = {
  id: 'groq',
  label: 'Groq (gratis)',

  isConfigured() {
    return Boolean(import.meta.env.GROQ_API_KEY);
  },

  async call({ systemPrompt, messages, tool, maxOutputTokens, timeoutMs }): Promise<ProviderCallResult> {
    const apiKey = import.meta.env.GROQ_API_KEY;
    const model = import.meta.env.GROQ_MODEL || DEFAULT_MODEL;
    if (!apiKey) {
      return { ok: false, error: 'Groq is niet geconfigureerd (GROQ_API_KEY ontbreekt).', providerId: 'groq' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: maxOutputTokens,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          tools: [
            {
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.schema },
            },
          ],
          tool_choice: { type: 'function', function: { name: tool.name } },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Groq API ${res.status}: ${text.slice(0, 300)}`, providerId: 'groq' };
      }

      const data = await res.json();
      const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
      const rawArgs = toolCall?.function?.arguments;
      if (typeof rawArgs !== 'string') {
        return { ok: false, error: 'Geen geldig tool-antwoord ontvangen van Groq.', providerId: 'groq' };
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        return { ok: false, error: 'Ongeldige JSON-output van Groq.', providerId: 'groq' };
      }
      if (typeof parsedArgs !== 'object' || parsedArgs === null) {
        return { ok: false, error: 'Onverwacht antwoordformaat van Groq.', providerId: 'groq' };
      }

      return { ok: true, input: parsedArgs as Record<string, unknown>, providerId: 'groq' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'onbekende fout';
      return { ok: false, error: `Netwerkfout of timeout bij aanroep Groq: ${message}`, providerId: 'groq' };
    } finally {
      clearTimeout(timer);
    }
  },
};
