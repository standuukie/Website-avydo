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
//
// LET OP (incident 29-9-2026, ronde 3+4): Groq's gratis tier voor
// openai/gpt-oss-20b is niet alleen beperkt in requests/minuut (RPM), maar
// ook in tokens/minuut (TPM) — zie console.groq.com/docs/rate-limits,
// actueel: 30 RPM / 8.000 TPM / 1.000 RPD / 200.000 TPD, site-breed per
// API-sleutel. Bij een langer gesprek (oplopende geschiedenis + bronnen)
// bleek een los verzoek soms al een groot deel van het TPM-budget op te
// souperen, waarna Groq zelf een 429 teruggaf — dat is de kern van de
// "eerst werkt het, dan faalt zelfs een simpele vraag"-klacht: zodra het
// TPM-budget van de huidige minuut op is, faalt ELK volgend verzoek in die
// minuut, ongeacht hoe eenvoudig de vraag zelf is. Zie de token-bewuste
// limiter in kenniscentrum-chat.ts (GROQ_TPM_LIMIT) die dit vóóraf, lokaal,
// probeert te voorkomen. Deze adapter zelf doet, aanvullend: (a) ÉÉN
// gecontroleerde retry bij een Groq 5xx (backoff+jitter) — NOOIT bij 429
// (ronde 4: een 429 betekent bijna altijd dat het venster van déze minuut al
// vol zit, dus een retry zou vrijwel zeker opnieuw falen en alleen budget
// verspillen dat de volgende vraag nodig heeft) en nooit bij
// 401/403/404/413/422 (geen tijdelijke storingen) — en (b) geeft Groq's
// eigen rate-limit-headers gestructureerd terug (remainingTokens/
// limitTokens, niet alleen als opaque tekst), zodat kenniscentrum-chat.ts
// de EIGEN, geschatte TPM-boekhouding kan bijstellen met Groq's echte,
// actuele cijfer in plaats van alleen op de lokale schatting te vertrouwen
// — nooit gebruikt richting de bezoeker, uitsluitend server-side diagnose.
import type { AiProvider, ProviderCallResult } from './types';
import { shouldRetryProviderError } from '@/lib/error-classify.mjs';

// Override met de GROQ_MODEL-env-var indien gewenst.
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

/**
 * Groq's rate-limit-headers, zowel als veilig te loggen platte tekst als
 * (waar aanwezig) gestructureerd voor de token-boekhouding in
 * kenniscentrum-chat.ts. Nooit user-facing.
 */
function parseRateLimitHeaders(headers: Headers): { summary?: string; remainingTokens?: number; limitTokens?: number; retryAfterSeconds?: number } {
  const names = [
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens',
    'retry-after',
  ];
  const parts: string[] = [];
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) parts.push(`${name}=${value}`);
  }
  const remainingTokensRaw = headers.get('x-ratelimit-remaining-tokens');
  const limitTokensRaw = headers.get('x-ratelimit-limit-tokens');
  const remainingTokens = remainingTokensRaw !== null ? Number(remainingTokensRaw) : undefined;
  const limitTokens = limitTokensRaw !== null ? Number(limitTokensRaw) : undefined;
  // Ronde 6 (2026-09-30): structureel (niet alleen als platte tekst in
  // `summary`) uitgelezen zodat kenniscentrum-chat.ts deze kan LOGGEN en
  // eventueel aan de fallback kan koppelen — nooit om automatisch te
  // retryen (zie shouldRetryProviderError/error-classify.mjs: een 429,
  // óók een TPD-429, wordt nooit automatisch geretryd).
  const retryAfterRaw = headers.get('retry-after');
  const retryAfterSeconds = retryAfterRaw !== null ? Number(retryAfterRaw) : undefined;
  return {
    summary: parts.length > 0 ? parts.join(' ') : undefined,
    remainingTokens: Number.isFinite(remainingTokens) ? remainingTokens : undefined,
    limitTokens: Number.isFinite(limitTokens) ? limitTokens : undefined,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
  };
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );
  });
}

interface AttemptOutcome {
  result: ProviderCallResult;
  /** Alleen gezet als deze specifieke poging in aanmerking komt voor ÉÉN retry. */
  retryDelayMs?: number;
}

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

    async function attemptOnce(): Promise<AttemptOutcome> {
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
            // gpt-oss-20b is een redeneermodel: zonder deze parameter gebruikt
            // Groq standaard "medium" redeneerinspanning, wat een substantieel
            // deel van max_tokens aan onzichtbare redeneer-tokens kan
            // opsouperen vóórdat de eigenlijke tool-call wordt geschreven —
            // bij een korte, gestructureerde antwoordvorm zoals hier is dat
            // zelden nodig, en het verhoogt het risico op een afgekapt/
            // onvolledig tool-antwoord (zie 'Ongeldige JSON-output'/'Geen
            // geldig tool-antwoord' hieronder) en verbruikt nodeloos budget
            // van Groq's tokens-per-minuut-limiet. "low" laat het model nog
            // steeds normaal redeneren, maar niet uitgebreider dan nodig voor
            // deze taak.
            reasoning_effort: 'low',
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

        const { summary: rateLimitInfo, remainingTokens, limitTokens, retryAfterSeconds } = parseRateLimitHeaders(res.headers);

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          // Modelnaam bewust in de foutmelding opgenomen (geen secret) zodat de
          // Vercel-serverlogs direct laten zien welk model daadwerkelijk naar
          // Groq is verstuurd — essentieel om een verouderde deployment of een
          // GROQ_MODEL-env-var-override te kunnen onderscheiden van een echt
          // ongeldig modelnaam in de code zelf.
          const error = `Groq API ${res.status} (model="${model}"): ${text.slice(0, 300)}`;
          const result: ProviderCallResult = { ok: false, error, providerId: 'groq', rateLimitInfo, remainingTokens, limitTokens, retryAfterSeconds };

          // Retry-BELEID (welke status + welke vertraging) komt uit de
          // gedeelde, puur getestte error-classify.mjs — alleen 5xx (met
          // backoff+jitter) komt in aanmerking voor ÉÉN retry; een 429 wordt
          // (sinds ronde 4) nooit geretryd — dat zou binnen hetzelfde,
          // waarschijnlijk nog altijd volle TPM/RPM-venster alleen maar
          // extra budget verspillen — en 401/403/404/413/422/andere 4xx
          // zijn sowieso geen tijdelijke storingen (zie shouldRetryProviderError).
          const retryDecision = shouldRetryProviderError({ status: res.status });
          return retryDecision.retry ? { result, retryDelayMs: retryDecision.delayMs } : { result };
        }

        const data = await res.json();
        const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
        const rawArgs = toolCall?.function?.arguments;
        if (typeof rawArgs !== 'string') {
          return { result: { ok: false, error: 'Geen geldig tool-antwoord ontvangen van Groq.', providerId: 'groq', rateLimitInfo, remainingTokens, limitTokens } };
        }

        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          return { result: { ok: false, error: 'Ongeldige JSON-output van Groq.', providerId: 'groq', rateLimitInfo, remainingTokens, limitTokens } };
        }
        if (typeof parsedArgs !== 'object' || parsedArgs === null) {
          return { result: { ok: false, error: 'Onverwacht antwoordformaat van Groq.', providerId: 'groq', rateLimitInfo, remainingTokens, limitTokens } };
        }

        return { result: { ok: true, input: parsedArgs as Record<string, unknown>, providerId: 'groq', rateLimitInfo, remainingTokens, limitTokens } };
      } catch (err) {
        // err.name is hier bewust apart opgenomen (naast err.message): bij een
        // afgebroken verzoek door FETCH_TIMEOUT_MS is dit altijd "AbortError",
        // wat een echte timeout betrouwbaar onderscheidt van een andere
        // netwerkfout (DNS/verbinding) voor de foutcategorisatie in index.ts —
        // bevat geen gevoelige data, uitsluitend de technische foutnaam.
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        const message = err instanceof Error ? err.message : 'onbekende fout';
        return {
          result: {
            ok: false,
            error: isTimeout ? `Timeout bij aanroep Groq (limiet ${timeoutMs}ms): ${message}` : `Netwerkfout bij aanroep Groq: ${message}`,
            providerId: 'groq',
          },
        };
      }
    }

    try {
      const first = await attemptOnce();
      if (first.retryDelayMs === undefined) {
        return first.result;
      }
      // Precies één gecontroleerde retry, met exponential-backoff+jitter
      // voor 5xx of Groq's eigen Retry-After voor 429 — nooit meerdere
      // pogingen achter elkaar (dat zou een providerfout juist kunnen
      // verergeren tot een nieuw rate-limitprobleem, zie opdracht).
      await sleepUnlessAborted(first.retryDelayMs, controller.signal);
      const retried = await attemptOnce();
      if (!retried.result.ok) {
        return { ...retried.result, error: `${retried.result.error} (na 1 retry)` };
      }
      return retried.result;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const message = err instanceof Error ? err.message : 'onbekende fout';
      return {
        ok: false,
        error: isTimeout ? `Timeout bij aanroep Groq (limiet ${timeoutMs}ms): ${message}` : `Netwerkfout bij aanroep Groq: ${message}`,
        providerId: 'groq',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
