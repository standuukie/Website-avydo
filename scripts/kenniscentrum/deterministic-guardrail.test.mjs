// Regressietests voor de "wide-match guardrail" in findDeterministicFallbackItem()
// (src/lib/knowledge-match.mjs, WIDE_MATCH_GUARDED_IDS). Read-only
// simulatierondes (2026-09-30) tegen de ECHTE kennisbank toonden aan dat vijf
// brede/generieke deterministicFallback-items (bv, eenmanszaak, btw-algemeen,
// kor, vof-en-maatschap) soms wonnen terwijl een ander, specifieker
// kennisitem — ook buiten de deterministicFallback-set — beter bij de vraag
// paste (bijv. "Wat is rekening-courant met mijn BV?" via het brede
// "bv"-item i.p.v. null). Dit bestand test, net als unknown-phrasing.test.mjs
// en content-quality.test.mjs, de ECHTE kennisbankbestanden (via dezelfde
// regex-extractie, geen TS-import nodig) tegen de ECHTE retrieval. Draait
// met Node's ingebouwde testrunner: `npm run kenniscentrum:test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDeterministicFallbackItem, retrieveKnowledgeItems } from '../../src/lib/knowledge-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
// Zelfde volgorde als de spreads in src/data/ai-knowledge/index.ts — zie ook
// unknown-phrasing.test.mjs/context-retrieval.test.mjs.
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
    const deterministicFallback = /deterministicFallback: true/.test(block);
    return { id, title, category, content, tags, priority, deterministicFallback };
  });
}

function loadKnowledgeBase() {
  return KB_FILES.flatMap((file) => extractItems(readFileSync(path.join(KB_DIR, file), 'utf-8')));
}

const KB = loadKnowledgeBase();

test('sanity: de echte kennisbank heeft precies de 14 bekende deterministicFallback-items, inclusief de vijf beschermde brede items', () => {
  const detIds = KB.filter((i) => i.deterministicFallback).map((i) => i.id);
  assert.equal(detIds.length, 14, `verwacht 14 deterministicFallback-items, telde er ${detIds.length}: ${detIds.join(', ')}`);
  for (const id of ['bv', 'eenmanszaak', 'btw-algemeen', 'kor', 'vof-en-maatschap']) {
    assert.ok(detIds.includes(id), `verwacht "${id}" als deterministicFallback-item in de echte kennisbank`);
  }
});

// ---------------------------------------------------------------------
// 1. De vier eerder gevonden false positives: door de guardrail nu null
// (geen ander deterministisch item wordt automatisch geprobeerd).
// ---------------------------------------------------------------------
test('guardrail: de vier eerder gevonden false positives geven nu null i.p.v. het verkeerde brede item', () => {
  const cases = [
    { q: 'Wat is rekening-courant met mijn BV?', wronglyWasId: 'bv' },
    { q: 'Waar betaal ik belasting over als ondernemer?', wronglyWasId: 'eenmanszaak' },
    { q: 'Hoe zit btw bij klanten in het buitenland?', wronglyWasId: 'kor' },
    { q: 'Wanneer geldt een btw-vrijstelling?', wronglyWasId: 'kor' },
  ];
  for (const { q, wronglyWasId } of cases) {
    const result = findDeterministicFallbackItem(q, KB);
    assert.equal(result, null, `"${q}" moet nu null geven (voorheen ten onrechte "${wronglyWasId}")`);
  }
});

// ---------------------------------------------------------------------
// 2. De drie VOF-leaks: door de guardrail nu null.
// ---------------------------------------------------------------------
test('guardrail: de drie VOF-leaks geven nu null i.p.v. het te brede vof-en-maatschap-item', () => {
  const cases = ['Welke belasting betaalt een VOF?', 'Hoe werkt inkomstenbelasting bij een VOF?', 'Kan een VOF personeel in dienst nemen?'];
  for (const q of cases) {
    const result = findDeterministicFallbackItem(q, KB);
    assert.equal(result, null, `"${q}" moet nu null geven (voorheen ten onrechte "vof-en-maatschap")`);
  }
});

// ---------------------------------------------------------------------
// 3. De zes expliciete/onmiskenbare VOF-vragen behouden hun bestaande,
// correcte deterministische resultaat — de guardrail mag dit niet raken.
// ---------------------------------------------------------------------
test('guardrail: expliciete, onmiskenbare VOF-vragen blijven gewoon vof-en-maatschap geven', () => {
  const cases = [
    'Wat is een VOF?',
    'Wat houdt een vennootschap onder firma in?',
    'Wat is een maatschap?',
    'Ik wil samen met een compagnon een bedrijf starten, VOF of BV?',
    'Is een maatschap hetzelfde als een VOF?',
    'Hoe werkt de administratieplicht bij een VOF?',
  ];
  for (const q of cases) {
    const result = findDeterministicFallbackItem(q, KB);
    assert.equal(result?.id, 'vof-en-maatschap', `"${q}" moet nog steeds vof-en-maatschap geven`);
  }
});

// ---------------------------------------------------------------------
// 4. De 14 canonieke deterministische vragen (één per deterministicFallback-
// item) blijven allemaal hun eigen item geven — geen regressie op de
// bestaande, correcte deterministische antwoorden door de guardrail.
// ---------------------------------------------------------------------
test('guardrail: alle 14 canonieke "Wat is X?"-vragen blijven hun eigen deterministicFallback-item geven', () => {
  const cases = [
    { q: 'Wat is de inschrijving bij de KVK?', id: 'kvk-inschrijving' },
    { q: 'Wat is een eenmanszaak?', id: 'eenmanszaak' },
    { q: 'Wat is een BV?', id: 'bv' },
    { q: 'Wat is een VOF of maatschap?', id: 'vof-en-maatschap' },
    { q: 'Wat is een balans?', id: 'balans' },
    { q: 'Wat is een winst-en-verliesrekening?', id: 'winst-en-verliesrekening' },
    { q: 'Wat zijn debiteuren en crediteuren?', id: 'debiteuren-en-crediteuren' },
    { q: 'Wat is een jaarrekening?', id: 'jaarrekening' },
    { q: 'Wat is btw?', id: 'btw-algemeen' },
    { q: 'Wat is de KOR?', id: 'kor' },
    { q: 'Wat is een DGA?', id: 'dga' },
    { q: 'Wat is dividend?', id: 'dividend' },
  ];
  for (const { q, id } of cases) {
    const result = findDeterministicFallbackItem(q, KB);
    assert.equal(result?.id, id, `"${q}" moet nog steeds "${id}" geven`);
  }
});

// ---------------------------------------------------------------------
// 5. Gelijkstandgevallen: de guardrail gebruikt margin >= 0 (een gelijke
// score mag door), en de bestaande prioriteits-/titel-tiebreak binnen de
// deterministicFallback-set zelf blijft ongewijzigd.
// ---------------------------------------------------------------------
test('guardrail: een EXACTE score-gelijkstand met een niet-deterministisch item buiten de set blokkeert de kandidaat niet (marge >= 0)', () => {
  const items = [
    {
      id: 'bv',
      title: 'Besloten vennootschap (BV)',
      category: 'Ondernemingsvormen',
      content: 'Een BV is een rechtspersoon.',
      tags: ['bv', 'besloten vennootschap'],
      priority: 3,
      deterministicFallback: true,
    },
    {
      id: 'ander-item-zelfde-score',
      title: 'Een ander onderwerp met bv erin',
      category: 'Overig',
      content: 'Dit item noemt bv ook, zonder deterministicFallback.',
      tags: ['bv'],
      priority: 1,
    },
  ];
  // Query "Wat is een BV?" -> queryTokens = ['bv']. Beide items scoren
  // hetzelfde (titel/tags bevatten allebei "bv", geen extra treffers) —
  // een exacte gelijkstand, geen strikt hogere score elders.
  const result = findDeterministicFallbackItem('Wat is een BV?', items);
  assert.equal(result?.id, 'bv', 'bij een exacte gelijkstand (score elders NIET strikt hoger) moet de kandidaat gewoon doorgelaten worden');
});

test('guardrail: een STRIKT hogere score bij een ander item buiten de deterministicFallback-set blokkeert een beschermde kandidaat wél', () => {
  const items = [
    {
      id: 'bv',
      title: 'Besloten vennootschap (BV)',
      category: 'Ondernemingsvormen',
      content: 'Een BV is een rechtspersoon.',
      tags: ['bv', 'besloten vennootschap'],
      priority: 3,
      deterministicFallback: true,
    },
    {
      id: 'specifieker-onderwerp',
      title: 'Rekening-courant met de BV',
      category: 'BV en vennootschapsbelasting',
      content: 'Rekening-courant is een lopende schuldverhouding tussen DGA en BV.',
      tags: ['rekening-courant', 'rekening courant bv', 'bv'],
      priority: 2,
    },
  ];
  const result = findDeterministicFallbackItem('Wat is rekening-courant bij mijn BV?', items);
  assert.equal(result, null, 'als een ander item strikt hoger scoort, moet de beschermde kandidaat null opleveren i.p.v. het bredere item');
});

test('guardrail: de bestaande titel-tiebreak TUSSEN twee deterministicFallback-items onderling blijft ongewijzigd (nog steeds null bij aanhoudende gelijkstand)', () => {
  const items = [
    { id: 'a', title: 'Btw algemeen', category: 'Btw', content: 'btw btw btw', tags: ['btw'], priority: 2, deterministicFallback: true },
    { id: 'b', title: 'Btw tarieven', category: 'Btw', content: 'btw btw btw', tags: ['btw'], priority: 2, deterministicFallback: true },
  ];
  // Geen van beide id's zit in WIDE_MATCH_GUARDED_IDS, dus dit pad is
  // volledig ongewijzigd t.o.v. vóór deze ronde: aanhoudende gelijkstand na
  // score+titel-tiebreak blijft null.
  assert.equal(findDeterministicFallbackItem('btw', items), null);
});

// ---------------------------------------------------------------------
// 6. Een kandidaat BUITEN de vijf-item-set wordt door de nieuwe guardrail
// niet beïnvloed, ook niet als een ander item elders strikt hoger scoort.
// ---------------------------------------------------------------------
test('guardrail raakt geen kandidaat buiten de vijf beschermde id\'s, ook niet bij een strikt hogere score elders', () => {
  const items = [
    {
      id: 'balans',
      title: 'Balans',
      category: 'Administratie en accountancy',
      content: 'De balans is een overzicht van bezittingen en schulden.',
      tags: ['balans', 'bezittingen'],
      priority: 2,
      deterministicFallback: true,
    },
    {
      id: 'ander-item-hogere-score',
      title: 'Balans en nog veel meer over balans',
      category: 'Overig',
      content: 'Balans balans balans balans.',
      tags: ['balans', 'financieel overzicht', 'balans opstellen'],
      priority: 1,
    },
  ];
  // 'balans' zit niet in WIDE_MATCH_GUARDED_IDS, dus zelfs als
  // 'ander-item-hogere-score' hoger scoort, verandert dat niets: de
  // guardrail wordt hier helemaal niet toegepast.
  const result = findDeterministicFallbackItem('Wat is een balans?', items);
  assert.equal(result?.id, 'balans', 'een kandidaat buiten de vijf beschermde id\'s moet ongewijzigd gedrag houden');
});

// ---------------------------------------------------------------------
// 7. Consistentiecontrole: waar de guardrail null teruggeeft, was er
// daadwerkelijk een ander kennisitem (ook buiten de deterministicFallback-
// set) met een hogere of gelijke score — dus geen willekeurige blokkade.
// ---------------------------------------------------------------------
test('guardrail: waar het resultaat null is, bestaat er een item dat op de volledige retrieval minstens zo relevant scoort', () => {
  const cases = [
    'Wat is rekening-courant met mijn BV?',
    'Waar betaal ik belasting over als ondernemer?',
    'Hoe zit btw bij klanten in het buitenland?',
    'Wanneer geldt een btw-vrijstelling?',
    'Welke belasting betaalt een VOF?',
    'Hoe werkt inkomstenbelasting bij een VOF?',
    'Kan een VOF personeel in dienst nemen?',
  ];
  for (const q of cases) {
    assert.equal(findDeterministicFallbackItem(q, KB), null);
    const top = retrieveKnowledgeItems(q, KB, { maxItems: 1 })[0];
    assert.ok(top, `"${q}": volledige retrieval moet nog steeds minstens één relevant item vinden`);
  }
});
