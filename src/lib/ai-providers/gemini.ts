// Google Gemini-adapter — beschikbaar, maar NIET meer in de standaard
// gratis providerketen (zie index.ts, resolveProviderChain).
//
// BELANGRIJK: Google's Gemini API Additional Terms of Service staan de
// GRATIS tier alleen toe als de applicatie geen gebruikers bedient in de
// Europese Economische Ruimte, Zwitserland of het VK
// ("You may use only Paid Services when making API Clients available to
// users in the European Economic Area, Switzerland, or the United
// Kingdom" — ai.google.dev/gemini-api/terms). Avydo bedient Nederlandse
// mkb-ondernemers, dus de gratis tier is voor déze toepassing
// contractueel niet toegestaan. Google kan verzoeken vanuit een
// EER-geregistreerd account/project daardoor weigeren of beperken, ook
// als sleutel, endpoint, model en requestvorm verder correct zijn.
//
// Deze adapter blijft functioneel intact voor wie Google Cloud Billing
// inschakelt op het AI Studio-project (dat maakt het gebruik een "Paid
// Service", waarmee de EER-beperking vervalt) en dan expliciet
// AI_PROVIDER=gemini (of "free-with-paid-fallback", na aanpassing van de
// keten in index.ts) instelt. Zie README voor de volledige toelichting.
//
// Verder ongewijzigd: Google AI Studio geeft een daadwerkelijk gratis
// API-sleutel zonder creditcard (voor niet-EER-gebruik), met een ruime
// gratis-tier-quota (in de orde van 15 requests/minuut en 1500
// requests/dag, afhankelijk van het model — zie README). Het model
// ondersteunt gedwongen function calling
// (toolConfig.functionCallingConfig.mode = "ANY"), wat dezelfde
// betrouwbare, valideerbare structured-output-garantie geeft als bij
// Anthropic/Groq: het model MOET de opgegeven tool aanroepen, en de
// server valideert de output alsnog zelf (zie kenniscentrum-chat.ts).
// De requestopbouw hieronder (endpoint, "x-goog-api-key"-header, model-
// alias, tool-schema) is live tegen de echte API geverifieerd: een
// (opzettelijk) ongeldige sleutel gaf de verwachte, specifieke
// "API_KEY_INVALID"-fout terug in plaats van een generieke of
// route-/schemafout — dat bevestigt dat dit deel van de integratie
// technisch correct is.
//
// Let op (privacy, zie ook README): bij gebruik van de gratis tier mag
// Google in-/output gebruiken om producten te verbeteren (na anonimisering
// vóór menselijke review). Bij een Paid Service (billing ingeschakeld)
// geldt dit niet.
import type { AiProvider, ProviderCallResult } from './types';

// "gemini-flash-latest" is een door Google onderhouden alias die altijd
// naar het actuele aanbevolen, snelle Flash-model wijst (met een
// aankondiging van 2 weken bij breaking changes) — dit voorkomt dat de
// code een specifieke modelversie hardcodeert die na verloop van tijd
// wordt uitgefaseerd. Override met de GEMINI_MODEL-env-var indien gewenst.
const DEFAULT_MODEL = 'gemini-flash-latest';

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini (gratis)',

  isConfigured() {
    return Boolean(import.meta.env.GEMINI_API_KEY);
  },

  async call({ systemPrompt, messages, tool, maxOutputTokens, timeoutMs }): Promise<ProviderCallResult> {
    const apiKey = import.meta.env.GEMINI_API_KEY;
    const model = import.meta.env.GEMINI_MODEL || DEFAULT_MODEL;
    if (!apiKey) {
      return { ok: false, error: 'Gemini is niet geconfigureerd (GEMINI_API_KEY ontbreekt).', providerId: 'gemini' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          // Gemini gebruikt "model" in plaats van "assistant" als rol.
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          tools: [
            {
              functionDeclarations: [
                {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.schema,
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] },
          },
          generationConfig: {
            maxOutputTokens,
            temperature: 0.3,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Gemini API ${res.status}: ${text.slice(0, 300)}`, providerId: 'gemini' };
      }

      const data = await res.json();
      const parts: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }> =
        data?.candidates?.[0]?.content?.parts ?? [];
      const functionCall = parts.find((p) => p.functionCall)?.functionCall;

      if (!functionCall || typeof functionCall.args !== 'object' || functionCall.args === null) {
        return { ok: false, error: 'Geen geldig tool-antwoord ontvangen van Gemini.', providerId: 'gemini' };
      }

      return { ok: true, input: functionCall.args, providerId: 'gemini' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'onbekende fout';
      return { ok: false, error: `Netwerkfout of timeout bij aanroep Gemini: ${message}`, providerId: 'gemini' };
    } finally {
      clearTimeout(timer);
    }
  },
};
