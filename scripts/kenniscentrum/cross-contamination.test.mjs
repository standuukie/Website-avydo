// Regressietests voor het "kruisbesmetting"-incident (2026-09-30, ronde 8):
// productie-output liet zien dat sommige antwoorden een volledige, letterlijke
// alinea uit een ANDER kennisitem bevatten (bijv. de "onderneming starten"-
// tekst na een antwoord over personeel aannemen, of de "dividend"-tekst na
// een antwoord over gebruikelijk loon).
//
// Onderzoek (zie het eindrapport) wees uit dat de kennisitems ZELF geen
// ingesloten tekst uit een ander onderwerp bevatten (geverifieerd via
// tekstuele controle over alle bestanden in src/data/ai-knowledge/), maar
// dat de oorzaak in de ANTWOORDOPBOUW zat: buildSourceFallbackAnswer (zie
// src/lib/fallback-answer.mjs) plakte de VOLLEDIGE, letterlijke snippet van
// een eventuele TWEEDE (secundaire, minder relevante) retrieval-bron achter
// het antwoord van de eerste. Dit bestand test die daadwerkelijke, nu
// gefixte pijplijn end-to-end (echte retrieveKnowledgeItems + echte
// buildSourceFallbackAnswer, geen vereenvoudigde mock) tegen een realistische
// kopie van de kennisbank, voor exact de scenario's uit de opdracht (A t/m
// I). Draait met Node's ingebouwde testrunner: `npm run kenniscentrum:test`,
// geen live Groq-aanroep nodig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveKnowledgeItems, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';
import { buildSourceFallbackAnswer } from '../../src/lib/fallback-answer.mjs';

// Realistische kopie (id/tags/priority/content getrouw aan de echte,
// bijgewerkte kennisbank ná ronde 7/8) van de items die in de opdracht met
// naam genoemd worden — groot genoeg om echte concurrentie tussen items te
// simuleren (zonder concurrentie zou een test niets bewijzen).
const ITEMS = [
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
  {
    id: 'gebruikelijk-loon',
    title: 'Gebruikelijk loon',
    category: 'BV en vennootschapsbelasting',
    content:
      'De gebruikelijkloonregeling bepaalt, onder voorwaarden, welk loon een aanmerkelijkbelanghouder die werkzaamheden verricht voor zijn of haar BV daarvoor fiscaal in aanmerking moet nemen — dit loon is niet vrij te kiezen, ook niet door bewust te kiezen voor geen of een laag loon. De hoogte is het hoogste bedrag van drie toetsen: een wettelijk vastgesteld normbedrag, het loon van de meest vergelijkbare dienstbetrekking, of het loon van de meestverdienende werknemer binnen de BV. Het actuele normbedrag wijzigt regelmatig — raadpleeg de Belastingdienst voor de geldende cijfers.',
    tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris', 'hoeveel loon dga', 'loon mezelf uitbetalen', 'dga loon bepalen'],
    priority: 3,
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content:
      'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders. Voor een DGA die werkzaamheden verricht voor zijn of haar BV kan de gebruikelijkloonregeling van toepassing zijn; dividend staat daar los van en kan, als de BV tot uitkering besluit en aan de wettelijke voorwaarden wordt voldaan, aanvullend aan de aandeelhouder worden uitgekeerd.',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'winst-in-de-bv',
    title: 'Winst in de BV laten (winst reserveren)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Winst die in de BV blijft telt gewoon mee in de winst waarover de BV vennootschapsbelasting betaalt. Zolang de BV geen dividend uitkeert, is er in beginsel nog geen dividendbelasting of inkomstenbelasting bij de aandeelhouder verschuldigd over dat bedrag; het geld blijft binnen de onderneming, bijvoorbeeld voor investeringen of liquiditeit. Pas als de BV besluit dividend uit te keren, ontstaat die belastingplicht.',
    tags: ['winst in de bv laten', 'winst reserveren', 'winst niet uitkeren', 'geld in de bv laten zitten'],
    priority: 3,
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
      'Of een werkgever verplicht is een pensioenregeling aan te bieden, hangt af van de sector: bij een verplichte bedrijfstakpensioenregeling (bijvoorbeeld via een bedrijfstakpensioenfonds) moet een werkgever in die sector werknemers daarbij aansluiten; buiten zo\'n verplichte regeling is pensioen niet voor elke werkgever wettelijk verplicht, al bieden veel werkgevers dit wel aan, soms via een cao-afspraak.',
    tags: ['pensioen', 'pensioenregeling', 'pensioenverplichting', 'bedrijfstakpensioenfonds'],
    priority: 1,
  },
  {
    id: 'arbeidsomstandigheden',
    title: 'Arbeidsomstandigheden (Arbowet)',
    category: 'Personeel',
    content:
      'De Arbowet verplicht werkgevers te zorgen voor veilige en gezonde arbeidsomstandigheden. In de praktijk betekent dit onder meer: een risico-inventarisatie en -evaluatie (RI&E) opstellen, een preventiemedewerker aanwijzen, en een basiscontract afsluiten met een arbodienst of bedrijfsarts.',
    tags: ['arbowet', 'arbeidsomstandigheden', 'rie', 'risico-inventarisatie', 'preventiemedewerker', 'bedrijfsarts'],
    priority: 1,
  },
  {
    id: 'onderneming-starten',
    title: 'Een onderneming starten: praktische startcheck',
    category: 'Ondernemingsvormen',
    content:
      'Wie in Nederland een onderneming start, krijgt met een aantal vaste, samenhangende stappen te maken. Eerst een rechtsvorm kiezen, daarna inschrijving bij de KVK. Een zakelijke bankrekening is niet voor elke rechtsvorm verplicht. Afhankelijk van de aard van de onderneming kunnen daarnaast bedrijfsverzekeringen relevant zijn, en zodra er personeel bijkomt, gelden aparte werkgeversverplichtingen.',
    tags: ['onderneming starten', 'starten', 'bedrijf starten', 'wat moet ik regelen', 'startcheck'],
    priority: 3,
  },
  {
    id: 'zakelijke-versus-prive-kosten',
    title: 'Zakelijke kosten versus privékosten',
    category: 'Inkomstenbelasting',
    content:
      'Kosten die uitsluitend of overwegend zakelijk worden gemaakt, verlagen doorgaans de fiscale winst waarover u inkomsten- of vennootschapsbelasting betaalt; puur privékosten doen dat niet. Bij gemengde kosten (een auto, een telefoon, een werkruimte thuis) mag doorgaans alleen het zakelijke deel worden afgetrokken. Let op: dit gaat over de aftrekbaarheid voor de winstberekening — of over dezelfde kosten ook btw kan worden teruggevraagd, is een aparte beoordeling (zie het kennisitem "Btw bij zakelijke kosten en diensten").',
    tags: ['zakelijke kosten', 'privékosten', 'aftrekbare kosten', 'privételefoon aftrekken', 'gemengde kosten', 'boodschappen aftrekken'],
    priority: 3,
  },
  {
    id: 'btw-zakelijke-kosten-en-diensten',
    title: 'Btw bij zakelijke kosten en diensten',
    category: 'Btw',
    content:
      'Let op: dit gaat specifiek over de btw op zakelijke kosten, niet over de vraag of een kostenpost meetelt in de fiscale winstberekening (zie het kennisitem "Zakelijke kosten versus privékosten"). Over zakelijke kosten en aangeschafte diensten wordt in de regel btw in rekening gebracht, die als voorbelasting kan worden teruggevraagd voor zover de kosten zakelijk gebruikt worden; bij gemengd gebruik mag doorgaans alleen het zakelijke deel worden teruggevraagd.',
    tags: ['btw zakelijke kosten', 'btw diensten', 'btw verleggen', 'gemengde kosten btw'],
    priority: 2,
  },
  {
    id: 'btw-terugvragen-voorbelasting',
    title: 'Btw terugvragen (voorbelasting)',
    category: 'Btw',
    content:
      'Btw die een ondernemer zelf betaalt over zakelijke kosten en investeringen wordt voorbelasting genoemd, en mag in de btw-aangifte in mindering worden gebracht op de btw die aan klanten in rekening is gebracht.',
    tags: ['voorbelasting', 'btw terugvragen', 'btw terugkrijgen', 'btw aftrekken'],
    priority: 2,
  },
];

/** Simuleert exact de tweetraps-retrieval uit de route (kenniscentrum-chat.ts). */
function retrieve(message, previousUserMessages) {
  let items = retrieveKnowledgeItems(message, ITEMS, { maxItems: 2 });
  if (items.length === 0 && previousUserMessages.length > 0) {
    items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), ITEMS, { maxItems: 2 });
  }
  return items;
}

function toSources(items) {
  return items.map((item) => ({ name: `Avydo kennisbank (bron: test)`, title: item.title, url: 'https://example.org/' + item.id, snippet: item.content }));
}

test('Scenario A: "Wat is een BV?" -> primair het BV-definitie-item', () => {
  const items = retrieve('Wat is een BV?', []);
  assert.equal(items[0]?.id, 'bv');
});

test('Scenario B: "En hoe zit het met dividend?" -> dividend-item, NIET gebruikelijk-loon als primaire bron', () => {
  const items = retrieve('En hoe zit het met dividend?', ['Wat is een BV?']);
  assert.equal(items[0]?.id, 'dividend');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.equal(answer.sources[0].title, 'Dividend');
  assert.ok(!answer.explanation.includes('drie toetsen'), 'het antwoord mag geen gebruikelijk-loon-tekst bevatten');
});

test('Scenario C: "En als ik de winst in de BV laat?" -> winst-in-de-bv als primaire inhoud, geen volledige algemene BV-uitleg', () => {
  const items = retrieve('En als ik de winst in de BV laat?', ['Wat is een BV?', 'En hoe zit het met dividend?']);
  assert.equal(items[0]?.id, 'winst-in-de-bv');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.match(answer.shortAnswer, /Winst die in de BV blijft/);
  assert.ok(!answer.explanation.includes('notariële akte'), 'geen volledige BV-oprichtingsuitleg in het antwoord');
  assert.ok(!answer.explanation.includes('rechtspersoon: de BV heeft eigen rechten'), 'geen volledige algemene BV-definitie in het antwoord');
});

test('Scenario D: "Wat is gebruikelijk loon?" -> uitsluitend gebruikelijk-loon-informatie, geen volledige dividend-uitleg erbij', () => {
  const items = retrieve('Wat is gebruikelijk loon?', []);
  assert.equal(items[0]?.id, 'gebruikelijk-loon');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.match(answer.shortAnswer, /gebruikelijkloonregeling bepaalt/);
  assert.ok(!answer.explanation.includes('Dividend is een uitkering'), 'de volledige dividend-definitie mag niet als tweede uitleg verschijnen');
  assert.ok(!answer.explanation.includes('winstuitkering'), 'geen dividend-inhoud in het gebruikelijk-loon-antwoord');
});

test('Scenario E: "Wat moet ik regelen als ik personeel aanneem?" -> werknemer-aannemen, GEEN alinea over rechtsvorm/KVK/onderneming starten', () => {
  const items = retrieve('Wat moet ik regelen als ik personeel aanneem?', []);
  assert.equal(items[0]?.id, 'werknemer-aannemen');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.ok(!answer.explanation.includes('Wie in Nederland een onderneming start'), 'geen onderneming-starten-alinea in het antwoord (het gerapporteerde incident)');
  assert.ok(!answer.explanation.includes('rechtsvorm kiezen'), 'geen rechtsvormkeuze-uitleg in het antwoord');
  assert.ok(!answer.explanation.includes('zakelijke bankrekening'), 'geen zakelijke-bankrekening-als-startstap in het antwoord');
});

test('Scenario F: "Ik wil personeel aannemen." -> "Moet ik dan pensioen regelen?" -> pensioen-item, werknemer-aannemen verdringt het niet', () => {
  const items = retrieve('Moet ik dan pensioen regelen?', ['Ik wil personeel aannemen.']);
  assert.equal(items[0]?.id, 'pensioen-werknemers');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.ok(!answer.explanation.includes('Bij het aannemen van de eerste werknemer'), 'geen werknemer-aannemen-tekst in het pensioenantwoord');
});

test('Scenario G: "En hoe zit het met arbeidsomstandigheden?" -> Arbowet/RI&E, geen onderneming-startcheck', () => {
  const items = retrieve('En hoe zit het met arbeidsomstandigheden?', ['Ik wil personeel aannemen.']);
  assert.equal(items[0]?.id, 'arbeidsomstandigheden');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.match(answer.shortAnswer, /Arbowet/);
  assert.ok(!answer.explanation.includes('Wie in Nederland een onderneming start'), 'geen onderneming-startcheck in het arbeidsomstandigheden-antwoord');
});

test('Scenario H: "En hoe zit het met zakelijke kosten?" -> zakelijke kosten/fiscale winst, geen volledige btw-uitleg erbij', () => {
  const items = retrieve('En hoe zit het met zakelijke kosten?', []);
  assert.equal(items[0]?.id, 'zakelijke-versus-prive-kosten');
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.ok(!answer.explanation.includes('voorbelasting'), 'de volledige btw-voorbelasting-uitleg mag niet in het zakelijke-kosten-antwoord verschijnen');
});

test('Scenario I: "Kan ik de btw daarop terugvragen?" (na zakelijke kosten) -> btw/voorbelasting-item, fiscale winstaftrek en btw-aftrek blijven gescheiden', () => {
  const items = retrieve('Kan ik de btw daarop terugvragen?', ['En hoe zit het met zakelijke kosten?']);
  assert.ok(['btw-terugvragen-voorbelasting', 'btw-zakelijke-kosten-en-diensten'].includes(items[0]?.id), `verwacht een btw-item als primaire bron, kreeg "${items[0]?.id}"`);
  const answer = buildSourceFallbackAnswer(toSources(items));
  assert.ok(!answer.explanation.includes('verlagen doorgaans de fiscale winst'), 'de fiscale-winstaftrek-uitleg (IB/vpb) mag niet in het btw-antwoord terechtkomen');
});

// ---------------------------------------------------------------------
// Structurele bevestiging: de fix zit in fallback-answer.mjs, niet in een
// aanpassing van de retrieval-architectuur of het aantal opgehaalde bronnen
// (MAX_KNOWLEDGE_SOURCES blijft ongewijzigd — dat is bewuste, elders
// getestte architectuur die deze ronde niet aangeraakt wordt).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = path.resolve(__dirname, '../../src/lib/fallback-answer.mjs');

test('buildSourceFallbackAnswer gebruikt structureel nog maar sources[0] (de primaire bron) — geen top.slice(1)-concatenatie meer', () => {
  const text = readFileSync(FALLBACK_FILE, 'utf-8');
  assert.match(text, /const primary = sources\[0\]/);
  assert.ok(!text.includes('top.slice(1)'), 'de oude multi-bron-concatenatie (top.slice(1)) hoort niet meer in fallback-answer.mjs voor te komen');
});
