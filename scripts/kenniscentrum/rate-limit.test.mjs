// Regressietests voor de sliding-window rate limiter
// (src/lib/rate-limit.mjs) gebruikt door de AI-assistent
// (src/pages/api/kenniscentrum-chat.ts). Draait met Node's ingebouwde
// testrunner: `npm run kenniscentrum:test` — geen live Groq-aanroep nodig,
// en geen wall-clock wachttijd: elke test injecteert zijn eigen `now`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlidingWindowLimiter } from '../../src/lib/rate-limit.mjs';
import { findDeterministicFallbackItem } from '../../src/lib/knowledge-match.mjs';

test('een normale reeks van meerdere requests binnen de limiet blokkeert niet', () => {
  // Simuleert een echt gesprek: 8 vragen kort na elkaar, ruim onder de
  // (nu verruimde) limiet van 30 per 5 minuten per IP.
  const limiter = createSlidingWindowLimiter({ windowMs: 5 * 60_000, max: 30 });
  const ip = '203.0.113.10';
  let now = 1_000_000;
  for (let i = 0; i < 8; i++) {
    assert.equal(limiter.isLimited(ip, now), false, `verzoek ${i + 1} zou niet geblokkeerd moeten worden`);
    limiter.record(ip, now);
    now += 5_000; // 5 seconden tussen elke vraag
  }
  assert.equal(limiter.isLimited(ip, now), false);
});

test('een excessieve reeks requests wordt wel geblokkeerd', () => {
  const max = 30;
  const limiter = createSlidingWindowLimiter({ windowMs: 5 * 60_000, max });
  const ip = '203.0.113.20';
  let now = 1_000_000;
  for (let i = 0; i < max; i++) {
    assert.equal(limiter.isLimited(ip, now), false);
    limiter.record(ip, now);
    now += 100; // snel achter elkaar, binnen hetzelfde venster
  }
  // De (max+1)e binnen hetzelfde venster moet nu geblokkeerd worden.
  assert.equal(limiter.isLimited(ip, now), true);
});

test('de limiet reset zodra het tijdvenster verstrijkt (sliding window)', () => {
  const windowMs = 60_000;
  const max = 3;
  const limiter = createSlidingWindowLimiter({ windowMs, max });
  const ip = '203.0.113.30';
  let now = 1_000_000;

  for (let i = 0; i < max; i++) {
    limiter.record(ip, now);
  }
  assert.equal(limiter.isLimited(ip, now), true, 'limiet zou nu bereikt moeten zijn');

  // Net vóór het venster verstrijkt: nog steeds geblokkeerd.
  assert.equal(limiter.isLimited(ip, now + windowMs - 1), true);

  // Ná het venster: de oude hits tellen niet meer mee, dus niet meer geblokkeerd.
  assert.equal(limiter.isLimited(ip, now + windowMs + 1), false);
});

test('sliding window, niet een harde reset-klok: oudere hits vallen één voor één buiten het venster', () => {
  const windowMs = 10_000;
  const max = 2;
  const limiter = createSlidingWindowLimiter({ windowMs, max });
  const ip = '203.0.113.40';

  limiter.record(ip, 0);
  limiter.record(ip, 5_000);
  assert.equal(limiter.isLimited(ip, 5_000), true);

  // Net na t=10_000 valt de hit op t=0 buiten het venster (0 telt niet meer
  // mee bij `now - t < windowMs`), maar de hit op t=5_000 nog wel — er is
  // dus weer ruimte voor precies één nieuw verzoek, niet voor het hele
  // budget in één keer.
  assert.equal(limiter.isLimited(ip, 10_001), false);
  limiter.record(ip, 10_001);
  assert.equal(limiter.isLimited(ip, 10_001), true);
});

test('verschillende sleutels (IP-adressen) hebben volledig gescheiden budgetten', () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1 });
  const now = 1_000_000;

  limiter.record('203.0.113.50', now);
  assert.equal(limiter.isLimited('203.0.113.50', now), true, 'eerste IP is nu over de eigen limiet');
  assert.equal(limiter.isLimited('203.0.113.51', now), false, 'een ander IP heeft een eigen, ongebruikt budget');
});

// Kernmechanisme achter "mislukte provider-calls tellen niet mee als
// succesvolle gebruikersrequests" (zie het incident in kenniscentrum-chat.ts,
// RATE_LIMIT-sectie): isLimited() leest alleen, record() is een losse,
// expliciete stap. Zolang record() niet aangeroepen wordt, verandert er
// niets aan het budget — dus een aanroeppad dat controleert maar niet
// registreert (zoals bij een providerfout) kan per ontwerp nooit een hit
// tellen.
test('isLimited() zelf registreert nooit iets — alleen een expliciete record()-aanroep telt mee', () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1 });
  const ip = '203.0.113.60';
  const now = 1_000_000;

  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.isLimited(ip, now), false, 'herhaald controleren zonder record() mag nooit blokkeren');
  }
});

// ---------------------------------------------------------------------
// Structurele controle van de ECHTE route (src/pages/api/kenniscentrum-chat.ts):
// bevestigt dat recordSuccessfulRequest() uitsluitend wordt aangeroepen ná
// een succesvolle provider-call, en dus niet bij een rate-limited,
// ongeldig, niet-geconfigureerd of aan een providerfout mislukt verzoek —
// zonder dat daarvoor een live Groq-aanroep nodig is.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');

test('recordSuccessfulRequest() wordt pas aangeroepen ná de provider-foutafhandeling, niet ervoor', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const recordCallIndex = text.indexOf('recordSuccessfulRequest(ip)');
  const rateLimitedReturnIndex = text.indexOf("code: 'rate_limited'");
  const notConfiguredReturnIndex = text.indexOf("code: 'not_configured'");
  const providerUnavailableReturnIndex = text.indexOf("code: 'provider_unavailable'");
  const providerRateLimitedReturnIndex = text.indexOf("code: 'provider_rate_limited'");

  assert.ok(recordCallIndex > -1, 'recordSuccessfulRequest(ip) wordt nergens aangeroepen in de route');
  assert.ok(rateLimitedReturnIndex > -1 && notConfiguredReturnIndex > -1 && providerUnavailableReturnIndex > -1 && providerRateLimitedReturnIndex > -1);

  assert.ok(recordCallIndex > rateLimitedReturnIndex, 'record moet ná de rate-limit-afhandeling staan');
  assert.ok(recordCallIndex > notConfiguredReturnIndex, 'record moet ná de not_configured-afhandeling staan');
  assert.ok(recordCallIndex > providerRateLimitedReturnIndex, 'record moet ná de provider_rate_limited-afhandeling staan (mislukte provider-call telt niet mee)');
  assert.ok(recordCallIndex > providerUnavailableReturnIndex, 'record moet ná de provider_unavailable-afhandeling staan (mislukte provider-call telt niet mee)');
});

test('providerstoring (provider_rate_limited/provider_unavailable) en onvoldoende kennis (insufficientInfo) hebben verschillende, herkenbare teksten', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /De AI-assistent verwerkt op dit moment veel aanvragen\. Probeer het over een moment opnieuw\./, 'provider_rate_limited mist de verwachte tekst');
  assert.match(text, /De AI-assistent is tijdelijk niet beschikbaar\. Probeer het opnieuw\./, 'provider_unavailable mist de verwachte tekst');
  assert.ok(!text.includes('kon nu niet antwoorden'), 'de oude, generieke foutmelding hoort niet meer in de route te staan');
  // (Mag nog voorkomen in een historische incident-toelichting/comment —
  // alleen niet meer als daadwerkelijke `error:`-waarde.)
  assert.ok(
    !/error: '[^']*De assistent kan momenteel geen antwoord genereren/.test(text),
    'de oude, ongedifferentieerde upstream_error-tekst hoort niet meer als daadwerkelijke foutmelding in de route te staan',
  );
});

// Regressie (2026-09-29, ronde 2): GLOBAL_RATE_LIMIT_MAX moet aansluiten bij
// Groq's daadwerkelijke, publiek gedocumenteerde gratis-tier-limiet voor
// openai/gpt-oss-20b (30 requests/minuut, site-breed per API-sleutel), met
// een kleine marge — niet een los gekozen of blind verhoogd getal. Zie de
// toelichting in kenniscentrum-chat.ts (RATE_LIMIT-sectie) voor de volledige
// analyse (RPM én TPM) die tot deze waarde leidde.
test('GLOBAL_RATE_LIMIT_MAX staat op of net onder Groq\'s eigen 30 requests/minuut-limiet, niet er ruim boven', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const match = text.match(/const GLOBAL_RATE_LIMIT_MAX = (\d+);/);
  assert.ok(match, 'GLOBAL_RATE_LIMIT_MAX niet gevonden in de route');
  const value = Number(match[1]);
  assert.ok(value <= 30, `GLOBAL_RATE_LIMIT_MAX (${value}) staat boven Groq's eigen 30 requests/minuut-limiet — onze eigen limiter kan zo nooit vóór Groq's opaque 429 ingrijpen`);
  assert.ok(value >= 20, `GLOBAL_RATE_LIMIT_MAX (${value}) lijkt onnodig laag voor een normaal gesprek van enkele vragen`);
});

// Simuleert het volledige 15-vragen testgesprek uit de kwaliteits-/
// stabiliteitsronde, met realistische tussenpozen (een bezoeker die een
// vraag typt, het antwoord leest en een vervolgvraag stelt) tegen de nieuwe,
// aan Groq's eigen RPM-limiet uitgelijnde GLOBAL_RATE_LIMIT_MAX (28) — dit
// bevestigt dat de verlaging van 60 naar 28 een normaal gesprek niet alsnog
// blokkeert (het oorspronkelijke incident dat ronde 1 al oploste).
test('een volledig 15-vragen testgesprek met realistische tussenpozen blokkeert niet op de (nu lagere) globale limiet', () => {
  const globalLimiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 28 });
  let now = 1_000_000;
  for (let i = 0; i < 15; i++) {
    assert.equal(globalLimiter.isLimited('global', now), false, `vraag ${i + 1} van het testgesprek zou niet geblokkeerd moeten worden`);
    globalLimiter.record('global', now);
    now += 20_000; // ~20 seconden tussen elke vraag/antwoord-beurt
  }
});

// ---------------------------------------------------------------------
// Ronde 3 (2026-09-29): de token-bewuste (TPM) limiter — zelfde
// createSlidingWindowLimiter, nu met een GEWICHT per hit (het geschatte
// aantal tokens) in plaats van het standaardgewicht 1. Dit is de kern van
// de fix voor "eerst werken meerdere vragen, dan faalt zelfs een simpele
// vraag": RPM alleen (hierboven) kan dit patroon niet vangen, omdat een
// handvol verzoeken ruim onder de RPM-limiet toch al Groq's TPM-budget kan
// opsouperen.

test('wouldExceed() detecteert een verzoek dat de limiet zou overschrijden, zonder zelf iets te registreren', () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1000 });
  const now = 1_000_000;

  assert.equal(limiter.wouldExceed('global', 500, now), false);
  assert.equal(limiter.usage('global', now), 0, 'wouldExceed() mag zelf niets registreren');

  limiter.record('global', now, 500);
  assert.equal(limiter.wouldExceed('global', 500, now), false, '500 + 500 = 1000, precies op de grens (niet erover) mag nog net');
  assert.equal(limiter.wouldExceed('global', 501, now), true, '500 + 501 > 1000 moet wél overschrijden');
});

test('record() met een gewicht telt dat gewicht mee in usage(), niet 1 per hit', () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 10_000 });
  const now = 1_000_000;

  limiter.record('global', now, 2_500);
  limiter.record('global', now, 1_500);
  assert.equal(limiter.usage('global', now), 4_000);
  // isLimited() blijft ook gewicht-bewust:
  assert.equal(limiter.isLimited('global', now), false);
});

test('isLimited()/record() zonder expliciet gewicht gedragen zich nog exact als vóór deze wijziging (gewicht 1, dus een simpele telling) — RPM-tests hierboven blijven kloppen', () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 3 });
  const now = 1_000_000;
  limiter.record('ip', now);
  limiter.record('ip', now);
  limiter.record('ip', now);
  assert.equal(limiter.isLimited('ip', now), true);
  assert.equal(limiter.usage('ip', now), 3);
});

// Reproduceert het daadwerkelijk GEMELDE patroon: "eerst werken meerdere
// vragen, dan faalt zelfs een simpele vraag als 'wat is een balans?'". Bij
// realistische, token-zware verzoeken grijpt de TPM-limiet nog altijd
// (terecht) eerder in dan de RPM-limiet (28/minuut) — dat bevestigt dat TPM
// de daadwerkelijke bottleneck is/blijft, ook na de verlaging van het
// tokenverbruik per verzoek in ronde 4.
//
// Ronde 4 (2026-09-29): een simulatie tegen de ECHTE kennisbank liet zien
// dat een verzoek vóór deze ronde 3.400-4.250 tokens kostte (systeemprompt
// 2.383 + tool-schema 407 = 2.790 vaste kosten, plus bronnen/geschiedenis/
// output) — bij een TPM-budget van 6.000 pasten daar maar 1-2 van in één
// venster. Ná het inkorten van de systeemprompt (1.189), het tool-schema
// (237), MODEL_HISTORY_MESSAGES (2 i.p.v. 4 berichten) en
// MAX_KNOWLEDGE_SOURCES (2 i.p.v. 3) kost een verzoek nu ~2.000-2.500 tokens
// — met het nieuwe, eveneens verruimde budget van 7.300 passen daar 2-3 van
// in één venster, tegenover 1-2 voorheen.
test('TPM-limiet laat na ronde 4 meer verzoeken per venster toe dan vóór de inkortingen, en blijft ruim vóór de RPM-limiet ingrijpen', () => {
  const GROQ_TPM_LIMIT = 7_300; // zelfde default als DEFAULT_GROQ_TPM_LIMIT in de route
  const tpmLimiter = createSlidingWindowLimiter({ windowMs: 60_000, max: GROQ_TPM_LIMIT });
  const rpmLimiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 28 });
  const now = 1_000_000;
  // Realistische schatting ná ronde 4's inkortingen (zie token-estimate.test.mjs
  // voor de vaste-kostenmeting van systeemprompt + tool-schema).
  const perRequestTokens = 2_300;

  let blockedAtRequest = null;
  let successfulRequests = 0;
  for (let i = 1; i <= 10; i++) {
    if (tpmLimiter.wouldExceed('global', perRequestTokens, now)) {
      blockedAtRequest = i;
      break;
    }
    tpmLimiter.record('global', now, perRequestTokens);
    rpmLimiter.record('global', now);
    successfulRequests++;
  }

  assert.ok(successfulRequests >= 2, `verwacht minstens 2 verzoeken binnen één venster vóór blokkade (was 1 vóór ronde 4), kreeg ${successfulRequests}`);
  assert.ok(blockedAtRequest !== null, 'de TPM-limiet zou bij voldoende opeenvolgende verzoeken binnen hetzelfde venster nog altijd moeten ingrijpen (Groq se échte 8.000 TPM is een harde, externe grens)');
  assert.equal(rpmLimiter.isLimited('global', now), false, 'de RPM-limiet (28) is op dit punt nog lang niet bereikt — dit bevestigt dat TPM de daadwerkelijke bottleneck is, niet RPM');
});

// Punt 15 uit de opdracht ("stress test"): na het verstrijken van het
// TPM-venster gaan verzoeken weer gewoon door — dit is geen permanente
// blokkade, uitsluitend een tijdelijke, venster-gebonden bescherming.
test('ná het verstrijken van het TPM-venster gaan verzoeken weer gewoon door (geen permanente blokkade)', () => {
  const GROQ_TPM_LIMIT = 7_300;
  const tpmLimiter = createSlidingWindowLimiter({ windowMs: 60_000, max: GROQ_TPM_LIMIT });
  const now = 1_000_000;
  const perRequestTokens = 2_300;

  tpmLimiter.record('global', now, perRequestTokens);
  tpmLimiter.record('global', now, perRequestTokens);
  tpmLimiter.record('global', now, perRequestTokens);
  assert.equal(tpmLimiter.wouldExceed('global', perRequestTokens, now), true, 'venster zou nu vol moeten zijn');

  // Ruim ná het venster (60s + marge): alle oude reserveringen vallen weg.
  const later = now + 61_000;
  assert.equal(tpmLimiter.wouldExceed('global', perRequestTokens, later), false, 'ná het verstrijken van het venster moet er weer ruimte zijn');
});

// Punt 15 uit de opdracht: "fallback wordt gebruikt wanneer veilig" — bij
// een geblokkeerd verzoek (TPM of RPM) probeert de route eerst de
// deterministische kennisbank-fallback vóór de blokkademelding (zie
// rateLimitedResponse in kenniscentrum-chat.ts). Dit bevestigt hetzelfde
// gedrag op het niveau van de onderliggende matchfunctie: voor een
// fallback-geschikte vraag ("wat is een balans?") is er een antwoord
// beschikbaar zonder Groq, voor een vraag die nuance vereist niet.
test('bij een (gesimuleerde) blokkade is voor fallback-geschikte vragen een kennisbank-antwoord beschikbaar zonder Groq', () => {
  const items = [
    {
      id: 'balans',
      title: 'Balans',
      category: 'Administratie en accountancy',
      content: 'De balans is een overzicht van de bezittingen en schulden van een onderneming op een bepaald moment.',
      tags: ['balans', 'bezittingen', 'eigen vermogen'],
      deterministicFallback: true,
    },
  ];
  // Fallback-geschikte, zuiver definitorische vraag: wél een antwoord.
  assert.equal(findDeterministicFallbackItem('Wat is een balans?', items)?.id, 'balans');
  // Een vraag die nuance/persoonlijke beoordeling vereist: nooit een
  // fallback, ook niet als er toevallig een gerelateerd item bestaat — dan
  // moet de bezoeker de (nette) blokkademelding zien in plaats van een
  // misleidend te simpel antwoord.
  assert.equal(findDeterministicFallbackItem('Hoeveel belasting moet ik betalen als ik 50.000 euro winst maak?', items), null);
});

// ---------------------------------------------------------------------
// Structurele controle: bevestigt dat de route de TPM-precheck daadwerkelijk
// vóór de Groq-aanroep uitvoert (dus zonder Groq aan te roepen wanneer al
// lokaal duidelijk is dat de limiet overschreden zou worden), en dat de
// reservering plaatsvindt ongeacht het latere resultaat (in tegenstelling
// tot de RPM-registratie, die alleen bij succes telt).
test('de TPM-precheck (wouldExceed) staat vóór de Groq-aanroep, en tpmLimiter.record() gebeurt vóórdat het resultaat bekend is', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const wouldExceedIndex = text.indexOf('tpmLimiter.wouldExceed(');
  const tpmRecordIndex = text.indexOf('tpmLimiter.record(');
  const callAiIndex = text.indexOf('await callAiWithFallback(');

  assert.ok(wouldExceedIndex > -1, 'tpmLimiter.wouldExceed(...) wordt nergens aangeroepen in de route');
  assert.ok(tpmRecordIndex > -1, 'tpmLimiter.record(...) wordt nergens aangeroepen in de route');
  assert.ok(callAiIndex > -1, 'callAiWithFallback(...) wordt nergens aangeroepen in de route');

  assert.ok(wouldExceedIndex < callAiIndex, 'de TPM-precheck moet vóór de Groq-aanroep staan, anders wordt de limiet niet daadwerkelijk gehandhaafd');
  assert.ok(tpmRecordIndex < callAiIndex, 'tpmLimiter.record() moet vóór de Groq-aanroep staan (reservering, ongeacht het latere resultaat)');
});
