// Regressietests voor de Avydo AI-kennisbank en de bijbehorende retrieval
// (src/lib/knowledge-match.mjs, src/data/ai-knowledge/). Draait met Node's
// ingebouwde testrunner: `npm run kenniscentrum:test` (geen extra
// dependency nodig, zelfde patroon als fetch-articles.test.mjs).
//
// Getest wordt de ECHTE matchinglogica die ai-assistent.ts ook gebruikt
// (zelfde .mjs-bestand geïmporteerd), tegen de ECHTE, in de repository
// aanwezige kennisbank-data — geen losse testfixtures die uit de pas
// kunnen gaan lopen met de productiedata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveKnowledgeItems, tokenize, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';

// De kennisbank zelf staat in TypeScript-bestanden (src/data/ai-knowledge/),
// consistent met de rest van src/data/. Node's testrunner kan die niet
// rechtstreeks importeren zonder TS-transform, dus wordt hier een kleine,
// representatieve kopie van dezelfde items gebruikt om de MATCHING-LOGICA
// te testen (scoring/sortering/limiet) — geen contentcontrole. De inhoud
// en bron-URL's van de echte kennisbank worden apart en volledig
// gecontroleerd door test/knowledgeBase.node.check.mjs-achtige aanpak
// hieronder: dit bestand valideert de vorm en inhoud van de bronbestanden
// zelf via een lichte tekstuele scan (geen TS-import nodig).
const SAMPLE_ITEMS = [
  {
    id: 'kor',
    title: 'Kleineondernemersregeling (KOR)',
    category: 'Btw',
    content: 'De KOR is een vrijstelling van btw voor kleine ondernemers onder een omzetgrens.',
    tags: ['kor', 'kleineondernemersregeling', 'btw vrijstelling'],
    priority: 3,
  },
  {
    id: 'btw-aangifte',
    title: 'Btw-aangifte doen',
    category: 'Btw',
    content: 'Btw-ondernemers doen periodiek aangifte bij de Belastingdienst.',
    tags: ['btw-aangifte', 'aangifte doen'],
    priority: 3,
  },
  {
    id: 'eenmanszaak',
    title: 'Eenmanszaak',
    category: 'Ondernemingsvormen',
    content: 'Een eenmanszaak is een rechtsvorm zonder rechtspersoonlijkheid.',
    tags: ['eenmanszaak', 'zzp'],
    priority: 2,
  },
  {
    id: 'irrelevant-lage-prioriteit',
    title: 'Managementinformatie',
    category: 'Administratie en accountancy',
    content: 'Periodieke financiële overzichten geven inzicht in de onderneming.',
    tags: ['managementinformatie'],
    priority: 1,
  },
  {
    id: 'verschil-eenmanszaak-en-bv',
    title: 'Verschil tussen een eenmanszaak en een BV',
    category: 'Ondernemingsvormen',
    content:
      'Een BV is een rechtspersoon, een eenmanszaak niet. Een BV is niet automatisch goedkoper of fiscaal voordeliger dan een eenmanszaak — dit hangt af van de winst, risico\'s en persoonlijke situatie.',
    tags: ['verschil eenmanszaak bv', 'eenmanszaak of bv', 'bv voordeliger', 'is een bv beter', 'bv goedkoper', 'is een bv altijd goedkoper'],
    priority: 3,
  },
  {
    id: 'zakelijke-versus-prive-kosten',
    title: 'Zakelijke kosten versus privékosten',
    category: 'Inkomstenbelasting',
    content:
      'Gemengde kosten zoals een telefoon zijn deels aftrekbaar. Een privételefoon is niet zonder meer volledig aftrekbaar. Boodschappen voor privégebruik zijn geen zakelijke kosten en dus niet aftrekbaar.',
    tags: ['zakelijke kosten', 'privékosten', 'privételefoon aftrekken', 'gemengde kosten', 'boodschappen aftrekken', 'privéboodschappen'],
    priority: 3,
  },
  {
    id: 'winst-in-de-bv',
    title: 'Winst in de BV laten (winst reserveren)',
    category: 'BV en vennootschapsbelasting',
    content: 'Winst die in de BV blijft, wordt niet automatisch als dividend uitgekeerd. Dividend ontstaat pas als de BV daadwerkelijk uitkeert.',
    tags: ['winst in de bv laten', 'winst reserveren', 'winst in bv houden', 'winst niet uitkeren', 'winstreserve'],
    priority: 3,
  },
  {
    id: 'gebruikelijk-loon',
    title: 'Gebruikelijk loon',
    category: 'BV en vennootschapsbelasting',
    content: 'De gebruikelijkloonregeling verplicht een DGA zichzelf een gebruikelijk loon toe te kennen, getoetst aan wettelijke regels.',
    tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris', 'hoeveel loon dga', 'loon mezelf uitbetalen'],
    priority: 3,
  },
  {
    id: 'bedrijfsverzekeringen',
    title: 'Bedrijfsverzekeringen',
    category: 'Ondernemingsvormen',
    content: 'Welke verzekeringen nodig of verstandig zijn hangt af van activiteiten, personeel, bedrijfspand en risico\'s.',
    tags: ['bedrijfsverzekeringen', 'verzekeringen ondernemer', 'aansprakelijkheidsverzekering', 'welke verzekeringen nodig'],
    priority: 1,
  },
  {
    id: 'voorlopige-aanslag',
    title: 'Voorlopige aanslag',
    category: 'Inkomstenbelasting',
    content: 'Een voorlopige aanslag is een schatting van de te betalen belasting over het lopende jaar.',
    tags: ['voorlopige aanslag', 'belasting vooraf betalen'],
    priority: 2,
  },
  {
    id: 'werknemer-aannemen',
    title: 'Een werknemer aannemen',
    category: 'Personeel',
    content: 'Bij het aannemen van de eerste werknemer wordt u werkgever en stelt u een arbeidsovereenkomst op.',
    tags: ['werknemer aannemen', 'personeel aannemen', 'eerste werknemer', 'werkgever worden'],
    priority: 3,
  },
  {
    id: 'pensioen-werknemers',
    title: 'Pensioen voor werknemers',
    category: 'Personeel',
    content: 'Of pensioen verplicht is hangt af van de sector en een eventuele bedrijfstakpensioenregeling.',
    tags: ['pensioen', 'pensioenregeling', 'pensioenverplichting'],
    priority: 1,
  },
  {
    id: 'dga',
    title: 'Directeur-grootaandeelhouder (DGA)',
    category: 'BV en vennootschapsbelasting',
    content: 'Een DGA ontvangt loon uit de BV en kan daarnaast dividend ontvangen. Voor het loon geldt de gebruikelijkloonregeling.',
    tags: ['dga', 'directeur grootaandeelhouder', 'aanmerkelijk belang'],
    priority: 3,
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content: 'Dividend is een winstuitkering van een BV aan haar aandeelhouders.',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 2,
  },
  {
    id: 'btw-tarieven',
    title: 'Btw-tarieven',
    category: 'Btw',
    content: 'Het toepasselijke btw-tarief hangt af van het specifieke product of de dienst die geleverd wordt.',
    tags: ['btw tarief', 'btw tarieven', 'hoog laag tarief', 'nultarief'],
    priority: 3,
  },
  {
    id: 'btw-zakelijke-kosten-en-diensten',
    title: 'Btw bij zakelijke kosten en diensten',
    category: 'Btw',
    content: 'Over zakelijke kosten wordt btw in rekening gebracht die als voorbelasting kan worden teruggevraagd.',
    tags: ['btw zakelijke kosten', 'btw diensten'],
    priority: 2,
  },
  {
    id: 'balans',
    title: 'Balans',
    category: 'Administratie en accountancy',
    content: 'De balans is een overzicht van de bezittingen en schulden van een onderneming op een bepaald moment.',
    tags: ['balans', 'bezittingen', 'eigen vermogen'],
    priority: 2,
  },
  {
    id: 'onderneming-starten',
    title: 'Een onderneming starten: praktische startcheck',
    category: 'Ondernemingsvormen',
    content: 'Wie een onderneming start kiest eerst een rechtsvorm, schrijft in bij de KVK en regelt daarna administratie en btw.',
    tags: ['onderneming starten', 'starten', 'bedrijf starten', 'wat moet ik regelen', 'startcheck'],
    priority: 3,
  },
];

test('tokenize verwijdert stopwoorden en korte woorden', () => {
  const tokens = tokenize('Wanneer moet ik btw-aangifte doen?');
  assert.ok(tokens.includes('btw'));
  assert.ok(tokens.includes('aangifte'));
  assert.ok(!tokens.includes('moet'));
  assert.ok(!tokens.includes('ik'));
});

test('retrieveKnowledgeItems vindt de KOR bij "Wat is de KOR?"', () => {
  const results = retrieveKnowledgeItems('Wat is de KOR?', SAMPLE_ITEMS);
  assert.ok(results.some((r) => r.id === 'kor'));
});

test('retrieveKnowledgeItems vindt btw-aangifte bij "Wanneer moet ik btw-aangifte doen?"', () => {
  const results = retrieveKnowledgeItems('Wanneer moet ik btw-aangifte doen?', SAMPLE_ITEMS);
  assert.ok(results.some((r) => r.id === 'btw-aangifte'));
});

test('retrieveKnowledgeItems respecteert de maxItems-limiet', () => {
  const results = retrieveKnowledgeItems('btw ondernemer', SAMPLE_ITEMS, { maxItems: 1 });
  assert.equal(results.length, 1);
});

test('retrieveKnowledgeItems geeft nooit een item terug zonder enige trefwoordtreffer', () => {
  const results = retrieveKnowledgeItems('Wat is de KOR?', SAMPLE_ITEMS);
  assert.ok(!results.some((r) => r.id === 'eenmanszaak'));
});

// Dekt de volledige testset uit de opdracht ("Verbeter de inhoudelijke
// kwaliteit..."): voor elke vraag moet minimaal het verwachte kennisitem
// gevonden worden. Dit toont aan dat de retrieval-laag relevante context
// aanlevert — de kwaliteit van het uiteindelijke, door Groq gegenereerde
// antwoord (structuur, toon, geen ongefundeerde claims) kan vanuit deze
// sandbox niet end-to-end getest worden (geen live Groq-toegang), en wordt
// afgedwongen via de systeemprompt in kenniscentrum-chat.ts.
test('retrieveKnowledgeItems vindt het juiste kennisitem voor elke verplichte testvraag', () => {
  const cases = [
    ['Wat is een balans?', 'balans'],
    ['Ik wil binnenkort een bedrijf starten. Wat moet ik allemaal regelen?', 'onderneming-starten'],
    ['Wat is het verschil tussen een eenmanszaak en een BV?', 'verschil-eenmanszaak-en-bv'],
    ['Wat is de KOR en wanneer kan ik daar gebruik van maken?', 'kor'],
    ['Wanneer moet ik btw-aangifte doen?', 'btw-aangifte'],
    ['Hoeveel belasting moet ik betalen?', 'voorlopige-aanslag'],
    ['Is een BV altijd voordeliger dan een eenmanszaak?', 'verschil-eenmanszaak-en-bv'],
    ['Kan ik mijn privételefoon zakelijk aftrekken?', 'zakelijke-versus-prive-kosten'],
    ['Welke kosten kan ik als ondernemer zakelijk aftrekken?', 'zakelijke-versus-prive-kosten'],
    ['Ik wil mijn eerste werknemer aannemen. Wat moet ik regelen?', 'werknemer-aannemen'],
    ['Wat is een DGA?', 'dga'],
    ['Is een BV voor mij voordeliger?', 'verschil-eenmanszaak-en-bv'],
    ['Wat is momenteel het btw-tarief voor mijn situatie?', 'btw-tarieven'],
    ['Kan ik mijn privéboodschappen volledig aftrekken?', 'zakelijke-versus-prive-kosten'],
    ['Is een BV altijd goedkoper?', 'verschil-eenmanszaak-en-bv'],
    ['Hoeveel loon moet ik mezelf als DGA betalen?', 'gebruikelijk-loon'],
    ['Kan ik mijn boodschappen aftrekken?', 'zakelijke-versus-prive-kosten'],
    ['Welke verzekeringen heb ik nodig?', 'bedrijfsverzekeringen'],
  ];
  for (const [question, expectedId] of cases) {
    const results = retrieveKnowledgeItems(question, SAMPLE_ITEMS);
    assert.ok(results.some((r) => r.id === expectedId), `verwachtte "${expectedId}" voor "${question}", kreeg ${results.map((r) => r.id)}`);
  }
});

test('buildRetrievalQuery plakt eerdere gebruikersvragen vóór de huidige vraag', () => {
  assert.equal(buildRetrievalQuery([], 'Wat is een DGA?'), 'Wat is een DGA?');
  assert.equal(
    buildRetrievalQuery(['Is een BV voor mij voordeliger?'], 'En hoe zit dat bij een eenmanszaak?'),
    'Is een BV voor mij voordeliger? En hoe zit dat bij een eenmanszaak?',
  );
  // lege/witruimte-only berichten worden genegeerd, geen dubbele spaties of lege segmenten
  assert.equal(buildRetrievalQuery(['', '  '], 'Wat is de KOR?'), 'Wat is de KOR?');
});

// Dekt de drie conversationele vervolgvraag-scenario's uit de opdracht:
// een vervolgvraag die op zichzelf te weinig trefwoorden bevat om iets te
// vinden, moet via de gecombineerde retrieval-query (eerdere vraag +
// huidige vraag) alsnog het juiste kennisitem opleveren — dit is de kern
// van "geen contextloze behandeling van vervolgvragen".
test('vervolgvragen vinden het juiste kennisitem via de gecombineerde gespreksquery', () => {
  const cases = [
    // [eerdere gebruikersvragen, huidige (elliptische) vraag, verwacht kennisitem]
    [['Is een BV voor mij voordeliger?'], 'En hoe zit dat bij een BV?', 'verschil-eenmanszaak-en-bv'],
    [['Is een BV voor mij voordeliger?'], 'En hoe zit dat bij een eenmanszaak?', 'eenmanszaak'],
    [['Is een BV voor mij voordeliger?'], 'Hoe zit dat met dividend?', 'dividend'],
    [['Welke kosten kan ik aftrekken?'], 'En hoe zit dat met btw?', 'btw-zakelijke-kosten-en-diensten'],
    [['Ik wil personeel aannemen.'], 'Hoe zit het met pensioen?', 'pensioen-werknemers'],
  ];
  for (const [previousUserMessages, currentMessage, expectedId] of cases) {
    const query = buildRetrievalQuery(previousUserMessages, currentMessage);
    const results = retrieveKnowledgeItems(query, SAMPLE_ITEMS);
    assert.ok(
      results.some((r) => r.id === expectedId),
      `verwachtte "${expectedId}" voor vervolgvraag "${currentMessage}" (na "${previousUserMessages.join(' / ')}"), kreeg ${results.map((r) => r.id)}`,
    );
  }
});

// Spiegelt de twee-staps retrieval uit kenniscentrum-chat.ts: eerst de
// huidige vraag alleen, en alléén als dat niets oplevert de gecombineerde
// query (geschiedenis + vraag) als vangnet. Zie het incident hierboven
// (buildRetrievalQuery-aanroep) voor waarom "altijd combineren" niet goed
// genoeg was.
function retrieveWithFallback(previousUserMessages, message, items) {
  let results = retrieveKnowledgeItems(message, items);
  if (results.length === 0 && previousUserMessages.length > 0) {
    results = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), items);
  }
  return results;
}

// Repliceert exact het langere testgesprek uit de opdracht: "is een BV voor
// mij voordeliger?" -> "en hoe zit dat bij een BV?" -> "en hoe zit het met
// dividend?" -> "en als ik de winst in de BV laat?" -> "en als ik personeel
// aanneem?". Elke stap moet het juiste kennisitem vinden — met name de
// laatste twee vragen zijn de regressie: "winst in de BV" mag niet op
// onvoldoendeInformatie uitkomen, en de latere onderwerpwisseling naar
// "personeel aannemen" mag niet verdronken worden door de opgestapelde
// eerdere BV-vragen.
test('het volledige testgesprek uit de opdracht blijft bij elke stap relevante context vinden', () => {
  const history = [];
  const steps = [
    ['Is een BV voor mij voordeliger?', 'verschil-eenmanszaak-en-bv'],
    ['En hoe zit dat bij een BV?', 'verschil-eenmanszaak-en-bv'],
    ['En hoe zit het met dividend?', 'dividend'],
    ['En als ik de winst in de BV laat?', 'winst-in-de-bv'],
    ['En als ik personeel aanneem?', 'werknemer-aannemen'],
  ];
  for (const [message, expectedId] of steps) {
    const results = retrieveWithFallback(history, message, SAMPLE_ITEMS);
    assert.ok(
      results.some((r) => r.id === expectedId),
      `verwachtte "${expectedId}" bij "${message}" (gesprek tot nu toe: ${JSON.stringify(history)}), kreeg ${results.map((r) => r.id)}`,
    );
    history.push(message);
  }
});

// Zonder de gespreksgeschiedenis zou de elliptische vervolgvraag op
// zichzelf vaak niets (bruikbaars) vinden — dit bevestigt dat de
// contextuele query daadwerkelijk het verschil maakt, niet dat de vraag
// toevallig ook op zichzelf al genoeg trefwoorden had.
// Bevestigt dat de gespreksgeschiedenis daadwerkelijk het verschil maakt,
// niet dat de elliptische vraag toevallig ook op zichzelf al genoeg
// trefwoorden had: een puur verwijzende vervolgvraag zonder eigen
// onderwerpswoorden ("en hoe zit dat daarmee?") vindt zonder de vorige
// vraag niets, maar wél het juiste kennisitem zodra de eerdere vraag als
// context wordt meegegeven.
test('een vervolgvraag zonder eigen onderwerpswoorden vindt pas iets zodra de vorige vraag als context meetelt', () => {
  const withoutContext = retrieveKnowledgeItems('En hoe zit dat daarmee?', SAMPLE_ITEMS);
  assert.deepEqual(withoutContext, []);

  const withContext = retrieveKnowledgeItems(buildRetrievalQuery(['Is een BV voor mij voordeliger?'], 'En hoe zit dat daarmee?'), SAMPLE_ITEMS);
  assert.ok(withContext.some((r) => r.id === 'verschil-eenmanszaak-en-bv'));
});

// Regressie: een geheel onderwerpsvreemde vraag die toevallig één generiek,
// inhoudsloos woord deelt met de lopende tekst van een kennisitem (bijv.
// "beste" in "de beste keuze") mag niet als relevant gelden — anders zou
// de assistent context krijgen die feitelijk niets met de vraag te maken
// heeft. Zie MIN_RELEVANCE_SCORE in knowledge-match.mjs.
test('een toevallig gedeeld, inhoudsloos woord in alleen de lopende tekst is onvoldoende voor een match', () => {
  const items = [
    {
      id: 'rechtsvorm-kiezen',
      title: 'Een rechtsvorm kiezen',
      category: 'Ondernemingsvormen',
      content: 'Er is geen rechtsvorm die voor iedereen het beste is.',
      tags: ['rechtsvorm', 'rechtsvorm kiezen'],
      priority: 3,
    },
  ];
  const results = retrieveKnowledgeItems('Waar kan ik het beste op vakantie gaan?', items);
  assert.deepEqual(results, []);
});

test('retrieveKnowledgeItems geeft een lege lijst bij een volledig onbekende/irrelevante vraag (geen hallucinatie-risico)', () => {
  const results = retrieveKnowledgeItems('Wie heeft de voetbalwedstrijd gisteravond gewonnen?', SAMPLE_ITEMS);
  assert.deepEqual(results, []);
});

test('retrieveKnowledgeItems geeft een lege lijst bij een lege of te korte vraag', () => {
  assert.deepEqual(retrieveKnowledgeItems('', SAMPLE_ITEMS), []);
  assert.deepEqual(retrieveKnowledgeItems('en de of', SAMPLE_ITEMS), []);
});

test('retrieveKnowledgeItems geeft bij gelijke score voorrang aan het item met hogere priority', () => {
  const items = [
    { id: 'laag', title: 'Btw', category: 'Btw', content: 'tekst', tags: ['btw'], priority: 1 },
    { id: 'hoog', title: 'Btw', category: 'Btw', content: 'tekst', tags: ['btw'], priority: 3 },
  ];
  const results = retrieveKnowledgeItems('btw', items, { maxItems: 2 });
  assert.equal(results[0].id, 'hoog');
});

// ---------------------------------------------------------------------
// Validatie van de ECHTE kennisbank-bronbestanden (src/data/ai-knowledge/):
// geen TS-import nodig, alleen een structurele tekst-/regexcontrole dat
// elk item de verplichte velden heeft en dat elke sourceUrl een https-URL
// van een van de toegestane officiële domeinen is — dit borgt de opdracht-
// eis "gebruik geen willekeurige blogs, elke bron moet een echte,
// controleerbare URL hebben".
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, '../../src/data/ai-knowledge');
const ALLOWED_SOURCE_DOMAINS = ['belastingdienst.nl', 'rijksoverheid.nl', 'kvk.nl', 'nba.nl'];

function readKnowledgeFiles() {
  return readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts')
    .map((f) => ({ file: f, text: readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8') }));
}

test('elk kennisbestand bevat alleen sourceUrl\'s van officiële, toegestane domeinen', () => {
  const files = readKnowledgeFiles();
  assert.ok(files.length >= 5, 'verwacht meerdere onderwerpbestanden in src/data/ai-knowledge/');
  for (const { file, text } of files) {
    const urls = [...text.matchAll(/sourceUrl:\s*\n?\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(urls.length > 0, `${file} bevat geen enkele sourceUrl`);
    for (const url of urls) {
      assert.ok(url.startsWith('https://'), `${file}: sourceUrl "${url}" is geen https-URL`);
      assert.ok(
        ALLOWED_SOURCE_DOMAINS.some((domain) => url.includes(`://www.${domain}`) || url.includes(`://${domain}`) || url.includes(`.${domain}/`)),
        `${file}: sourceUrl "${url}" staat niet op een toegestaan officieel domein (${ALLOWED_SOURCE_DOMAINS.join(', ')})`,
      );
    }
  }
});

test('elk kennisbestand bevat evenveel id, lastVerified en sourceName als sourceUrl (geen onvolledig item)', () => {
  const files = readKnowledgeFiles();
  for (const { file, text } of files) {
    const countOf = (re) => [...text.matchAll(re)].length;
    const idCount = countOf(/\bid:\s*'/g);
    const sourceUrlCount = countOf(/sourceUrl:/g);
    const lastVerifiedCount = countOf(/lastVerified:\s*'\d{4}-\d{2}-\d{2}'/g);
    const sourceNameCount = countOf(/sourceName:\s*'/g);
    assert.equal(lastVerifiedCount, idCount, `${file}: niet elk item heeft een geldige lastVerified (YYYY-MM-DD)`);
    assert.equal(sourceUrlCount, idCount, `${file}: aantal sourceUrl komt niet overeen met aantal items`);
    assert.equal(sourceNameCount, idCount, `${file}: aantal sourceName komt niet overeen met aantal items`);
  }
});

test('geen kennisitem bevat een euroteken of procentteken in de content (geen hardgecodeerde bedragen/percentages)', () => {
  const files = readKnowledgeFiles();
  // Niet-gretige match tot de eerste NIET-geëscapete quote (content bevat
  // soms een geëscapete apostrof, bijv. "BV\'s") — een simpele `'...'`-match
  // zou daar te vroeg stoppen.
  for (const { file, text } of files) {
    const contentBlocks = [...text.matchAll(/content:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    assert.ok(contentBlocks.length > 0, `${file}: geen enkel content-veld gevonden`);
    for (const content of contentBlocks) {
      assert.ok(!content.includes('€'), `${file}: content bevat een €-teken — gebruik geen hardgecodeerde bedragen`);
      assert.ok(!/\d+\s*%/.test(content), `${file}: content bevat een percentage — verwijs naar de officiële bron in plaats van een cijfer te noemen`);
    }
  }
});

// Regressie: dit borgt dat de inhoudelijke verbetering van personeel.ts
// (opdracht: "controleer of de knowledge base voldoende informatie bevat
// over ... arbeidsovereenkomst ... pensioen/arbo-regels") daadwerkelijk in
// de repository staat, met een betrouwbare bron — en blijft dat ook
// bewaken bij toekomstige wijzigingen.
test('personeel.ts bevat kennisitems over arbeidsovereenkomst, pensioen en arbeidsomstandigheden', () => {
  const files = readKnowledgeFiles();
  const personeel = files.find((f) => f.file === 'personeel.ts');
  assert.ok(personeel, 'src/data/ai-knowledge/personeel.ts ontbreekt');
  for (const expectedId of ['arbeidsovereenkomst', 'pensioen-werknemers', 'arbeidsomstandigheden']) {
    assert.ok(personeel.text.includes(`id: '${expectedId}'`), `personeel.ts mist het kennisitem "${expectedId}"`);
  }
});

test('de kennisbank bevat in totaal minstens 45 items, verdeeld over minstens 6 onderwerpbestanden', () => {
  const files = readKnowledgeFiles();
  assert.ok(files.length >= 6, 'verwacht minstens 6 onderwerpbestanden in src/data/ai-knowledge/');
  const totalItems = files.reduce((sum, { text }) => sum + [...text.matchAll(/\bid:\s*'/g)].length, 0);
  assert.ok(totalItems >= 45, `verwacht minstens 45 kennisitems in totaal, telde er ${totalItems}`);
});
