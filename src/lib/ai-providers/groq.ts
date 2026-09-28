// Groq-adapter (standaard, gratis provider — zie index.ts).
//
// Waarom Groq: een daadwerkelijk gratis API-sleutel zonder creditcard, met
// eigen gratis-tier-limieten, zonder de EER-beperking die Google's Gemini
// gratis tier voor deze site oplegt (zie index.ts/gemini.ts). Groq's API is
// OpenAI-compatibel en ondersteunt een gedwongen tool_choice, wat dezelfde
// betrouwbare structured-outputgarantie geeft.
//
// LET OP (incident 28-9-2026): het voormalige standaardmodel
// "llama-3.3-70b-versatile" is door Groq gedecommissioneerd op 16-8-2026
// (aangekondigd 17-6-2026); sindsdien geeft elk verzoek met dat modelnaam
// een 404 "model does not exist" terug, wat bij de gebruiker verscheen als
// "De assistent kon nu niet antwoorden" (upstream_error), ook mét een
// correct geconfigureerde GROQ_API_KEY. Groq's eigen aanbevolen vervanger
// is "openai/gpt-oss-120b"; hier is bewust gekozen voor het kleinere
// "openai/gpt-oss-20b", omdat dat op moment van schrijven het enige van de
// twee is dat door alle geraadpleegde bronnen zonder voorbehoud als
// onderdeel van Groq's gratis, creditcard-loze tier wordt bevestigd
// (ondersteunt function calling/tool_choice). Controleer bij een
// toekomstige wijziging van GROQ_MODEL altijd eerst console.groq.com/docs/models
// en console.groq.com/docs/deprecations op de actuele status, vóór het
// instellen van een ander model — zowel voor geldigheid als voor de
// gratis/betaald-status (i.v.m. de "nooit ongemerkt kosten"-eis).
import type { AiProvider, ProviderCallResult } from './types';

// Override met de GROQ_MODEL-env-var indien gewenst.
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

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
