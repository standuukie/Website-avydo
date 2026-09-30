// Regressietests voor CONTEXTUELE vervolgvraag-retrieval (ronde, 2026-09-30):
// productie-incident waarbij "En als ik de winst erin laat?" (na "Wat is een
// BV?" → "En hoe zit het met dividend?") het verkeerde kennisitem kreeg
// (winst-en-verliesrekening in plaats van winst-in-de-bv).
//
// Grondoorzaak (zie knowledge-match.mjs, retrieveKnowledgeItemsWithContext):
// kenniscentrum-chat.ts probeerde de HUIDIGE vraag eerst alleen, en keek
// pas naar de gespreksgeschiedenis als dat NUL bronnen opleverde. Een korte
// vervolgvraag levert echter bijna nooit nul treffers op — "winst" alleen
// matcht toevallig al (zwak) op een ander kennisitem — waardoor de
// geschiedenis in de praktijk vrijwel nooit geraadpleegd werd. De fix voegt
// een gerichte, conservatieve context-aanpak toe: de HUIDIGE vraag blijft
// altijd de EERSTE sorteersleutel (nooit verdrongen door een lager scorend
// item), de LAATSTE voorgaande vraag (niet het hele gesprek) is uitsluitend
// een TWEEDE sorteersleutel om een score-gelijkspel op te lossen, en wordt
// alleen geraadpleegd bij een herkend verwijswoord (isLikelyContextDependent)
// — nooit bij een zelfstandige vraag.
//
// Dit bestand test de ECHTE, huidige kennisbankbestanden (regex-extractie,
// zelfde patroon als content-quality.test.mjs/unknown-phrasing.test.mjs) in
// de ECHTE volgorde van src/data/ai-knowledge/index.ts, tegen de ECHTE
// retrieveKnowledgeItemsWithContext(). Draait met Node's ingebouwde
// testrunner: `npm run kenniscentrum:test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieveKnowledgeItems, retrieveKnowledgeItemsWithContext, isLikelyContextDependent } from '../../src/lib/knowledge-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
// Zelfde volgorde als de spreads in index.ts: ondernemingsvormenItems,
// administratieItems, btwItems, inkomstenbelastingItems, bvDgaItems,
// personeelItems — bepalend voor stable-sort tiebreaks bij gelijke
// score+priority.
const KB_FILES = ['ondernemingsvormen.ts', 'administratie.ts', 'btw.ts', 'inkomstenbelasting.ts', 'bv-dga.ts', 'personeel.ts'];

function extractItems(text) {
  const blocks = text.split(/\n {2}\{\n/).slice(1).map((block) => block.split(/\n {2}\},?\n/)[0]);
  return blocks.map((block) => {
    const id = block.match(/id: '([^']+)'/)?.[1] ?? '';
    const category = block.match(/category: '([^']*)'/)?.[1] ?? '';
    const contentMatch = block.match(/content:\s*\n?\s*'((?:[^'\\]|\\.)*)'/);
    const content = contentMatch ? contentMatch[1].replace(/\\'/g, "'") : '';
    const tagsMatch = block.match(/tags:\s*\[([\s\S]*?)\],\n\s*priority/);
    const tags = tagsMatch ? [...tagsMatch[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")) : [];
    const titleMatch = block.match(/title: '((?:[^'\\]|\\.)*)'/);
    const title = titleMatch ? titleMatch[1].replace(/\\'/g, "'") : '';
    const priority = Number(block.match(/priority: (\d)/)?.[1] ?? 1);
    return { id, title, category, content, tags, priority };
  });
}

function loadKnowledgeBase() {
  return KB_FILES.flatMap((file) => extractItems(readFileSync(path.join(KB_DIR, file), 'utf-8')));
}

const KB = loadKnowledgeBase();

function topId(prev, msg) {
  const [top] = retrieveKnowledgeItemsWithContext(msg, prev, KB, { maxItems: 3 });
  return top?.id;
}

test('sanity: kennisbank correct geladen (68 items) in de productievolgorde', () => {
  assert.equal(KB.length, 68);
  assert.equal(KB[0].id, 'onderneming-starten'); // eerste item van ondernemingsvormen.ts
});

// ---------------------------------------------------------------------
// Succescriterium 6: pronomen/verwijswoorden worden herkend.

test('isLikelyContextDependent herkent verwijswoorden uit de opdracht', () => {
  for (const msg of [
    'En als ik de winst erin laat?',
    'Kan ik daar geld uit halen?',
    'En hoe zit dat?',
    'Kan ik die aftrekken?',
    'En als ik dat doe?',
    'Moet ik dat dan ook regelen?',
    'En wat als ik hem privé gebruik?',
    'Kan ik die kosten aftrekken?',
    'En heeft dat voor mij zin?',
  ]) {
    assert.ok(isLikelyContextDependent(msg), `"${msg}" zou als contextafhankelijk herkend moeten worden`);
  }
});

test('isLikelyContextDependent laat zelfstandige vragen met eigen onderwerp met rust (geen fout-positief)', () => {
  for (const msg of ['Wat is KIA?', 'Wat is een BV?', 'Wat is btw?', 'Wat is een holding?', 'En hoe zit het met dividend?', 'En hoe zit het met zakelijke kosten?']) {
    assert.ok(!isLikelyContextDependent(msg), `"${msg}" is zelfstandig genoeg en zou NIET als contextafhankelijk herkend moeten worden`);
  }
});

// ---------------------------------------------------------------------
// De 6 verplichte scenario's uit de opdracht.

test('SCENARIO 1: BV → dividend → winst in BV', () => {
  assert.equal(topId([], 'Wat is een BV?'), 'bv');
  assert.equal(topId(['Wat is een BV?'], 'En hoe zit het met dividend?'), 'dividend');
  assert.equal(topId(['Wat is een BV?', 'En hoe zit het met dividend?'], 'En als ik de winst erin laat?'), 'winst-in-de-bv');
});

test('SCENARIO 2: eenmanszaak → geld uit onderneming (mag niet naar een algemeen BV/winst-item)', () => {
  assert.equal(topId([], 'Wat is een eenmanszaak?'), 'eenmanszaak');
  const id = topId(['Wat is een eenmanszaak?'], 'Kan ik daar geld uit halen?');
  assert.equal(id, 'priveonttrekkingen-eenmanszaak');
  assert.notEqual(id, 'winst-in-de-bv');
  assert.notEqual(id, 'dividend');
});

test('SCENARIO 3: personeel → pensioen → verlof (oudere "personeel"-context verdringt het specifieke onderwerp niet)', () => {
  assert.equal(topId([], 'Ik wil personeel aannemen, wat moet ik regelen?'), 'werknemer-aannemen');
  assert.equal(topId(['Ik wil personeel aannemen, wat moet ik regelen?'], 'Moet ik dan pensioen regelen?'), 'pensioen-werknemers');
  assert.equal(
    topId(['Ik wil personeel aannemen, wat moet ik regelen?', 'Moet ik dan pensioen regelen?'], 'En hoe zit het met vakantiedagen?'),
    'vakantiedagen-verlof',
  );
});

test('SCENARIO 4: btw → terugvragen → zakelijke kosten', () => {
  assert.equal(topId([], 'Wat is btw?'), 'btw-algemeen');
  assert.equal(topId(['Wat is btw?'], 'Kan ik die terugvragen?'), 'btw-terugvragen-voorbelasting');
  assert.equal(topId(['Wat is btw?', 'Kan ik die terugvragen?'], 'En hoe zit het met zakelijke kosten?'), 'zakelijke-versus-prive-kosten');
});

test('SCENARIO 5: BV → holding → relevantie (valt niet terug op het algemene BV-item)', () => {
  assert.equal(topId([], 'Wat is een BV?'), 'bv');
  assert.equal(topId(['Wat is een BV?'], 'Wat is een holding?'), 'holdingstructuur');
  const id = topId(['Wat is een BV?', 'Wat is een holding?'], 'En heeft dat voor mij zin?');
  assert.equal(id, 'holdingstructuur');
  assert.notEqual(id, 'bv');
});

test('SCENARIO 6: werkruimte ("die" verwijst naar de werkruimte/thuiswerkkosten)', () => {
  const id = topId(['Ik werk vanuit huis.'], 'Kan ik die kosten aftrekken?');
  assert.equal(id, 'werkruimte-thuis-aftrek');
});

// ---------------------------------------------------------------------
// Extra: minimaal 5 korte vervolgvragen waarbij de betekenis alleen uit
// context duidelijk is (opdracht, "EXTRA TEST").

const EXTRA_ELLIPTICAL = [
  { prev: 'Wat is dividend?', msg: 'En hoe zit dat?', expect: 'dividend' },
  { prev: 'Ik heb een auto van de zaak.', msg: 'En wat als ik hem privé gebruik?', expect: 'auto-van-de-zaak-bijtelling' },
  { prev: 'Ik neem een werknemer aan.', msg: 'Moet ik dat dan ook bij de Belastingdienst melden?', expect: 'werknemer-aannemen' },
  { prev: 'Ik heb een investering gedaan van 50.000 euro.', msg: 'Kan ik daarvoor extra aftrek krijgen?', expect: 'investeringsaftrek-kia' },
  { prev: 'Ik werk vanuit huis.', msg: 'Kan ik die kosten aftrekken?', expect: 'werkruimte-thuis-aftrek' },
];

for (const { prev, msg, expect } of EXTRA_ELLIPTICAL) {
  test(`EXTRA (alleen context maakt de betekenis duidelijk): "${prev}" → "${msg}" → ${expect}`, () => {
    assert.equal(topId([prev], msg), expect);
  });
}

// ---------------------------------------------------------------------
// Succescriterium 4: oude context verdringt een nieuwe, specifieke vraag
// niet — ook niet bij een LANGERE geschiedenis met een ander onderwerp
// ertussen.

test('oude, niet-gerelateerde context verdringt een zelfstandige nieuwe vraag niet', () => {
  const history = ['Wat is een BV?', 'En hoe zit het met dividend?', 'Wat is de KOR?'];
  // "Wat is de KOR?" is zelf al ondubbelzinnig — de BV/dividend-context
  // ervoor mag hier geen enkele invloed op hebben.
  assert.equal(topId(history, 'Wat is de KOR?'), 'kor');
});

test('context helpt een vervolgvraag, maar wint nooit van een item dat op de huidige vraag zelf duidelijk hoger scoort', () => {
  // "Kan ik die terugvragen?" na een BV-vraag: er is geen "terugvragen"-
  // gerelateerde context, dus het antwoord moet gewoon op btw-terugvragen
  // uitkomen zodra de huidige vraag zelf genoeg eigen signaal heeft.
  const id = topId(['Wat is een BV?'], 'Ik heb te veel btw betaald, kan ik dat terugvragen?');
  assert.equal(id, 'btw-terugvragen-voorbelasting');
});

// ---------------------------------------------------------------------
// Succescriterium 5 + regressie: de 27 vragen uit de vorige meetronde
// (kennisbank 49→68 items) moeten met retrieveKnowledgeItemsWithContext
// (zonder geschiedenis, dus functioneel identiek aan retrieveKnowledgeItems)
// nog steeds exact hetzelfde resultaat geven — de bestaande, zelfstandige
// retrievalkwaliteit mag niet achteruitgaan.

const STANDALONE_REGRESSION = [
  ['Ik heb binnenkort mijn eerste werknemer, wat moet ik allemaal regelen?', 'werknemer-aannemen'],
  ['Ik ben DGA en wil mezelf zo weinig mogelijk salaris betalen. Hoe zit dat?', 'gebruikelijk-loon'],
  ['Kan ik de winst van mijn BV gewoon op de zakelijke rekening laten staan?', 'winst-in-de-bv'],
  ['Ik ben net begonnen als ondernemer, welke administratie moet ik bewaren?', 'bewaarplicht'],
  ['Moet ik mezelf verzekeren tegen het risico dat een werknemer ziek wordt?', 'ziekte-van-werknemer'],
  ['Ik wil geld uit mijn eigen BV halen, maar niet als dividend. Kan dat?', 'rekening-courant-dga'],
  ['Ik leen soms geld van mijn BV. Hoe zit dat fiscaal?', 'rekening-courant-dga'],
  ['Ik begin samen met iemand een BV. Hoe leg je afspraken tussen aandeelhouders vast?', 'aandeelhouderschap-bv'],
  ['Heeft een holding voor mij zin?', 'holdingstructuur'],
  ['Ik ben DGA en hoor iets over box 2. Wanneer geldt dat?', 'aanmerkelijk-belang'],
  ['Ik heb een investering gedaan. Kan ik daar extra fiscale aftrek voor krijgen?', 'investeringsaftrek-kia'],
  ['Ik gebruik mijn zakelijke auto ook privé. Wat betekent dat?', 'auto-van-de-zaak-bijtelling'],
  ['Ik werk vanuit een kamer thuis. Kan ik die kosten opvoeren?', 'werkruimte-thuis-aftrek'],
  ['Ik verkoop goederen aan een klant in Duitsland. Hoe zit het met de btw?', 'eu-leveringen-en-diensten'],
  ['Ik lever zorg en vraag me af of ik btw moet rekenen.', 'btw-vrijstellingen-sectoraal'],
  ['Wat is het minimum dat ik mijn werknemer moet betalen?', 'minimumloon'],
  ['Hoeveel vrije dagen moet ik mijn werknemer geven?', 'vakantiedagen-verlof'],
  ['Kan ik mijn werknemers een cadeau geven zonder daar loonheffing over te betalen?', 'werkkostenregeling'],
  ["Wanneer is een zzp'er eigenlijk gewoon een werknemer?", 'schijnzelfstandigheid-dba'],
  ['Wat mag ik mijn werknemer per kilometer vergoeden?', 'onbelaste-kilometervergoeding'],
  ['Welke stukken moet ik naar mijn accountant sturen voor de jaarrekening?', 'documenten-voor-de-accountant'],
  ['Kan ik iemand tijdelijk of op oproepbasis in dienst nemen?', 'oproep-en-tijdelijk-contract'],
  ['Ik wil een BV beginnen. Welke stappen moet ik doorlopen?', 'bv-oprichten-stappen'],
];

test('regressie: standalone-vraagkwaliteit (zonder geschiedenis) blijft exact gelijk aan retrieveKnowledgeItems', () => {
  for (const [msg, expectedId] of STANDALONE_REGRESSION) {
    const withContext = retrieveKnowledgeItemsWithContext(msg, [], KB, { maxItems: 3 }).map((i) => i.id);
    const plain = retrieveKnowledgeItems(msg, KB, { maxItems: 3 }).map((i) => i.id);
    assert.deepEqual(withContext, plain, `"${msg}": resultaat met (lege) geschiedenis moet identiek zijn aan zonder geschiedenis`);
    assert.equal(withContext[0], expectedId, `"${msg}" → verwachtte "${expectedId}" als bovenste resultaat, kreeg "${withContext[0]}"`);
  }
});
