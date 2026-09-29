// Regressietests voor de sliding-window rate limiter
// (src/lib/rate-limit.mjs) gebruikt door de AI-assistent
// (src/pages/api/kenniscentrum-chat.ts). Draait met Node's ingebouwde
// testrunner: `npm run kenniscentrum:test` — geen live Groq-aanroep nodig,
// en geen wall-clock wachttijd: elke test injecteert zijn eigen `now`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlidingWindowLimiter } from '../../src/lib/rate-limit.mjs';

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
  const upstreamErrorReturnIndex = text.indexOf("code: 'upstream_error'");

  assert.ok(recordCallIndex > -1, 'recordSuccessfulRequest(ip) wordt nergens aangeroepen in de route');
  assert.ok(rateLimitedReturnIndex > -1 && notConfiguredReturnIndex > -1 && upstreamErrorReturnIndex > -1);

  assert.ok(recordCallIndex > rateLimitedReturnIndex, 'record moet ná de rate-limit-afhandeling staan');
  assert.ok(recordCallIndex > notConfiguredReturnIndex, 'record moet ná de not_configured-afhandeling staan');
  assert.ok(recordCallIndex > upstreamErrorReturnIndex, 'record moet ná de upstream_error-afhandeling staan (mislukte provider-call telt niet mee)');
});

test('provider failure (upstream_error) en onvoldoende kennis (insufficientInfo) hebben verschillende, herkenbare teksten', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /De assistent kan momenteel geen antwoord genereren\. Probeer het opnieuw\./, 'upstream_error mist de verwachte, van onvoldoendeInformatie onderscheiden tekst');
  assert.ok(!text.includes('kon nu niet antwoorden'), 'de oude, generieke foutmelding hoort niet meer in de route te staan');
});
