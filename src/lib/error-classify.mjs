// Providerneutrale, framework-onafhankelijke foutclassificatie- en
// retry-beleidslogica voor de AI-providers (zie src/lib/ai-providers/).
// Bewust een los, plain .mjs-bestand (zelfde patroon als knowledge-match.mjs
// / rate-limit.mjs / token-estimate.mjs): dit is PURE beslislogica zonder
// netwerk-/IO-afhankelijkheden, dus rechtstreeks te testen met Node's
// ingebouwde testrunner (`npm run kenniscentrum:test`,
// scripts/kenniscentrum/error-classify.test.mjs) — geen live Groq-aanroep
// nodig om te verifiëren dat een 429 als rate_limited geldt, een 500 als
// server_error, enzovoort. De feitelijke fetch/AbortController-mechaniek
// blijft in src/lib/ai-providers/groq.ts (TypeScript, provider-specifiek).

/**
 * Bepaalt een grove, veilig te loggen foutcategorie uit de foutmelding van
 * een provider-adapter (die zelf uitsluitend HTTP-status + ingekorte
 * responstekst bevat, zie gemini.ts/groq.ts/anthropic.ts) — puur voor
 * diagnose in de serverlogs/foutafhandeling, bevat zelf geen gevoelige data.
 * @param {string} error
 * @returns {'rate_limited' | 'provider_daily_limit' | 'server_error' | 'client_error' | 'timeout' | 'network' | 'malformed_response' | 'not_configured' | 'unknown'}
 */
export function categorizeProviderError(error) {
  const statusMatch = error.match(/API (\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 429) {
      // Incident 2026-09-30 (ronde 6): een live Production-log liet een
      // Groq 429 zien met "Limit 200000, Used 198358, Requested 2171" op
      // "tokens per day (TPD)" — een FUNDAMENTEEL andere situatie dan een
      // gewone RPM/TPM-429 (die binnen seconden/minuten vanzelf weer ruimte
      // geeft). Groq's eigen TPD-foutmelding noemt expliciet "tokens per
      // day" of "TPD" — dat onderscheidt 'm betrouwbaar van een RPM/TPM-429
      // (die dat niet doet), zonder dat hiervoor een aparte lokale
      // dagteller nodig is (zie kenniscentrum-chat.ts, punt 7: de
      // applicatie kan Groq's ACCOUNT-BREDE TPD toch niet betrouwbaar zelf
      // bijhouden — Groq's eigen 429-respons is hier de bron van waarheid).
      if (/tokens per day|\bTPD\b/i.test(error)) return 'provider_daily_limit';
      return 'rate_limited';
    }
    if (status >= 500) return 'server_error';
    if (status >= 400) return 'client_error';
  }
  if (/timeout|abort/i.test(error)) return 'timeout';
  if (/netwerkfout/i.test(error)) return 'network';
  if (/JSON-output|tool-antwoord|antwoordformaat/i.test(error)) return 'malformed_response';
  if (/niet geconfigureerd/i.test(error)) return 'not_configured';
  return 'unknown';
}

export const SERVER_ERROR_BASE_DELAY_MS = 400;
export const SERVER_ERROR_JITTER_MS = 400;

/**
 * Retry-BELEID (geen mechaniek): gegeven een HTTP-statuscode, bepaalt dit of
 * één gecontroleerde retry zinvol is, en met welke vertraging.
 * - 429: NOOIT retryen (ronde 4). Een 429 van Groq betekent bijna altijd dat
 *   het TPM- of RPM-venster van DEZE minuut al vol zit — een tweede
 *   aanroep binnen datzelfde venster (zelfs na Retry-After) faalt dan
 *   hoogstwaarschijnlijk opnieuw en verbruikt alleen extra budget dat de
 *   VOLGENDE, mogelijk wél succesvolle vraag van de bezoeker nodig heeft.
 *   In plaats daarvan direct doorgeven aan de kennisbank-fallback (indien
 *   beschikbaar) of de nette provider_rate_limited-melding — zie
 *   kenniscentrum-chat.ts. Dit geldt EXTRA hard voor een TPD-429 (ronde 6,
 *   errorCategory 'provider_daily_limit'): Retry-After ligt daarbij typisch
 *   op meerdere MINUTEN tot UREN, dus een retry binnen dit verzoek zou
 *   sowieso nooit op tijd zijn — nooit automatisch retryen, alleen de
 *   Retry-After-waarde loggen/gebruiken voor de fallback (zie hieronder).
 * - 5xx: altijd één retry, met vaste basisvertraging + willekeurige jitter
 *   (voorkomt dat meerdere gelijktijdige requests exact tegelijk opnieuw
 *   proberen — "thundering herd"). Een 5xx is typisch een voorbijgaande
 *   serverglitch, geen budgetprobleem, dus een enkele retry is hier wél
 *   zinvol.
 * - Elke andere status (401/403/404/413/422/andere 4xx): nooit retryen —
 *   dit zijn geen tijdelijke storingen, een retry verspilt alleen budget.
 * @param {{ status: number, random?: () => number }} args
 * @returns {{ retry: false } | { retry: true, delayMs: number }}
 */
export function shouldRetryProviderError({ status, random = Math.random }) {
  if (status === 429) return { retry: false };
  if (status >= 500) {
    return { retry: true, delayMs: SERVER_ERROR_BASE_DELAY_MS + random() * SERVER_ERROR_JITTER_MS };
  }
  return { retry: false };
}
