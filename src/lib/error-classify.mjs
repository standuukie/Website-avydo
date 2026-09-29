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
 * @returns {'rate_limited' | 'server_error' | 'client_error' | 'timeout' | 'network' | 'malformed_response' | 'not_configured' | 'unknown'}
 */
export function categorizeProviderError(error) {
  const statusMatch = error.match(/API (\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';
    if (status >= 400) return 'client_error';
  }
  if (/timeout|abort/i.test(error)) return 'timeout';
  if (/netwerkfout/i.test(error)) return 'network';
  if (/JSON-output|tool-antwoord|antwoordformaat/i.test(error)) return 'malformed_response';
  if (/niet geconfigureerd/i.test(error)) return 'not_configured';
  return 'unknown';
}

// Een Retry-After langer dan dit is niet de moeite waard om binnen één
// serverless-requestbudget op te wachten — zie ook FETCH_TIMEOUT_MS in
// kenniscentrum-chat.ts (het totale requestbudget is eindig, en een lange
// wacht + retry zou dat budget grotendeels opsouperen voor niets).
export const MAX_RETRYABLE_DELAY_MS = 3_000;
export const SERVER_ERROR_BASE_DELAY_MS = 400;
export const SERVER_ERROR_JITTER_MS = 400;

/**
 * Retry-BELEID (geen mechaniek): gegeven een HTTP-statuscode en een
 * eventuele Retry-After-header (in seconden, zoals Groq die stuurt), bepaalt
 * dit of één gecontroleerde retry zinvol is, en met welke vertraging.
 * - 429: alleen retryen als Retry-After aanwezig, geldig én kort genoeg is
 *   (MAX_RETRYABLE_DELAY_MS) — anders direct doorgeven dat de provider het
 *   druk heeft, nooit blind wachten/retryen.
 * - 5xx: altijd één retry, met vaste basisvertraging + willekeurige jitter
 *   (voorkomt dat meerdere gelijktijdige requests exact tegelijk opnieuw
 *   proberen — "thundering herd").
 * - Elke andere status (401/403/404/413/422/andere 4xx): nooit retryen —
 *   dit zijn geen tijdelijke storingen, een retry verspilt alleen budget.
 * @param {{ status: number, retryAfterHeaderSeconds?: number | null, random?: () => number }} args
 * @returns {{ retry: false } | { retry: true, delayMs: number }}
 */
export function shouldRetryProviderError({ status, retryAfterHeaderSeconds, random = Math.random }) {
  if (status === 429) {
    const retryAfterMs = typeof retryAfterHeaderSeconds === 'number' ? retryAfterHeaderSeconds * 1000 : NaN;
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= MAX_RETRYABLE_DELAY_MS) {
      return { retry: true, delayMs: retryAfterMs };
    }
    return { retry: false };
  }
  if (status >= 500) {
    return { retry: true, delayMs: SERVER_ERROR_BASE_DELAY_MS + random() * SERVER_ERROR_JITTER_MS };
  }
  return { retry: false };
}
