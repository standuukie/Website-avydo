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
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieveKnowledgeItems, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';
import { formatSourcesForPrompt } from '../../src/lib/source-freshness.mjs';
import { articleContextSnippet } from '../../src/lib/article-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');

// Zelfde volgorde als de spreads in src/data/ai-knowledge/index.ts — belangrijk
// zodra een test (indirect) op array-volgorde leunt, bv. via een stable-sort
// tiebreak in retrieveKnowledgeItems(); zie ook context-retrieval.test.mjs.
const KB_FILES = ['ondernemingsvormen.ts', 'administratie.ts', 'btw.ts', 'inkomstenbelasting.ts', 'bv-dga.ts', 'personeel.ts'];
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

test('REGRESSIE (punt 5, ronde 9): het "dividend"-item presenteert dividend niet als simpel alternatief voor loon, en gebruikt geen absolute claims ("altijd"/"sowieso") of dubbele uitleg', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const dividendContent = blocks.find((c) => c.startsWith('Dividend is een uitkering'));
  assert.ok(dividendContent, 'kon het "dividend"-item niet terugvinden');
  assert.ok(!dividendContent.includes('als alternatief voor'), 'dividend mag niet als simpel alternatief voor loon worden gepresenteerd');
  assert.ok(!/\baltijd\b/i.test(dividendContent), 'geen absolute "altijd"-claim');
  assert.ok(!/\bsowieso\b/i.test(dividendContent), 'geen absolute "sowieso"-claim');
  assert.match(dividendContent, /gebruikelijkloonregeling van toepassing kan zijn|kan .* van toepassing zijn/, 'het item moet de voorwaardelijke, niet-absolute formulering gebruiken');
  assert.match(dividendContent, /dividend staat daar los van/i, 'moet expliciet aangeven dat dividend los staat van de gebruikelijkloonregeling, zonder het dubbel uit te leggen');
  // Het punt mag maar op ÉÉN plek in dit item gemaakt worden (geen herhaling).
  const loonMentions = [...dividendContent.matchAll(/gebruikelijk loon|gebruikelijkloonregeling/gi)].length;
  assert.equal(loonMentions, 1, `de gebruikelijkloonregeling mag maar één keer genoemd worden in het dividend-item (geen dubbele uitleg), telde ${loonMentions}`);
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

test('REGRESSIE (ronde 9, punt 2): het "winst-in-de-bv"-item gebruikt de grammaticaal correcte vorm "dividend uit te keren", nooit een samengesteld "dividenduitkeren"', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const winstContent = blocks.find((c) => c.startsWith('Winst die in de BV blijft'));
  assert.ok(winstContent, 'kon het "winst-in-de-bv"-item niet terugvinden');
  assert.match(winstContent, /dividend uit te keren/, 'moet de correcte, scheidbare werkwoordsvorm "dividend uit te keren" bevatten');
  assert.ok(!/te dividenduitkeren|dividenduitkeren/i.test(winstContent), 'mag nooit het grammaticaal onjuiste samengestelde "dividenduitkeren" bevatten');
});

test('REGRESSIE (ronde 9, punt 3): het "winst-in-de-bv"-item formuleert de belastingclaim niet absoluut (gebruikt een hedge zoals "in beginsel")', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const winstContent = blocks.find((c) => c.startsWith('Winst die in de BV blijft'));
  assert.ok(winstContent, 'kon het "winst-in-de-bv"-item niet terugvinden');
  assert.match(winstContent, /in beginsel/, 'de "geen dividendbelasting/inkomstenbelasting"-claim moet gehedged zijn (bijv. "in beginsel"), niet als absolute regel gepresenteerd');
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

// ---------------------------------------------------------------------
// Ronde 10 (live-test na de freeze-voorbereiding): twee concrete, opnieuw
// gerapporteerde problemen. Deze tests lezen de ECHTE kennisbankbestanden
// (niet een fixture) om te bevestigen dat de brontekst zelf gecorrigeerd is.

test('REGRESSIE (ronde 10, Arbo-vraag): "werknemer-aannemen" noemt "arbeidsomstandigheden" niet meer in zijn eigen content (voorkomt onterecht meescoren bij een Arbo-vraag)', () => {
  const text = readKbFile('personeel.ts');
  const blocks = extractContentBlocks(text);
  const werknemerContent = blocks.find((c) => c.startsWith('Bij het aannemen van de eerste werknemer'));
  assert.ok(werknemerContent, 'kon het "werknemer-aannemen"-item niet terugvinden');
  assert.ok(!/arbeidsomstandigheden/i.test(werknemerContent), 'het personeelsantwoord mag "arbeidsomstandigheden" niet meer noemen — dat woord liet het item onterecht meescoren voor Arbo-vragen');
  assert.match(werknemerContent, /pensioen/i, 'de (elders bevestigd correct werkende) pensioen-verwijzing moet behouden blijven');
});

test('REGRESSIE (ronde 10, Arbo-vraag): het "arbeidsomstandigheden"-item zelf blijft inhoudelijk over Arbowet/RI&E/preventiemedewerker/bedrijfsarts gaan', () => {
  const text = readKbFile('personeel.ts');
  const blocks = extractContentBlocks(text);
  const arboContent = blocks.find((c) => c.startsWith('De Arbowet verplicht werkgevers'));
  assert.ok(arboContent, 'kon het "arbeidsomstandigheden"-item niet terugvinden');
  assert.match(arboContent, /risico-inventarisatie|RI&E/i);
  assert.match(arboContent, /preventiemedewerker/i);
  assert.match(arboContent, /arbodienst|bedrijfsarts/i);
});

// Ronde 11 (herhaalde live-test): de daadwerkelijke grondoorzaak bleek niet
// werknemer-aannemen (ronde 10 loste dat terecht op, maar onvolledig) maar
// "werkgeversverplichtingen" — een item dat zelf ook "arbeidsomstandigheden
// (Arbowet)" noemt én de tag "personeel in dienst" heeft, en zo exact gelijk
// scoorde aan het Arbo-item voor de live-vraag. Bij een score-gelijkspel
// beslist priority; arbeidsomstandigheden stond nog op 1 tegenover
// werkgeversverplichtingen's 3. Dit bevestigt de brontekst-fix (priority 3)
// direct in het echte bestand, niet alleen via een testfixture.
test('REGRESSIE (ronde 11, Arbo-vraag — daadwerkelijke grondoorzaak): "arbeidsomstandigheden" heeft priority 3, gelijk aan "werkgeversverplichtingen" (wint de score-tie via bestandsvolgorde)', () => {
  const text = readKbFile('personeel.ts');
  const arboMatch = text.match(/id: 'arbeidsomstandigheden'[\s\S]*?priority: (\d)/);
  const werkgeversMatch = text.match(/id: 'werkgeversverplichtingen'[\s\S]*?priority: (\d)/);
  assert.ok(arboMatch, 'kon de priority van "arbeidsomstandigheden" niet vinden');
  assert.ok(werkgeversMatch, 'kon de priority van "werkgeversverplichtingen" niet vinden');
  assert.equal(Number(arboMatch[1]), 3, 'arbeidsomstandigheden moet priority 3 hebben om de score-tie met werkgeversverplichtingen te winnen');
  assert.equal(Number(arboMatch[1]), Number(werkgeversMatch[1]), 'bij gelijke priority beslist de (vaste) bestandsvolgorde, waarin arbeidsomstandigheden vóór werkgeversverplichtingen staat');
});

test('REGRESSIE (ronde 11, Arbo-vraag): het "arbeidsomstandigheden"-item noemt nu ook bedrijfshulpverlening (BHV), zoals expliciet gevraagd', () => {
  const text = readKbFile('personeel.ts');
  const blocks = extractContentBlocks(text);
  const arboContent = blocks.find((c) => c.startsWith('De Arbowet verplicht werkgevers'));
  assert.ok(arboContent, 'kon het "arbeidsomstandigheden"-item niet terugvinden');
  assert.match(arboContent, /bedrijfshulpverlening|BHV/i);
});

test('REGRESSIE (ronde 11, Arbo-vraag): "werkgeversverplichtingen" en "pensioen-werknemers" zijn NIET gewijzigd (scope strikt beperkt tot het Arbo-item)', () => {
  const text = readKbFile('personeel.ts');
  const blocks = extractContentBlocks(text);
  const werkgeversContent = blocks.find((c) => c.startsWith('Zodra een onderneming personeel in dienst heeft'));
  const pensioenContent = blocks.find((c) => c.startsWith('Of een werkgever verplicht is een pensioenregeling'));
  assert.ok(werkgeversContent, 'kon "werkgeversverplichtingen" niet terugvinden');
  assert.ok(pensioenContent, 'kon "pensioen-werknemers" niet terugvinden');
  assert.match(werkgeversContent, /aanmelding als werkgever bij de Belastingdienst/, 'werkgeversverplichtingen moet ongewijzigd zijn gebleven');
  assert.match(pensioenContent, /bedrijfstakpensioenregeling/, 'pensioen-werknemers moet ongewijzigd zijn gebleven');
});

test('REGRESSIE (ronde 10, winst-in-de-bv): geen "alleen belast" of "er ontstaat geen" — de belastingclaim blijft gehedged met "in beginsel"', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const winstContent = blocks.find((c) => c.startsWith('Winst die in de BV blijft'));
  assert.ok(winstContent, 'kon het "winst-in-de-bv"-item niet terugvinden');
  assert.ok(!/alleen belast/i.test(winstContent), 'geen "alleen belast"-formulering');
  assert.ok(!/er ontstaat geen/i.test(winstContent), 'geen "er ontstaat geen"-formulering');
  assert.ok(!/\baltijd\b/i.test(winstContent), 'geen "altijd"');
  assert.ok(!/\bnooit\b/i.test(winstContent), 'geen "nooit"');
  assert.match(winstContent, /in beginsel/, 'de belastingclaim moet gehedged blijven met "in beginsel"');
});

test('REGRESSIE (ronde 10, dividend): blijft de voorwaardelijke formulering gebruiken, geen "je moet nog steeds"/"moet"-achtige absolute herintroductie', () => {
  const text = readKbFile('bv-dga.ts');
  const blocks = extractContentBlocks(text);
  const dividendContent = blocks.find((c) => c.startsWith('Dividend is een uitkering'));
  assert.ok(dividendContent, 'kon het "dividend"-item niet terugvinden');
  assert.match(dividendContent, /Voor een DGA die werkzaamheden verricht voor zijn of haar BV kan de gebruikelijkloonregeling van toepassing zijn/, 'moet de exacte, voorwaardelijke formulering bevatten');
  assert.match(dividendContent, /dividend staat daar los van/i);
  assert.ok(!/\baltijd\b/i.test(dividendContent) && !/\bsowieso\b/i.test(dividendContent), 'geen "altijd"/"sowieso"');
});

test('REGRESSIE (ronde 10, btw terugvragen): maakt expliciet onderscheid tussen aftrekken/verrekenen van voorbelasting en het per saldo terugkrijgen van btw', () => {
  const text = readKbFile('btw.ts');
  const blocks = extractContentBlocks(text);
  const btwTerugContent = blocks.find((c) => c.startsWith('Btw die een ondernemer zelf betaalt'));
  assert.ok(btwTerugContent, 'kon het "btw-terugvragen-voorbelasting"-item niet terugvinden');
  assert.match(btwTerugContent, /aftrekken\/verrekenen van voorbelasting/, 'moet expliciet het aftrekken/verrekenen benoemen');
  assert.match(btwTerugContent, /per saldo/, 'moet expliciet "per saldo" gebruiken voor de daadwerkelijke teruggave');
  assert.match(btwTerugContent, /daadwerkelijk terug/, 'moet het verschil tussen aftrek en daadwerkelijke teruggave benoemen');
});

test('REGRESSIE (ronde 10, zakelijke kosten): is verder ingekort (kort antwoord + 2-3 nuances + bron), behoudt het IB/vpb-vs-btw-onderscheid', () => {
  const text = readKbFile('inkomstenbelasting.ts');
  const blocks = extractContentBlocks(text);
  const kostenContent = blocks.find((c) => c.startsWith('Kosten die uitsluitend of overwegend zakelijk'));
  assert.ok(kostenContent, 'kon het "zakelijke-versus-prive-kosten"-item niet terugvinden');
  const wordCount = kostenContent.split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount <= 95, `het item moet verder ingekort zijn (≤95 woorden, was ~140), telde ${wordCount} woorden`);
  assert.match(kostenContent, /aftrekbaarheid voor de winstberekening/, 'het IB/vpb-vs-btw-onderscheid moet behouden blijven');
  assert.match(kostenContent, /Btw bij zakelijke kosten en diensten/, 'de korte verwijzing naar het btw-item moet behouden blijven');
});

// ---------------------------------------------------------------------
// Bronstatus (2026-10-07): de systeemprompt verplicht het model de status van
// informatie correct weer te geven (voorstel/voornemen/consultatie/
// toekomstige wijziging ≠ geldende regel; "historisch" alleen als
// achtergrond). Geen live modelaanroep: getest wordt de instructie zelf én
// de context waarin het model de status kan herkennen (echte artikelen,
// echte fragmenten via articleContextSnippet, echte bronnaam met datum en
// "historisch" via formatSourcesForPrompt).

const CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');
const STATUS_RULE = '- Status: (wets)voorstel, voornemen, consultatie of toekomstige wijziging nooit als geldende regel; noem de fase uit de bron. "historisch" = achtergrond, actuele bron leidend. Verzin geen status.';

function loadArticle(fileStart) {
  const file = readdirSync(CONTENT_DIR).find((f) => f.startsWith(fileStart));
  const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
  const get = (key) => text.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
  return {
    title: get('title'), summary: get('summary') ?? '', relevance: get('relevance') ?? '', sourceName: get('sourceName'),
    sourceUrl: get('sourceUrl'), supersededBy: get('supersededBy'), publishedAt: new Date(get('publishedAt')),
    body: text.replace(/^---\n[\s\S]*?\n---\n/, ''),
  };
}
function promptFor(articles) {
  return formatSourcesForPrompt(articles.map((a, i) => ({
    id: i + 1, name: `Kenniscentrum Avydo (bron: ${a.sourceName})`, title: a.title, url: a.sourceUrl,
    snippet: articleContextSnippet(a), publishedAt: a.publishedAt, superseded: Boolean(a.supersededBy),
  })));
}

test('bronstatus: de regel staat in het BRONGEBRUIK-blok van de systeemprompt', () => {
  const text = readRouteText();
  const block = text.slice(text.indexOf('BRONGEBRUIK — CRUCIAAL'), text.indexOf('GEEN ONGEFUNDEERDE CONCLUSIES'));
  assert.ok(block.includes(STATUS_RULE));
});

test('bronstatus 1: een wetsvoorstel mag niet als geldende wet — regel noemt (wets)voorstel, en het fragment bevat het statuswoord', () => {
  assert.match(STATUS_RULE, /\(wets\)voorstel[^;]*nooit als geldende regel/);
  const prompt = promptFor([loadArticle('2026-07-10-kabinet-wil-meer-zekerheid')]);
  assert.match(prompt, /wetsvoorstel/i);
});

test('bronstatus 2: een internetconsultatie wordt als fase benoemd — regel noemt consultatie + "noem de fase", fragment bevat "internetconsultatie"', () => {
  assert.match(STATUS_RULE, /consultatie/);
  assert.match(STATUS_RULE, /noem de fase uit de bron/);
  const prompt = promptFor([loadArticle('2026-10-01-zelfstandigenwet')]);
  assert.match(prompt, /in internetconsultatie/);
});

test('bronstatus 3: een toekomstige wijzigingsdatum is geen huidige regel — regel noemt toekomstige wijziging, fragment bevat de toekomstige datum en de huidige regel', () => {
  assert.match(STATUS_RULE, /toekomstige wijziging nooit als geldende regel/);
  const prompt = promptFor([loadArticle('2026-09-10-werkgever-mag-geen-huur')]);
  assert.match(prompt, /per 1 juli 2028/);
  assert.match(prompt, /Op dit moment geldt nog een maximumpercentage van 25%/);
});

test('bronstatus 4: historisch artikel is achtergrond — regel gebruikt exact het label uit de bronnaam; actuele bron staat eerst en zonder label', () => {
  assert.match(STATUS_RULE, /"historisch" = achtergrond, actuele bron leidend/);
  const prompt = promptFor([loadArticle('2026-03-13-kabinet-komt-met-betaalbare'), loadArticle('2025-09-12-wetsvoorstel-voor-basisverzekering')]);
  assert.match(prompt, /^\[1\] Kenniscentrum Avydo \(bron: Rijksoverheid, 13-03-2026\)/);
  assert.match(prompt, /\[2\] Kenniscentrum Avydo \(bron: Rijksoverheid, 12-09-2025, historisch\)/);
});

test('bronstatus 5: een aangenomen wet mag definitief — de regel beperkt alleen voorstel/voornemen/consultatie/toekomstige wijziging, en de Wtta-bron zegt "aangenomen"', () => {
  assert.doesNotMatch(STATUS_RULE, /aangenomen|elke bron|altijd een voorbehoud/i);
  const prompt = promptFor([loadArticle('2025-11-11-eerste-kamer-stemt-in')]);
  assert.match(prompt, /heeft de Wet toelating terbeschikkingstelling van arbeidskrachten \(Wtta\) aangenomen/);
  assert.doesNotMatch(prompt, /historisch/);
});

test('bronstatus 6: een gewone actuele regel blijft actueel — geen statuswoorden of "historisch" in context van een actueel KVK-/Belastingdienst-artikel', () => {
  const article = loadArticle('2026-10-01-minimumloon-en-loonheffingen');
  assert.equal(article.sourceName, 'Belastingdienst');
  const prompt = promptFor([article]);
  assert.doesNotMatch(prompt, /historisch|wetsvoorstel|internetconsultatie|voornemen/i);
  assert.match(prompt, /\(bron: Belastingdienst, 01-10-2026\)/);
});

test('bronstatus: de status-regel verzint zelf geen status ("Verzin geen status")', () => {
  assert.match(STATUS_RULE, /Verzin geen status\.$/);
});
