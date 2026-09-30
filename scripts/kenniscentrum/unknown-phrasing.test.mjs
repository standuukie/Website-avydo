// Regressietests voor "onbekend geformuleerde vragen" (kennisbank-uitbreidingsronde,
// 2026-09-29/30): de kennisbank is uitgebreid met 19 nieuwe kennisitems en één
// uitgebreid item (zie src/data/ai-knowledge/), specifiek om ook natuurlijk
// geformuleerde vragen te kunnen beantwoorden die NIET letterlijk overeenkomen
// met een bestaande kennisitem-titel of -tag. Dit bestand test de ECHTE,
// huidige kennisbankbestanden (via dezelfde regex-extractie als
// content-quality.test.mjs/cross-contamination.test.mjs — geen TS-import
// nodig, dus altijd synchroon met de daadwerkelijke productie-inhoud) tegen
// de ECHTE retrieval (src/lib/knowledge-match.mjs), met vragen die bewust
// anders zijn geformuleerd dan de kennisitem-titels/tags. Draait met Node's
// ingebouwde testrunner: `npm run kenniscentrum:test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieveKnowledgeItems, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
// Zelfde volgorde als de spreads in src/data/ai-knowledge/index.ts — belangrijk
// omdat deze tests op retrieval-VOLGORDE controleren (welk item bovenaan komt),
// en gelijke score+priority-gevallen via stable-sort op array-volgorde beslist
// worden.
const KB_FILES = ['ondernemingsvormen.ts', 'administratie.ts', 'btw.ts', 'inkomstenbelasting.ts', 'bv-dga.ts', 'personeel.ts'];

/**
 * Extraheert alle kennisitems (id/title/category/content/tags/priority) uit
 * een kennisbankbestand via een lichte tekstuele scan — dezelfde aanpak als
 * elders in deze testset (extractContentBlocks/extractSourceUrls in
 * content-quality.test.mjs), hier uitgebreid tot volledige item-objecten
 * zodat de ECHTE, actuele kennisbank (in plaats van een losse testkopie die
 * uit de pas kan lopen) tegen de retrieval getest kan worden.
 */
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

function topId(query) {
  const [top] = retrieveKnowledgeItems(buildRetrievalQuery([], query), KB, { maxItems: 3 });
  return top?.id;
}

// ---------------------------------------------------------------------
// 0. Sanity: de extractie zelf werkt en vindt alle 20 nieuwe/uitgebreide items.

test('extractie vindt alle 19 nieuwe kennisitems uit deze uitbreidingsronde', () => {
  const expectedNewIds = [
    'rekening-courant-dga',
    'aandeelhouderschap-bv',
    'holdingstructuur',
    'aanmerkelijk-belang',
    'bv-oprichten-stappen',
    'priveonttrekkingen-eenmanszaak',
    'investeringsaftrek-kia',
    'afschrijving-bedrijfsmiddelen',
    'auto-van-de-zaak-bijtelling',
    'werkruimte-thuis-aftrek',
    'eu-leveringen-en-diensten',
    'btw-vrijstellingen-sectoraal',
    'minimumloon',
    'vakantiedagen-verlof',
    'werkkostenregeling',
    'schijnzelfstandigheid-dba',
    'onbelaste-kilometervergoeding',
    'oproep-en-tijdelijk-contract',
    'documenten-voor-de-accountant',
  ];
  const ids = new Set(KB.map((i) => i.id));
  for (const id of expectedNewIds) {
    assert.ok(ids.has(id), `nieuw kennisitem "${id}" niet gevonden door de extractie — extractie of item mogelijk kapot`);
  }
  assert.equal(KB.length, 68, `verwacht 68 kennisitems totaal (49 bestaand + 19 nieuw), telde ${KB.length}`);
});

// ---------------------------------------------------------------------
// 1. De 20 vragen uit de opdracht (bewust anders geformuleerd dan de
// kennisitem-titels/tags) — elk moet het juiste, nieuwe kennisitem als
// bovenste resultaat opleveren.

const OPDRACHT_VRAGEN = [
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

for (const [vraag, expectedId] of OPDRACHT_VRAGEN) {
  test(`"${vraag}" → bovenste resultaat is "${expectedId}"`, () => {
    assert.equal(topId(vraag), expectedId, `verwachtte "${expectedId}" als bovenste resultaat voor: "${vraag}"`);
  });
}

// Twee vragen uit de opdracht die bewust een bestaand item raken (geen nieuw
// item, maar wel getest omdat de opdracht ze expliciet noemt als voorbeeld
// van onbekende formulering).
test('"Ik heb een dure laptop gekocht voor mijn bedrijf. Kan ik die meteen volledig aftrekken?" → afschrijving-bedrijfsmiddelen (niet een onderwerpvreemd item)', () => {
  const id = topId('Ik heb een dure laptop gekocht voor mijn bedrijf. Kan ik die meteen volledig aftrekken?');
  assert.ok(
    ['afschrijving-bedrijfsmiddelen', 'zakelijke-versus-prive-kosten'].includes(id),
    `verwachtte een aftrek-gerelateerd item, kreeg "${id}"`,
  );
});

test('"Moet ik mezelf verzekeren tegen het risico dat een werknemer ziek wordt?" → ziekte-van-werknemer (nu met verzuimverzekering)', () => {
  assert.equal(topId('Moet ik mezelf verzekeren tegen het risico dat een werknemer ziek wordt?'), 'ziekte-van-werknemer');
});

// ---------------------------------------------------------------------
// 2. Extra, eerder aangeleverde voorbeeldvragen (bestaande onderwerpen, niet
// letterlijk gelijk aan de kennisitem-formulering) — regressie tegen
// terugval in kwaliteit door de kennisbank-uitbreiding.

test('"Ik neem volgende maand mijn eerste medewerker aan, waar moet ik allemaal aan denken?" → werknemer-aannemen', () => {
  assert.equal(topId('Ik neem volgende maand mijn eerste medewerker aan, waar moet ik allemaal aan denken?'), 'werknemer-aannemen');
});

test('"Ik ben DGA en wil mezelf zo weinig mogelijk salaris betalen. Hoe zit dat?" → gebruikelijk-loon', () => {
  assert.equal(topId('Ik ben DGA en wil mezelf zo weinig mogelijk salaris betalen. Hoe zit dat?'), 'gebruikelijk-loon');
});

test('"Kan ik de winst van mijn BV gewoon op de zakelijke rekening laten staan?" → winst-in-de-bv', () => {
  assert.equal(topId('Kan ik de winst van mijn BV gewoon op de zakelijke rekening laten staan?'), 'winst-in-de-bv');
});

test('"Ik heb meer btw betaald dan ik heb ontvangen, hoe krijg ik dat geld terug?" → btw-terugvragen-voorbelasting', () => {
  assert.equal(topId('Ik heb meer btw betaald dan ik heb ontvangen, hoe krijg ik dat geld terug?'), 'btw-terugvragen-voorbelasting');
});

test('"Mijn werknemer is ziek geworden, wat moet ik als werkgever doen?" → ziekte-van-werknemer', () => {
  assert.equal(topId('Mijn werknemer is ziek geworden, wat moet ik als werkgever doen?'), 'ziekte-van-werknemer');
});

test('"Moet ik als kleine ondernemer btw rekenen?" → een btw-item (kor of btw-voor-wie), geen onderwerpvreemd resultaat', () => {
  const id = topId('Moet ik als kleine ondernemer btw rekenen?');
  assert.equal(KB.find((i) => i.id === id)?.category, 'Btw', `verwachtte een btw-item, kreeg "${id}"`);
});

// ---------------------------------------------------------------------
// 3. Expliciete onderwerpafbakening (opdracht, punt 3) — nieuwe items mogen
// nooit een bestaand, aangrenzend onderwerp als bovenste resultaat
// verdringen, en omgekeerd.

test('AFBAKENING: rekening-courant-dga verdringt niet dividend of gebruikelijk-loon', () => {
  const id = topId('Ik leen geld van mijn BV, is dat hetzelfde als dividend?');
  assert.equal(id, 'rekening-courant-dga');
  assert.notEqual(id, 'dividend');
  assert.notEqual(id, 'gebruikelijk-loon');
});

test('AFBAKENING: privéonttrekking eenmanszaak ≠ dividend uit BV', () => {
  const id = topId('Ik heb een eenmanszaak en haal geld uit de zaak voor privé, is dat belast?');
  assert.equal(id, 'priveonttrekkingen-eenmanszaak');
  assert.notEqual(id, 'dividend');
});

test('AFBAKENING: KIA ≠ gewone zakelijke-kostenaftrek', () => {
  const id = topId('Ik heb voor duizenden euro\'s geïnvesteerd in machines, krijg ik daar extra investeringsaftrek voor?');
  assert.equal(id, 'investeringsaftrek-kia');
  assert.notEqual(id, 'zakelijke-versus-prive-kosten');
});

test('AFBAKENING: afschrijving-bedrijfsmiddelen stelt expliciet dat volledige, directe aftrek niet de norm is', () => {
  const item = KB.find((i) => i.id === 'afschrijving-bedrijfsmiddelen');
  assert.ok(item, 'kon afschrijving-bedrijfsmiddelen niet vinden');
  assert.match(item.content, /niet in één keer volledig als kosten aftrekken/);
});

test('AFBAKENING: auto-van-de-zaak-bijtelling ≠ algemene zakelijke kosten', () => {
  const id = topId('Wat betekent bijtelling voor mijn auto van de zaak precies?');
  assert.equal(id, 'auto-van-de-zaak-bijtelling');
  assert.notEqual(id, 'zakelijke-versus-prive-kosten');
});

test('AFBAKENING: vakantiedagen ≠ vakantiegeld (elk onderwerp eigen bovenste resultaat)', () => {
  assert.equal(topId('Hoeveel verlofdagen bouwt mijn werknemer per jaar op?'), 'vakantiedagen-verlof');
  assert.equal(topId('Wanneer moet ik de vakantiebijslag uitbetalen aan mijn personeel?'), 'vakantiegeld');
});

test('AFBAKENING: werkkostenregeling ≠ gewone loonbetaling/loonadministratie', () => {
  const id = topId('Kan ik personeel een onbelaste bonus geven via de vrije ruimte?');
  assert.equal(id, 'werkkostenregeling');
  assert.notEqual(id, 'loonadministratie');
  assert.notEqual(id, 'loonheffingen');
});

test('AFBAKENING: schijnzelfstandigheid-dba ≠ werknemer-aannemen', () => {
  const id = topId('Loop ik risico als ik een zzp\'er structureel inhuur in plaats van iemand in dienst te nemen?');
  assert.equal(id, 'schijnzelfstandigheid-dba');
  assert.notEqual(id, 'werknemer-aannemen');
});

test('AFBAKENING: eu-leveringen-en-diensten ≠ binnenlandse btw-tarieven/aangifte', () => {
  const id = topId('Moet ik btw rekenen als ik iets verkoop aan een bedrijf in Frankrijk?');
  assert.equal(id, 'eu-leveringen-en-diensten');
  assert.notEqual(id, 'btw-tarieven');
  assert.notEqual(id, 'btw-aangifte');
});

test('AFBAKENING: btw-vrijstellingen-sectoraal ≠ KOR', () => {
  const id = topId('Ik ben fysiotherapeut, moet ik btw in rekening brengen aan mijn patiënten?');
  assert.equal(id, 'btw-vrijstellingen-sectoraal');
  assert.notEqual(id, 'kor');
});

test('AFBAKENING: holdingstructuur ≠ bv-oprichten-stappen ≠ verschil-eenmanszaak-en-bv', () => {
  const idHolding = topId('Is het slim om met een holding-bv en een werkmaatschappij te werken?');
  assert.equal(idHolding, 'holdingstructuur');
  const idOprichten = topId('Welke stappen doorloop ik om een BV op te richten bij de notaris?');
  assert.equal(idOprichten, 'bv-oprichten-stappen');
});

test('AFBAKENING: aanmerkelijk-belang ≠ gebruikelijk-loon/dividend (wel gerelateerd, geen verdringing)', () => {
  const id = topId('Vanaf wanneer heb ik een aanmerkelijk belang in mijn BV?');
  assert.equal(id, 'aanmerkelijk-belang');
});

// ---------------------------------------------------------------------
// 4. Geen enkel nieuw item introduceert een dubbel id of ontbrekende tags
// (aanvullend op de algemene content-quality-tests, specifiek gericht op
// deze 19 nieuwe items).

test('elk nieuw kennisitem heeft minimaal 4 tags (voldoende trefwoordvarianten voor natuurlijke formuleringen)', () => {
  const newIds = [
    'rekening-courant-dga',
    'aandeelhouderschap-bv',
    'holdingstructuur',
    'aanmerkelijk-belang',
    'bv-oprichten-stappen',
    'priveonttrekkingen-eenmanszaak',
    'investeringsaftrek-kia',
    'afschrijving-bedrijfsmiddelen',
    'auto-van-de-zaak-bijtelling',
    'werkruimte-thuis-aftrek',
    'eu-leveringen-en-diensten',
    'btw-vrijstellingen-sectoraal',
    'minimumloon',
    'vakantiedagen-verlof',
    'werkkostenregeling',
    'schijnzelfstandigheid-dba',
    'onbelaste-kilometervergoeding',
    'oproep-en-tijdelijk-contract',
    'documenten-voor-de-accountant',
  ];
  for (const id of newIds) {
    const item = KB.find((i) => i.id === id);
    assert.ok(item, `item "${id}" niet gevonden`);
    assert.ok(item.tags.length >= 4, `item "${id}" heeft maar ${item.tags.length} tags, verwacht minimaal 4`);
  }
});
