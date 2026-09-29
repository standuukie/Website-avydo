// Regressietests voor de foutclassificatie- en retry-beleidslogica
// (src/lib/error-classify.mjs) gebruikt door de AI-providers
// (src/lib/ai-providers/groq.ts, index.ts). Draait met Node's ingebouwde
// testrunner: `npm run kenniscentrum:test` — geen live Groq-aanroep nodig:
// dit is pure beslislogica, getest tegen de exacte foutmeldingtekst die
// groq.ts/gemini.ts/anthropic.ts daadwerkelijk produceren.
import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeProviderError, shouldRetryProviderError } from '../../src/lib/error-classify.mjs';

// --- categorizeProviderError --------------------------------------------

test('categoriseert Groq/Gemini/Anthropic API-foutmeldingen op HTTP-status', () => {
  assert.equal(categorizeProviderError('Groq API 429 (model="openai/gpt-oss-20b"): rate limit exceeded'), 'rate_limited');
  assert.equal(categorizeProviderError('Groq API 401 (model="openai/gpt-oss-20b"): invalid api key'), 'client_error');
  assert.equal(categorizeProviderError('Groq API 403 (model="openai/gpt-oss-20b"): forbidden'), 'client_error');
  assert.equal(categorizeProviderError('Groq API 404 (model="openai/gpt-oss-20b"): model not found'), 'client_error');
  assert.equal(categorizeProviderError('Groq API 413 (model="openai/gpt-oss-20b"): payload too large'), 'client_error');
  assert.equal(categorizeProviderError('Groq API 422 (model="openai/gpt-oss-20b"): unprocessable entity'), 'client_error');
  assert.equal(categorizeProviderError('Groq API 500 (model="openai/gpt-oss-20b"): internal server error'), 'server_error');
  assert.equal(categorizeProviderError('Groq API 502 (model="openai/gpt-oss-20b"): bad gateway'), 'server_error');
  assert.equal(categorizeProviderError('Groq API 503 (model="openai/gpt-oss-20b"): service unavailable'), 'server_error');
});

test('categoriseert timeout apart van een algemene netwerkfout', () => {
  assert.equal(categorizeProviderError('Timeout bij aanroep Groq (limiet 25000ms): The operation was aborted.'), 'timeout');
  assert.equal(categorizeProviderError('Netwerkfout bij aanroep Groq: fetch failed'), 'network');
});

test('categoriseert een misvormd/ontbrekend tool-antwoord als malformed_response', () => {
  assert.equal(categorizeProviderError('Geen geldig tool-antwoord ontvangen van Groq.'), 'malformed_response');
  assert.equal(categorizeProviderError('Ongeldige JSON-output van Groq.'), 'malformed_response');
  assert.equal(categorizeProviderError('Onverwacht antwoordformaat van Groq.'), 'malformed_response');
});

test('categoriseert een ontbrekende API-sleutel als not_configured', () => {
  assert.equal(categorizeProviderError('Groq is niet geconfigureerd (GROQ_API_KEY ontbreekt).'), 'not_configured');
});

test('herkent de categorie ook nog als de foutmelding "(na 1 retry)" bevat', () => {
  // groq.ts hangt dit achter de foutmelding van de TWEEDE (herhaalde)
  // poging — de categorie moet dus op basis van de status/tekst ervoor
  // blijven werken, niet breken op de toegevoegde suffix.
  assert.equal(categorizeProviderError('Groq API 500 (model="openai/gpt-oss-20b"): internal server error (na 1 retry)'), 'server_error');
});

// --- shouldRetryProviderError -------------------------------------------
// Testscenario's C/D/E/F uit de opdracht: Groq 429 -> juiste categorie (en,
// sinds ronde 4, NOOIT een retry — zie hieronder), Groq 500 -> één retry,
// Groq 401 -> geen retry.

// Ronde 4 (2026-09-29): een 429-retry is bewust GESCHRAPT, ook mét een korte
// Retry-After. Live testen liet zien dat een 429 vrijwel altijd betekent dat
// het TPM/RPM-venster van déze minuut al vol zit — een tweede aanroep
// binnen dezelfde minuut (zelfs na een paar seconden wachten) faalt dan
// hoogstwaarschijnlijk opnieuw en verspilt alleen budget dat de VOLGENDE
// vraag van de bezoeker nodig heeft. In plaats daarvan gaat de route direct
// naar de kennisbank-fallback (indien beschikbaar) of de nette
// provider_rate_limited-melding.
test('C/D: Groq 429 wordt NOOIT geretryd, ook niet met een korte Retry-After (voorkomt budgetverspilling in een al vol venster)', () => {
  assert.equal(shouldRetryProviderError({ status: 429 }).retry, false);
});

test('E: Groq 500 (en andere 5xx) krijgt altijd één retry, met backoff + jitter', () => {
  const decision = shouldRetryProviderError({ status: 500, random: () => 0.5 });
  assert.equal(decision.retry, true);
  assert.ok(decision.delayMs > 0);

  for (const status of [500, 502, 503, 504]) {
    assert.equal(shouldRetryProviderError({ status, random: () => 0 }).retry, true, `status ${status} zou geretryd moeten worden`);
  }
});

test('F: Groq 401 wordt nooit geretryd (geen tijdelijke storing)', () => {
  assert.equal(shouldRetryProviderError({ status: 401 }).retry, false);
});

test('403/404/413/422 (en elke andere 4xx) worden nooit geretryd', () => {
  for (const status of [400, 403, 404, 409, 413, 422]) {
    assert.equal(shouldRetryProviderError({ status }).retry, false, `status ${status} zou NIET geretryd moeten worden`);
  }
});

test('de jitter op een 5xx-retry blijft binnen de verwachte bandbreedte (nooit een onbegrensde/agressieve retry-loop)', () => {
  const low = shouldRetryProviderError({ status: 500, random: () => 0 });
  const high = shouldRetryProviderError({ status: 500, random: () => 1 });
  assert.ok(low.delayMs >= 400 && low.delayMs <= 800);
  assert.ok(high.delayMs >= 400 && high.delayMs <= 800);
});

// ---------------------------------------------------------------------
// Structurele controle van de ECHTE providerbestanden: bevestigt dat
// groq.ts daadwerkelijk shouldRetryProviderError gebruikt (niet een eigen,
// losgezongen kopie van de retry-logica) en dat index.ts daadwerkelijk
// categorizeProviderError gebruikt voor de errorCategory die de route
// (kenniscentrum-chat.ts) nodig heeft om provider_rate_limited van
// provider_unavailable te onderscheiden.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GROQ_FILE = path.resolve(__dirname, '../../src/lib/ai-providers/groq.ts');
const INDEX_FILE = path.resolve(__dirname, '../../src/lib/ai-providers/index.ts');
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');

test('groq.ts gebruikt de gedeelde shouldRetryProviderError, geen eigen dubbele retry-drempels', () => {
  const text = readFileSync(GROQ_FILE, 'utf-8');
  assert.match(text, /shouldRetryProviderError/);
  assert.match(text, /from '@\/lib\/error-classify\.mjs'/);
  // Geen retryAfterHeaderSeconds meer doorgegeven (ronde 4: 429 wordt nooit
  // meer geretryd, dus die parameter is overbodig geworden).
  assert.ok(!text.includes('retryAfterHeaderSeconds'), 'groq.ts geeft geen retryAfterHeaderSeconds meer door aan shouldRetryProviderError');
});

test('groq.ts geeft Groq\'s echte remaining/limit tokens gestructureerd door (niet alleen als platte tekst)', () => {
  const text = readFileSync(GROQ_FILE, 'utf-8');
  assert.match(text, /remainingTokens/);
  assert.match(text, /limitTokens/);
  assert.match(text, /x-ratelimit-remaining-tokens/);
  assert.match(text, /x-ratelimit-limit-tokens/);
});

test('de route stelt de lokale TPM-boekhouding bij met Groq\'s echte remaining/limit tokens (zelfcorrectie)', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /result\.remainingTokens/);
  assert.match(text, /result\.limitTokens/);
  assert.match(text, /tpmLimiter\.record/);
});

test('een geblokkeerd verzoek (RPM of TPM) probeert eerst de kennisbank-fallback vóór de blokkademelding', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /function rateLimitedResponse/);
  assert.match(text, /findDeterministicFallbackItem/);
  // Beide precheck-plekken (RPM en TPM) moeten via dezelfde helper gaan —
  // 1 keer de functiedeclaratie zelf + minstens 2 aanroepen (RPM + TPM).
  const occurrences = [...text.matchAll(/rateLimitedResponse\(/g)].length;
  assert.ok(occurrences >= 3, `verwacht de declaratie + minstens 2 aanroepen van rateLimitedResponse (RPM- en TPM-precheck), telde ${occurrences} voorkomens`);
});

test('index.ts gebruikt categorizeProviderError en geeft errorCategory door in AiCallOutcome', () => {
  const text = readFileSync(INDEX_FILE, 'utf-8');
  assert.match(text, /categorizeProviderError/);
  assert.match(text, /errorCategory/);
});

test('de route geeft drie verschillende gebruikersmeldingen voor rate_limited/provider_rate_limited/provider_unavailable', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /code: 'rate_limited'/);
  assert.match(text, /code: 'provider_rate_limited'/);
  assert.match(text, /code: 'provider_unavailable'/);
  assert.match(text, /Je hebt in korte tijd veel vragen gesteld\. Probeer het over een moment opnieuw\./);
  assert.match(text, /De AI-assistent verwerkt op dit moment veel aanvragen\. Probeer het over een moment opnieuw\./);
  assert.match(text, /De AI-assistent is tijdelijk niet beschikbaar\. Probeer het opnieuw\./);
  // De drie meldingen moeten daadwerkelijk verschillend zijn — nooit meer
  // dezelfde generieke tekst voor alle situaties (zie opdracht, punt 10).
  // (De oude tekst mag nog in een historische incident-toelichting/comment
  // voorkomen — alleen niet meer als daadwerkelijke `error:`-waarde.)
  const upstreamErrorGone = !/error: '[^']*De assistent kan momenteel geen antwoord genereren/.test(text);
  assert.ok(upstreamErrorGone, 'de oude, generieke upstream_error-tekst hoort niet meer als daadwerkelijke foutmelding in de route te staan');
});
