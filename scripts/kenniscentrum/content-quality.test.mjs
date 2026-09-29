// Regressietests voor de INHOUDELIJKE kwaliteit van de Avydo AI-kennisbank
// (src/data/ai-knowledge/) en de bijbehorende systeemprompt-instructies
// (src/pages/api/kenniscentrum-chat.ts, buildSystemPrompt()). Ronde 7
// (2026-09-29/30): een gerichte kwaliteitsronde op basis van concrete
// productiebevindingen (te lange/herhalende antwoorden, een grammaticaal
// onjuiste aansprakelijkheidsformulering, dividend als "simpel alternatief"
// voor loon gepresenteerd, een ongevraagde claim over een zakelijke
// bankrekening bij een personeelsvraag). Dit bestand test zowel de ECHTE
// kennisbankbestanden (via tekstuele/regex-extractie, hetzelfde patroon als
// elders in deze testset — geen TS-import nodig) als de daadwerkelijke,
// nu aangescherpte systeemprompt. Draait met Node's ingebouwde testrunner:
// `npm run kenniscentrum:test`, geen live Groq-aanroep nodig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieveKnowledgeItems, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');

const KB_FILES = ['administratie.ts', 'btw.ts', 'bv-dga.ts', 'inkomstenbelasting.ts', 'ondernemingsvormen.ts', 'personeel.ts'];
const ALLOWED_SOURCE_HOSTS = ['belastingdienst.nl', 'kvk.nl', 'ondernemersplein.kvk.nl', 'rijksoverheid.nl'];

function readKbFile(name) {
  return readFileSync(path.join(KB_DIR, name), 'utf-8');
}

// Extraheert, per item, het `content: '...'`-blok (single-quoted, met
// eventuele escaped quotes \' zoals gebruikt in deze bestanden) — dezelfde
// aanpak als extractSystemPromptAndSchema() in token-estimate.test.mjs,
// toegepast op de kennisbankbestanden.
function extractContentBlocks(text) {
  const regex = /content:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g;
  const blocks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].replace(/\\'/g, "'"));
  }
  return blocks;
}

function extractSourceUrls(text) {
  const regex = /sourceUrl:\s*\n?\s*'([^']+)'/g;
  const urls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// ---------------------------------------------------------------------
// 1. Kennisbank-brede audit (opdracht: "loop alle bestanden systematisch
// door" — punten 3/4/5/10 uit de audit-checklist).

test('elk kennisitem heeft een lastVerified-datum (evenveel als id\'s)', () => {
  for (const file of KB_FILES) {
    const text = readKbFile(file);
    const idCount = [...text.matchAll(/^\s{2}\{\s*\n\s*id: '/gm)].length;
    const lastVerifiedCount = [...text.matchAll(/lastVerified: '\d{4}-\d{2}-\d{2}'/g)].length;
    assert.equal(lastVerifiedCount, idCount, `${file}: elk kennisitem (${idCount}) moet een lastVerified-datum hebben (telde ${lastVerifiedCount})`);
  }
});

test('elke sourceUrl komt van een toegestane officiële bron (Belastingdienst/KVK/Rijksoverheid), geen willekeurige commerciële site', () => {
  for (const file of KB_FILES) {
    const text = readKbFile(file);
    const urls = extractSourceUrls(text);
    assert.ok(urls.length > 0, `${file}: geen enkele sourceUrl gevonden — extractie mogelijk kapot`);
    for (const url of urls) {
      assert.match(url, /^https:\/\//, `${file}: sourceUrl moet https zijn: ${url}`);
      const host = new URL(url).hostname.replace(/^www\./, '');
      const allowed = ALLOWED_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
      assert.ok(allowed, `${file}: sourceUrl-host "${host}" staat niet op de toegestane lijst (${ALLOWED_SOURCE_HOSTS.join(', ')}) — url: ${url}`);
    }
  }
});

test('kennisitem-content bevat geen hardcoded percentages of euro-bedragen die jaarlijks kunnen wijzigen', () => {
  const percentagePattern = /\b\d+(?:[.,]\d+)?\s?%/;
  const euroPattern = /€\s?\d|\b\d+(?:[.,]\d{3})*\s*euro\b/i;
  for (const file of KB_FILES) {
    const text = readKbFile(file);
    const blocks = extractContentBlocks(text);
    assert.ok(blocks.length > 0, `${file}: geen content-blokken gevonden — extractie mogelijk kapot`);
    blocks.forEach((content, idx) => {
      assert.ok(!percentagePattern.test(content), `${file} item #${idx + 1}: content bevat een hardcoded percentage — verwijs naar sourceUrl in plaats daarvan. Fragment: "${content.slice(0, 120)}..."`);
      assert.ok(!euroPattern.test(content), `${file} item #${idx + 1}: content bevat een hardcoded eurobedrag — verwijs naar sourceUrl in plaats daarvan. Fragment: "${content.slice(0, 120)}..."`);
    });
  }
});

test('kennisitem-ids zijn uniek over de hele kennisbank (geen dubbele id in verschillende bestanden)', () => {
  const seen = new Map();
  for (const file of KB_FILES) {
    const text = readKbFile(file);
    const ids = [...text.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
    for (const id of ids) {
      assert.ok(!seen.has(id), `id "${id}" komt zowel in ${seen.get(id)} als in ${file} voor — moet uniek zijn`);
      seen.set(id, file);
    }
  }
});

// ---------------------------------------------------------------------
// 2. Specifieke, gerapporteerde content-issues (opdracht, productiebevindingen
// 4/5/6/8)

test('REGRESSIE (punt 4): het "bv"-kennisitem formuleert aansprakelijkheid direct en correct, geen grammaticaal onjuiste term ("schuldeiserij")', () => {
  const text = readKbFile('ondernemingsvormen.ts');
  const blocks = extractContentBlocks(text);
  const bvContent = blocks.find((c) => c.includes('besloten vennootschap (BV) is een rechtspersoon'));
  assert.ok(bvContent, 'kon het "bv"-item niet terugvinden');
  assert.match(bvContent, /De BV is zelf aansprakelijk voor haar eigen schulden/, 'de aansprakelijkheidsclaim moet direct en positief geformuleerd zijn');
  assert.ok(!bvContent.includes('schuldeiserij'), 'de gerapporteerde, grammaticaal onjuiste term "schuldeiserij" mag niet in de kennisbank voorkomen');
});

test('REGRESSIE (punt 5): het "dividend"-item presenteert dividend niet als simpel alternatief voor loon', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const dividendContent = blocks.find((c) => c.startsWith('Dividend is een uitkering'));
  assert.ok(dividendContent, 'kon het "dividend"-item niet terugvinden');
  assert.ok(!dividendContent.includes('als alternatief voor'), 'dividend mag niet als simpel alternatief voor loon worden gepresenteerd');
  assert.match(dividendContent, /geen vervanging voor loon/, 'het item moet expliciet aangeven dat dividend geen vervanging is voor het verplichte gebruikelijk loon');
  assert.match(dividendContent, /gebruikelijk loon/);
});

test('REGRESSIE (punt 6): het "winst-in-de-bv"-item is compact (geen uitweiding naar rechtspersoonlijkheid/oprichting/vergelijking)', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const winstContent = blocks.find((c) => c.startsWith('Winst die in de BV blijft'));
  assert.ok(winstContent, 'kon het "winst-in-de-bv"-item niet terugvinden');
  const wordCount = winstContent.split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount <= 115, `het item moet compact blijven (≤115 woorden voor een gerichte vervolgvraag), telde ${wordCount} woorden`);
  assert.ok(!/rechtspersoonlijkheid|notariële akte|oprichting/i.test(winstContent), 'het item moet niet uitweiden naar rechtspersoonlijkheid/oprichting — dat hoort bij het "bv"-item, niet bij deze gerichte vervolgvraag');
  assert.match(winstContent, /vennootschapsbelasting/, 'het kernfeit (VPB blijft verschuldigd) moet aanwezig blijven');
});

test('REGRESSIE (punt 2): het "btw-algemeen"-item herhaalt "in rekening" niet nodeloos', () => {
  const text = readKbFile('btw.ts');
  const blocks = extractContentBlocks(text);
  const btwContent = blocks.find((c) => c.startsWith('Btw (omzetbelasting)'));
  assert.ok(btwContent, 'kon het "btw-algemeen"-item niet terugvinden');
  const occurrences = [...btwContent.matchAll(/in rekening/g)].length;
  assert.ok(occurrences <= 1, `"in rekening" mag niet herhaald worden (duidt op herhaling in het antwoord), telde ${occurrences} keer`);
});

test('REGRESSIE (punt 8): het "zakelijke-bankrekening"-item presenteert een zakelijke rekening voor een BV niet als een specifieke wettelijke plicht', () => {
  const text = readKbFile('administratie.ts');
  const blocks = extractContentBlocks(text);
  const rekeningContent = blocks.find((c) => c.startsWith('Voor een eenmanszaak, VOF, maatschap of CV'));
  assert.ok(rekeningContent, 'kon het "zakelijke-bankrekening"-item niet terugvinden');
  assert.match(rekeningContent, /een specifieke wet die dit apart voorschrijft is er echter niet/, 'moet expliciet aangeven dat er geen aparte wettelijke plicht is, ook niet voor een BV');
});

test('het "bedrijfsverzekeringen"-item onderscheidt de vier categorieën (wettelijk/sector-contract/vrijwillig/persoonlijk) expliciet', () => {
  const text = readKbFile('ondernemingsvormen.ts');
  const blocks = extractContentBlocks(text);
  const verzekeringenContent = blocks.find((c) => c.startsWith('Welke verzekeringen nodig'));
  assert.ok(verzekeringenContent, 'kon het "bedrijfsverzekeringen"-item niet terugvinden');
  assert.match(verzekeringenContent, /Wettelijk verplicht, ongeacht de situatie/);
  assert.match(verzekeringenContent, /Verplicht afhankelijk van sector/);
  assert.match(verzekeringenContent, /Vrijwillige bedrijfsverzekeringen/);
  assert.match(verzekeringenContent, /Persoonlijke inkomensbescherming/);
});

test('geen enkel kennisitem in personeel.ts noemt een zakelijke bankrekening (voorkomt de gerapporteerde ongevraagde claim bij een personeelsvraag)', () => {
  const text = readKbFile('personeel.ts');
  assert.ok(!/bankrekening/i.test(text), 'personeel.ts mag geen bankrekening-claim bevatten — dat hoort bij administratie.ts, niet bij een personeelsvraag');
});

// ---------------------------------------------------------------------
// 3. De systeemprompt: nieuwe lengte-/focus-/precisie-instructies (opdracht,
// "ANTWOORDLENGTE" en "VOORKOM HERHALING")

function readRouteText() {
  return readFileSync(ROUTE_FILE, 'utf-8');
}

test('de systeemprompt geeft per vraagtype (definitie/praktisch/vervolgvraag/vergelijking) expliciete lengte-/focusinstructies', () => {
  const text = readRouteText();
  assert.match(text, /Definitievraag: kortAntwoord/);
  assert.match(text, /Praktische vraag: direct antwoord/);
  assert.match(text, /Vervolgvraag: beantwoord ALLEEN het nieuwe, specifieke deelonderwerp/);
  assert.match(text, /Vergelijkingsvraag: noem de relevante verschillen/);
});

test('de systeemprompt gebruikt het "winst in de BV laten"-scenario expliciet als voorbeeld van focus bij een vervolgvraag', () => {
  const text = readRouteText();
  assert.match(text, /en als ik de winst in de BV laat.*ná een BV-gesprek/);
});

test('de systeemprompt verbiedt expliciet het twee keer zeggen van hetzelfde feit (anti-herhaling)', () => {
  const text = readRouteText();
  assert.match(text, /Zeg nooit hetzelfde feit twee keer in andere woorden/);
});

test('de systeemprompt heeft een expliciete precisie-/parafraseerregel (voorkomt een garbled term zoals "schuldeiserij")', () => {
  const text = readRouteText();
  assert.match(text, /Formuleer juridische\/fiscale kernbegrippen precies en in correct Nederlands/);
  assert.match(text, /parafraseer nooit tot een onjuiste of onbegrijpelijke formulering/);
});

test('de systeemprompt verbiedt expliciet een ongevraagde zakelijke-bankrekening-claim (regressie personeelsvraag)', () => {
  const text = readRouteText();
  assert.match(text, /geen uitspraken over een zakelijke bankrekening doen, tenzij expliciet gevraagd/);
});

test('de systeemprompt behandelt dividend expliciet als GEEN vervanging voor het gebruikelijk loon', () => {
  const text = readRouteText();
  assert.match(text, /Bij dividend: geen simpel alternatief voor loon/);
});

// ---------------------------------------------------------------------
// 4. Contextuele scenario's (opdracht, "CONTEXT EN RETRIEVAL") — gebruikt
// een kleine, qua id's/tags/content GETROUWE kopie van de relevante,
// GEWIJZIGDE kennisitems (zelfde patroon als provider-daily-limit.test.mjs),
// bijgewerkt naar de nieuwe content uit deze ronde.
// Bewust de VOLLEDIGE, echte content (niet ingekort) voor de items die in
// deze ronde zijn aangepast: een eerdere, ingekorte testversie van dit
// fixture verhulde een echte, in de productie-kennisbank aanwezige
// retrieval-bug (zie de twee REGRESSIE-tests hieronder) doordat de kortere
// tekst toevallig andere trefwoorden miste dan de echte content.
const CONTEXT_TEST_ITEMS = [
  {
    id: 'bv',
    title: 'Besloten vennootschap (BV)',
    category: 'Ondernemingsvormen',
    content:
      'Een besloten vennootschap (BV) is een rechtspersoon: de BV heeft eigen rechten en plichten, los van de persoon (of personen) die de BV bestuurt of erin werkt. Voor oprichting is een notariële akte nodig. De BV is zelf aansprakelijk voor haar eigen schulden; de bestuurder/aandeelhouder is daarvoor in privé doorgaans niet aansprakelijk, met uitzonderingen (bijvoorbeeld bij wanbestuur). Een BV betaalt vennootschapsbelasting over de winst, in plaats van dat de winst rechtstreeks bij de eigenaar in de inkomstenbelasting valt zoals bij een eenmanszaak.',
    tags: ['bv', 'besloten vennootschap', 'rechtspersoon'],
    priority: 3,
    deterministicFallback: true,
  },
  // Twee items die in de ECHTE kennisbank op dezelfde score kunnen uitkomen
  // als "bv" bij een kale "Wat is een BV?"-vraag (ze noemen "bv" ook in
  // titel/tags/body) — nodig om de prioriteits-tiebreak-fix hieronder
  // daadwerkelijk te testen, niet alleen tegen een fixture zonder concurrentie.
  {
    id: 'verschil-eenmanszaak-en-bv',
    title: 'Verschil tussen een eenmanszaak en een BV',
    category: 'Ondernemingsvormen',
    content:
      'Het belangrijkste verschil is rechtspersoonlijkheid: een BV is een rechtspersoon met een eigen vermogen, een eenmanszaak niet. Aansprakelijkheid: bij een eenmanszaak bent u in privé aansprakelijk voor zakelijke schulden; bij een BV is de BV zelf aansprakelijk. Een BV is niet automatisch goedkoper of fiscaal voordeliger dan een eenmanszaak — de uitkomst hangt onder meer af van de hoogte van de winst.',
    tags: ['verschil eenmanszaak bv', 'eenmanszaak of bv', 'bv voordeliger', 'is een bv beter', 'bv goedkoper'],
    priority: 3,
  },
  {
    id: 'vennootschapsbelasting',
    title: 'Vennootschapsbelasting',
    category: 'BV en vennootschapsbelasting',
    content:
      'Een BV (en andere rechtspersonen zoals een NV) betaalt vennootschapsbelasting (vpb) over de fiscale winst. Dit is een aparte belasting op het niveau van de vennootschap, los van de inkomstenbelasting die de DGA privé betaalt over loon en eventueel dividend.',
    tags: ['vennootschapsbelasting', 'vpb', 'belasting bv'],
    priority: 3,
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content:
      'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders. Dividend is geen vervanging voor loon: een DGA moet sowieso een gebruikelijk loon ontvangen; dividend is een aanvullende manier om winst aan de aandeelhouder te laten toekomen, en ontstaat pas op het moment dat de BV daadwerkelijk besluit uit te keren.',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'winst-in-de-bv',
    title: 'Winst in de BV laten (winst reserveren)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Winst die in de BV blijft telt gewoon mee in de winst waarover de BV vennootschapsbelasting betaalt. Zolang er geen dividend wordt uitgekeerd, is er over dat bedrag geen dividendbelasting of inkomstenbelasting bij de aandeelhouder verschuldigd; het geld blijft binnen de onderneming, bijvoorbeeld voor investeringen of liquiditeit.',
    tags: ['winst in de bv laten', 'winst reserveren', 'winst niet uitkeren'],
    priority: 3,
  },
  {
    id: 'btw-algemeen',
    title: 'Btw in Nederland',
    category: 'Btw',
    content: 'Btw (omzetbelasting) is de belasting die ondernemers in rekening brengen over de verkoop van goederen en diensten, en die zij periodiek afdragen aan de Belastingdienst.',
    tags: ['btw', 'omzetbelasting', 'wat is btw'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'btw-terugvragen-voorbelasting',
    title: 'Btw terugvragen (voorbelasting)',
    category: 'Btw',
    content: 'Btw die een ondernemer zelf betaalt over zakelijke kosten en investeringen wordt voorbelasting genoemd, en mag in de btw-aangifte in mindering worden gebracht op de btw die aan klanten in rekening is gebracht.',
    tags: ['voorbelasting', 'btw terugvragen', 'btw terugkrijgen', 'btw aftrekken'],
    priority: 2,
  },
  {
    id: 'werknemer-aannemen',
    title: 'Een werknemer aannemen',
    category: 'Personeel',
    content:
      'Bij het aannemen van de eerste werknemer komt in de kern het volgende samen: u wordt werkgever, u stelt een arbeidsovereenkomst op, en u start een loonadministratie. Als werkgever moet u zich uiterlijk op de dag dat de eerste werknemer begint aanmelden bij de Belastingdienst. Zie voor de afzonderlijke vervolgstappen ook de kennisitems over loonadministratie, loonheffingen, werkgeversverplichtingen en — waar van toepassing — pensioen en arbeidsomstandigheden.',
    tags: ['werknemer aannemen', 'personeel aannemen', 'personeel aanneem', 'eerste werknemer', 'aanmelden als werkgever', 'werkgever worden'],
    priority: 3,
  },
  {
    id: 'pensioen-werknemers',
    title: 'Pensioen voor werknemers',
    category: 'Personeel',
    content:
      'Of een werkgever verplicht is een pensioenregeling aan te bieden, hangt af van de sector: bij een verplichte bedrijfstakpensioenregeling (bijvoorbeeld via een bedrijfstakpensioenfonds) moet een werkgever in die sector werknemers daarbij aansluiten; buiten zo\'n verplichte regeling is pensioen niet voor elke werkgever wettelijk verplicht, al bieden veel werkgevers dit wel aan.',
    tags: ['pensioen', 'pensioenregeling', 'pensioenverplichting', 'bedrijfstakpensioenfonds'],
    priority: 1,
  },
];

test('CONTEXT: "Wat is een BV?" -> "En hoe zit het met dividend?" -> "En als ik de winst in de BV laat?" geeft bij elke stap het juiste, specifieke item (geen terugval naar het generieke BV-item)', () => {
  const conversation = ['Wat is een BV?', 'En hoe zit het met dividend?', 'En als ik de winst in de BV laat?'];
  const expectedTopItem = ['bv', 'dividend', 'winst-in-de-bv'];
  const history = [];

  conversation.forEach((message, idx) => {
    const previousUserMessages = history.filter((h) => h.role === 'user').map((h) => h.text);
    let items = retrieveKnowledgeItems(message, CONTEXT_TEST_ITEMS, { maxItems: 2 });
    if (items.length === 0 && previousUserMessages.length > 0) {
      items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), CONTEXT_TEST_ITEMS, { maxItems: 2 });
    }
    assert.ok(items.length > 0, `vraag "${message}" (stap ${idx + 1}) leverde geen enkel kennisitem op`);
    assert.equal(items[0].id, expectedTopItem[idx], `vraag "${message}" (stap ${idx + 1}) moet "${expectedTopItem[idx]}" bovenaan zetten, kreeg "${items[0].id}"`);
    history.push({ role: 'user', text: message });
    history.push({ role: 'assistant', text: items[0].content });
  });
});

test('CONTEXT: "Wat is btw?" -> "Kan ik die terugvragen?" vindt specifiek het voorbelasting-item, niet alleen de algemene btw-definitie opnieuw', () => {
  const history = [{ role: 'user', text: 'Wat is btw?' }];
  const message = 'Kan ik die terugvragen?';
  const previousUserMessages = history.map((h) => h.text);
  let items = retrieveKnowledgeItems(message, CONTEXT_TEST_ITEMS, { maxItems: 2 });
  if (items.length === 0) {
    items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), CONTEXT_TEST_ITEMS, { maxItems: 2 });
  }
  assert.ok(items.length > 0, 'de vervolgvraag over teruggave leverde geen kennisitem op');
  assert.equal(items[0].id, 'btw-terugvragen-voorbelasting', `de vervolgvraag moet het voorbelasting-item bovenaan zetten, kreeg "${items[0].id}"`);
});

test('CONTEXT: "Ik wil personeel aannemen." -> "Moet ik dan een pensioen regelen?" vindt specifiek het pensioen-item', () => {
  const history = [{ role: 'user', text: 'Ik wil personeel aannemen.' }];
  const message = 'Moet ik dan een pensioen regelen?';
  const previousUserMessages = history.map((h) => h.text);
  let items = retrieveKnowledgeItems(message, CONTEXT_TEST_ITEMS, { maxItems: 2 });
  if (items.length === 0) {
    items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), CONTEXT_TEST_ITEMS, { maxItems: 2 });
  }
  assert.ok(items.length > 0, 'de pensioenvervolgvraag leverde geen kennisitem op');
  assert.equal(items[0].id, 'pensioen-werknemers', `de vervolgvraag moet het pensioen-item bovenaan zetten, kreeg "${items[0].id}"`);
});

// ---------------------------------------------------------------------
// 5. De 12 minimaal vereiste testvragen uit de opdracht: bevestigt dat elke
// vraag daadwerkelijk een kennisitem vindt (dus nooit "onvoldoendeInformatie"
// puur door een ontbrekende match) via de ECHTE, huidige deterministische
// fallback-/retrievallogica tegen een representatieve fixture.
const TWELVE_QUESTIONS_ITEMS = [
  ...CONTEXT_TEST_ITEMS,
  { id: 'eenmanszaak', title: 'Eenmanszaak', category: 'Ondernemingsvormen', content: 'Een eenmanszaak is een rechtsvorm zonder rechtspersoonlijkheid.', tags: ['eenmanszaak', 'zzp'], priority: 3, deterministicFallback: true },
  { id: 'balans', title: 'Balans', category: 'Administratie en accountancy', content: 'De balans is een overzicht van bezittingen en schulden.', tags: ['balans', 'bezittingen'], priority: 3, deterministicFallback: true },
  { id: 'gebruikelijk-loon', title: 'Gebruikelijk loon', category: 'BV en vennootschapsbelasting', content: 'De gebruikelijkloonregeling verplicht een DGA zichzelf een loon toe te kennen, het hoogste van drie toetsen.', tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris'], priority: 3 },
  { id: 'bedrijfsverzekeringen', title: 'Bedrijfsverzekeringen', category: 'Ondernemingsvormen', content: 'Welke verzekeringen nodig zijn hangt af van activiteiten, personeel, bedrijfspand en risico\'s.', tags: ['bedrijfsverzekeringen', 'welke verzekeringen nodig', 'welke verzekeringen heb ik nodig'], priority: 1 },
  { id: 'werkgeversverplichtingen', title: 'Werkgeversverplichtingen', category: 'Personeel', content: 'Zodra een onderneming personeel in dienst heeft, gelden diverse wettelijke verplichtingen.', tags: ['werkgeversverplichtingen', 'verplichtingen werkgever', 'personeel in dienst'], priority: 3 },
];

const TWELVE_QUESTIONS = [
  'Wat is een balans?',
  'Wat is btw?',
  'Wat is een eenmanszaak?',
  'Wat is een BV?',
  'En hoe zit het met dividend?',
  'En als ik de winst in de BV laat?',
  'Wat is gebruikelijk loon?',
  'Welke verzekeringen heb ik nodig?',
  'Wat moet ik regelen als ik personeel aanneem?',
  'Kan ik de btw terugvragen?',
  'Moet ik pensioen regelen als ik personeel aanneem?',
  'Wat is het verschil tussen een eenmanszaak en een BV?',
];

test('alle 12 vereiste testvragen vinden minstens één relevant kennisitem', () => {
  const history = [];
  const misses = [];
  for (const message of TWELVE_QUESTIONS) {
    const previousUserMessages = history.filter((h) => h.role === 'user').map((h) => h.text);
    let items = retrieveKnowledgeItems(message, TWELVE_QUESTIONS_ITEMS, { maxItems: 2 });
    if (items.length === 0 && previousUserMessages.length > 0) {
      items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), TWELVE_QUESTIONS_ITEMS, { maxItems: 2 });
    }
    if (items.length === 0) misses.push(message);
    history.push({ role: 'user', text: message });
    history.push({ role: 'assistant', text: items[0]?.content ?? '' });
  }
  assert.equal(misses.length, 0, `deze vragen vonden geen enkel kennisitem: ${JSON.stringify(misses)}`);
});
