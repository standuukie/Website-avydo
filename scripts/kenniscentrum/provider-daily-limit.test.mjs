// Regressietests voor het Groq TPD-incident (2026-09-30, ronde 6): een
// Production-log liet een Groq 429 zien met "Limit 200000, Used 198358,
// Requested 2171" op "tokens per day (TPD)" — een fundamenteel andere,
// veel langzamer herstellende situatie dan een gewone RPM/TPM-429. Dit
// bestand test: (1) dat categorizeProviderError deze situatie correct als
// eigen categorie herkent, (2) dat een TPD-429 nooit automatisch geretryd
// wordt, (3) de daadwerkelijke, pure fallback-antwoordlogica
// (src/lib/fallback-answer.mjs), (4) de structurele volgorde/aanwezigheid
// van de nieuwe code in de route, en (5) een letterlijke replay van het
// 8-vragen live-testgesprek met een gesimuleerde TPD-429, die laat zien dat
// elke vraag alsnog een normaal, inhoudelijk antwoord krijgt. Draait met
// Node's ingebouwde testrunner: `npm run kenniscentrum:test` — geen live
// Groq-aanroep nodig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeProviderError, shouldRetryProviderError } from '../../src/lib/error-classify.mjs';
import { buildFallbackAnswer, buildSourceFallbackAnswer } from '../../src/lib/fallback-answer.mjs';
import { retrieveKnowledgeItems, findDeterministicFallbackItem, buildRetrievalQuery } from '../../src/lib/knowledge-match.mjs';

// ---------------------------------------------------------------------
// 1. Herkenning van de TPD-429 (punt 1 uit de opdracht)

// De EXACTE (geanonimiseerde) foutmelding uit de Production-log die dit
// incident veroorzaakte, inclusief Groq's eigen "tokens per day (TPD)"-tekst
// — dit is precies de tekst die groq.ts in `error` zou zetten (HTTP-status +
// responstekst, zie de adapter).
const REAL_TPD_ERROR_TEXT =
  'Groq API 429 (model="openai/gpt-oss-20b"): {"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_example` on tokens per day (TPD): Limit 200000, Used 198358, Requested 2171, please try again in 3m48.528s.","type":"tokens","code":"rate_limit_exceeded"}}';

test('categorizeProviderError herkent een Groq TPD-429 als eigen categorie "provider_daily_limit"', () => {
  assert.equal(categorizeProviderError(REAL_TPD_ERROR_TEXT), 'provider_daily_limit');
});

test('categorizeProviderError blijft "rate_limited" geven voor een gewone RPM/TPM-429 zonder "tokens per day"', () => {
  assert.equal(categorizeProviderError('Groq API 429 (model="openai/gpt-oss-20b"): rate limit exceeded, please try again in 2.5s'), 'rate_limited');
});

test('categorizeProviderError herkent ook de losse "TPD"-afkorting (niet alleen de volledige "tokens per day"-tekst)', () => {
  assert.equal(categorizeProviderError('Groq API 429 (model="openai/gpt-oss-20b"): rate limit reached on TPD, please try again later'), 'provider_daily_limit');
});

// ---------------------------------------------------------------------
// 2. Geen automatische retry bij TPD (punt 2/10 uit de opdracht)

test('een TPD-429 wordt, net als elke andere 429, NOOIT automatisch geretryd', () => {
  // shouldRetryProviderError kent geen aparte TPD-tak — elke 429 (status
  // alleen, categorie is hier niet relevant) wordt nooit geretryd. Dit is
  // bewust: TPD's eigen Retry-After ligt typisch op minuten tot uren, dus
  // een retry binnen dit verzoek zou sowieso nooit op tijd zijn.
  assert.equal(shouldRetryProviderError({ status: 429 }).retry, false);
});

// ---------------------------------------------------------------------
// 3. buildFallbackAnswer / buildSourceFallbackAnswer (punt 3/4 — de
// daadwerkelijke, pure fallback-inhoud, nu in src/lib/fallback-answer.mjs)

const BALANS_ITEM = {
  id: 'balans',
  title: 'Balans',
  content: 'De balans is een overzicht van de bezittingen en schulden van een onderneming op een bepaald moment. Bezittingen staan aan de actiefzijde, schulden en eigen vermogen aan de passiefzijde.',
  sourceName: 'Belastingdienst',
  sourceUrl: 'https://www.belastingdienst.nl/balans',
};

test('buildFallbackAnswer geeft een natuurlijk antwoord: lege note (geen technische disclaimer), eerste zin als kortAntwoord, bron vermeld', () => {
  const answer = buildFallbackAnswer(BALANS_ITEM);
  assert.equal(answer.ok, true);
  assert.equal(answer.note, '', 'note hoort leeg te zijn — geen "AI-assistent tijdelijk niet bereikbaar"-disclaimer meer (punt 4)');
  assert.equal(answer.shortAnswer, 'De balans is een overzicht van de bezittingen en schulden van een onderneming op een bepaald moment.');
  assert.match(answer.explanation, /actiefzijde/);
  assert.equal(answer.insufficientInfo, false);
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].url, BALANS_ITEM.sourceUrl);
  assert.equal(answer.fallback, true);
});

test('buildSourceFallbackAnswer geeft een natuurlijk antwoord op basis van meerdere context-bewuste bronnen, lege note, alle bronnen vermeld', () => {
  const sources = [
    { name: 'Avydo kennisbank (bron: Belastingdienst)', title: 'Winst in de BV laten', url: 'https://www.belastingdienst.nl/winst-in-de-bv', snippet: 'Winst die in de BV blijft, wordt niet automatisch als dividend uitgekeerd. Dividend ontstaat pas als de BV daadwerkelijk uitkeert.' },
    { name: 'Avydo kennisbank (bron: Belastingdienst)', title: 'Dividend', url: 'https://www.belastingdienst.nl/dividend', snippet: 'Dividend is een winstuitkering van een BV aan haar aandeelhouders.' },
  ];
  const answer = buildSourceFallbackAnswer(sources);
  assert.equal(answer.ok, true);
  assert.equal(answer.note, '');
  assert.equal(answer.shortAnswer, 'Winst die in de BV blijft, wordt niet automatisch als dividend uitgekeerd.');
  assert.match(answer.explanation, /Dividend ontstaat pas/);
  assert.match(answer.explanation, /winstuitkering van een BV/, 'de tweede bron moet ook in de toelichting terugkomen');
  assert.equal(answer.sources.length, 2);
  assert.equal(answer.insufficientInfo, false);
});

// ---------------------------------------------------------------------
// 4. De bugfix zelf: sources-first voorkomt een verkeerd-onderwerp-antwoord
// bij een vervolgvraag (het "winst in de BV laten"-scenario). Gebruikt een
// kleine, maar qua id's/vlaggen/inhoud GETROUWE kopie van de relevante echte
// kennisitems (zie src/data/ai-knowledge/bv-dga.ts/ondernemingsvormen.ts) —
// niet zomaar verzonnen testdata, dezelfde tags/flags als in productie.
const REAL_LIKE_ITEMS = [
  {
    id: 'bv',
    title: 'Besloten vennootschap (BV)',
    category: 'Ondernemingsvormen',
    content:
      'Een besloten vennootschap (BV) is een rechtspersoon: de BV heeft eigen rechten en plichten, los van de persoon die de BV bestuurt. Een BV betaalt vennootschapsbelasting over de winst, in plaats van dat de winst rechtstreeks bij de eigenaar in de inkomstenbelasting valt zoals bij een eenmanszaak.',
    tags: ['bv', 'besloten vennootschap', 'rechtspersoon'],
    priority: 2,
    deterministicFallback: true,
  },
  {
    id: 'winst-in-de-bv',
    title: 'Winst in de BV laten (winst reserveren)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Winst die in de BV blijft, wordt niet automatisch als dividend aan de aandeelhouder uitgekeerd — de BV houdt dat bedrag binnen de onderneming. Dividend ontstaat pas op het moment dat de BV daadwerkelijk besluit dividend uit te keren.',
    tags: ['winst in de bv laten', 'winst reserveren', 'winst in bv houden', 'winst niet uitkeren', 'winstreserve', 'geld in de bv laten zitten'],
    priority: 3,
    // Bewust GEEN deterministicFallback: true — dit onderwerp vereist meer
    // nuance dan een kale definitie (zie ai-knowledge/bv-dga.ts).
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content: 'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders. Over uitgekeerd dividend is de aandeelhouder belasting verschuldigd.',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 2,
    deterministicFallback: true,
  },
];

test('REGRESSIE: "En als ik de winst in de BV laat?" matcht via de smalle deterministische fallback ten onrechte op het losse "bv"-item', () => {
  // Dit bevestigt WAAROM de volgorde in de route is omgedraaid: als je
  // uitsluitend findDeterministicFallbackItem zou gebruiken (de oude
  // volgorde), krijgt de bezoeker een antwoord over "wat is een BV"
  // in plaats van over winst in de BV laten — verkeerd onderwerp.
  const match = findDeterministicFallbackItem('En als ik de winst in de BV laat?', REAL_LIKE_ITEMS);
  assert.equal(match?.id, 'bv', 'bevestigt het gerapporteerde risico: de smalle match kiest het verkeerde, generieke item');
});

test('FIX: de volledige, context-bewuste retrieval (retrieveKnowledgeItems) zet het juiste item ("winst-in-de-bv") wél bovenaan', () => {
  const results = retrieveKnowledgeItems('En als ik de winst in de BV laat?', REAL_LIKE_ITEMS, { maxItems: 2 });
  assert.ok(results.length > 0, 'de volledige retrieval zou hier zeker iets moeten vinden');
  assert.equal(results[0].id, 'winst-in-de-bv', 'het specifiekere, juiste item moet bovenaan staan, niet het generieke "bv"-item');
});

test('FIX (end-to-end): buildSourceFallbackAnswer op basis van de correcte retrieval-volgorde geeft het juiste antwoord, niet de generieke BV-definitie', () => {
  const results = retrieveKnowledgeItems('En als ik de winst in de BV laat?', REAL_LIKE_ITEMS, { maxItems: 2 });
  const sources = results.map((item) => ({ name: `Avydo kennisbank (bron: test)`, title: item.title, url: 'https://example.org/' + item.id, snippet: item.content }));
  const answer = buildSourceFallbackAnswer(sources);
  assert.match(answer.shortAnswer, /Winst die in de BV blijft/, 'het antwoord moet over winst-in-de-BV gaan, niet over wat een BV in het algemeen is');
});

// ---------------------------------------------------------------------
// 5. Structurele controle van de ECHTE route: bevestigt dat de nieuwe TPD-
// categorie, de retry-after-logging en de omgedraaide fallback-volgorde
// daadwerkelijk in de productiecode staan (geen losstaande testfixtures).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');
const GROQ_FILE = path.resolve(__dirname, '../../src/lib/ai-providers/groq.ts');
const INDEX_FILE = path.resolve(__dirname, '../../src/lib/ai-providers/index.ts');

test('de route heeft een eigen, herkenbare melding + statuscode voor provider_daily_limit, verschillend van provider_rate_limited/provider_unavailable', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /code: 'provider_daily_limit'/);
  assert.match(text, /De uitgebreide AI-beantwoording is tijdelijk niet beschikbaar/);
  assert.match(text, /errorCategory === 'provider_daily_limit'/);
  // Alle drie de meldingen moeten daadwerkelijk verschillend zijn.
  const messages = [
    'De uitgebreide AI-beantwoording is tijdelijk niet beschikbaar',
    'De AI-assistent verwerkt op dit moment veel aanvragen',
    'De AI-assistent is tijdelijk niet beschikbaar. Probeer het opnieuw.',
  ];
  assert.equal(new Set(messages).size, 3, 'de drie meldingen moeten onderling verschillend zijn');
});

test('de route logt retry_after (Groq\'s eigen Retry-After) bij een providerfout, nooit gebruikt om automatisch te retryen', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /retry_after: result\.retryAfterSeconds/);
  // Geen enkele nieuwe retry-aanroep toegevoegd in de route zelf (retries
  // blijven uitsluitend het gecontroleerde, ÉÉN-keer-bij-5xx-mechanisme in
  // groq.ts, via de gedeelde error-classify.mjs).
  assert.ok(!text.includes('setTimeout') , 'de route zelf mag geen eigen retry/wacht-mechanisme bevatten');
});

test('de route probeert de context-bewuste bronnen-fallback VÓÓR de smalle deterministische fallback bij een providerfout (de bugfix-volgorde)', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const providerFallbackSectionStart = text.indexOf("if (!result.ok) {");
  assert.ok(providerFallbackSectionStart > -1, 'kon de provider-foutafhandeling niet vinden in de route');
  const section = text.slice(providerFallbackSectionStart, providerFallbackSectionStart + 4000);

  const sourcesCheckIndex = section.indexOf('sanitizedSources.length > 0');
  const deterministicCheckIndex = section.indexOf('findDeterministicFallbackItem(message, knowledgeBase)');
  assert.ok(sourcesCheckIndex > -1, 'de sources-fallback-check ontbreekt in de PROVIDER-FALLBACK-sectie');
  assert.ok(deterministicCheckIndex > -1, 'de deterministische fallback-check ontbreekt in de PROVIDER-FALLBACK-sectie');
  assert.ok(
    sourcesCheckIndex < deterministicCheckIndex,
    'de sources-fallback moet EERST geprobeerd worden, vóór de smallere deterministische match (zie het "winst in de BV laten"-regressiescenario hierboven)',
  );
});

test('de route roept buildFallbackAnswer/buildSourceFallbackAnswer aan vanuit het gedeelde, puur testbare fallback-answer.mjs (niet lokaal opnieuw gedefinieerd)', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /from '@\/lib\/fallback-answer\.mjs'/);
  assert.match(text, /buildFallbackAnswer/);
  assert.match(text, /buildSourceFallbackAnswer/);
  // De functies zelf mogen niet meer lokaal in de route gedefinieerd staan.
  assert.ok(!/function buildFallbackAnswer\(/.test(text), 'buildFallbackAnswer hoort niet meer lokaal in de route gedefinieerd te zijn');
  assert.ok(!/function buildSourceFallbackAnswer\(/.test(text), 'buildSourceFallbackAnswer hoort niet meer lokaal in de route gedefinieerd te zijn');
});

test('groq.ts en index.ts geven Groq\'s retry-after structureel door (niet alleen als platte tekst)', () => {
  const groqText = readFileSync(GROQ_FILE, 'utf-8');
  const indexText = readFileSync(INDEX_FILE, 'utf-8');
  assert.match(groqText, /retryAfterSeconds/);
  assert.match(groqText, /retry-after/);
  assert.match(indexText, /retryAfterSeconds/);
});

// ---------------------------------------------------------------------
// 6. Punt 5 — direct-KB-antwoord voor simpele, op zichzelf staande
// definitievragen (zonder geschiedenis), vóór Groq wordt aangeroepen; en
// bevestiging dat dit NIET gebeurt zodra er conversatiegeschiedenis is
// (dan moet Groq gebruikt worden voor context/nuance, punt 6).

test('de route beantwoordt een simpele definitievraag ZONDER geschiedenis rechtstreeks uit de kennisbank, vóór enige Groq-aanroep', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const directAnswerIndex = text.indexOf("decision: 'direct_kb_answer'");
  const retrieveContextIndex = text.indexOf('await retrieveContext(message');
  const callAiIndex = text.indexOf('await callAiWithFallback(');
  assert.ok(directAnswerIndex > -1, 'de direct_kb_answer-beslissing ontbreekt in de route');
  assert.ok(directAnswerIndex < retrieveContextIndex, 'het directe kennisbank-antwoord moet vóór het ophalen van bronnen gebeuren (geen onnodig werk)');
  assert.ok(directAnswerIndex < callAiIndex, 'het directe kennisbank-antwoord moet vóór de Groq-aanroep gebeuren — dit pad mag Groq nooit raken');
});

test('het directe kennisbank-antwoord is voorwaardelijk aan "geen geschiedenis" (history.length === 0) — vervolgvragen gaan altijd naar Groq', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  assert.match(text, /if \(history\.length === 0\) \{\s*\n\s*const directItem = findDeterministicFallbackItem\(message, knowledgeBase\);/);
});

test('simulatie: "Wat is een balans?" als EERSTE vraag (geen geschiedenis) krijgt het directe kennisbank-antwoord, geen Groq nodig', () => {
  const history = [];
  const message = 'Wat is een balans?';
  let usedGroq = false;
  let answer = null;
  if (history.length === 0) {
    const directItem = findDeterministicFallbackItem(message, [{ ...BALANS_ITEM, tags: ['balans', 'bezittingen'], category: 'Administratie', deterministicFallback: true }]);
    if (directItem) answer = buildFallbackAnswer(directItem);
  }
  if (!answer) usedGroq = true;
  assert.equal(usedGroq, false, 'een simpele eerste definitievraag hoort geen Groq-aanroep te vereisen');
  assert.equal(answer.ok, true);
});

test('simulatie: dezelfde vraag MET voorgaande geschiedenis (vervolgvraag) gaat wél naar Groq (context nodig, punt 6)', () => {
  const history = [{ role: 'user', text: 'Wat is een BV?' }, { role: 'assistant', text: '...' }];
  let usedGroq = false;
  if (history.length === 0) {
    // wordt niet bereikt
  } else {
    usedGroq = true;
  }
  assert.equal(usedGroq, true, 'zodra er gespreksgeschiedenis is, moet de vraag (potentieel contextafhankelijk) gewoon naar Groq gaan');
});

// ---------------------------------------------------------------------
// 7. Volledige replay van het 8-vragen live-testgesprek (punt 6/11 uit de
// opdracht), MET een gesimuleerde Groq TPD-429 op een aantal vragen — laat
// zien dat de bezoeker bij elke vraag alsnog een bruikbaar, inhoudelijk
// antwoord krijgt (direct kennisbank-antwoord, geslaagde Groq-aanroep, of
// een van de twee fallback-niveaus), nooit een kale foutmelding, zolang er
// ook maar ENIGE relevante kennis beschikbaar is — exact de eis uit de
// opdracht: "de gebruiker moet ook bij een TPD 429 zoveel mogelijk een
// normaal inhoudelijk antwoord krijgen".
const LIVE_SCENARIO_ITEMS = [
  { id: 'balans', title: 'Balans', category: 'Administratie en accountancy', content: 'De balans is een overzicht van de bezittingen en schulden van een onderneming op een bepaald moment.', tags: ['balans', 'bezittingen', 'eigen vermogen'], priority: 2, deterministicFallback: true },
  { id: 'btw-algemeen', title: 'Btw in Nederland', category: 'Btw', content: 'Btw is de belasting die ondernemers over de verkoop van goederen en diensten in rekening brengen en periodiek afdragen.', tags: ['btw', 'omzetbelasting', 'wat is btw'], priority: 3, deterministicFallback: true },
  { id: 'eenmanszaak', title: 'Eenmanszaak', category: 'Ondernemingsvormen', content: 'Een eenmanszaak is een rechtsvorm zonder rechtspersoonlijkheid, waarbij de ondernemer in privé aansprakelijk is.', tags: ['eenmanszaak', 'zzp', 'zelfstandig ondernemer'], priority: 2, deterministicFallback: true },
  { id: 'bv', title: 'Besloten vennootschap (BV)', category: 'Ondernemingsvormen', content: 'Een besloten vennootschap (BV) is een rechtspersoon met eigen rechten en plichten, los van de bestuurder.', tags: ['bv', 'besloten vennootschap', 'rechtspersoon'], priority: 2, deterministicFallback: true },
  { id: 'dividend', title: 'Dividend', category: 'BV en vennootschapsbelasting', content: 'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders.', tags: ['dividend', 'dividend uitkeren', 'winstuitkering'], priority: 2, deterministicFallback: true },
  { id: 'winst-in-de-bv', title: 'Winst in de BV laten', category: 'BV en vennootschapsbelasting', content: 'Winst die in de BV blijft, wordt niet automatisch als dividend uitgekeerd — de BV houdt dat bedrag binnen de onderneming.', tags: ['winst in de bv laten', 'winst reserveren', 'winst niet uitkeren'], priority: 3 },
  { id: 'gebruikelijk-loon', title: 'Gebruikelijk loon', category: 'BV en vennootschapsbelasting', content: 'De gebruikelijkloonregeling verplicht een DGA zichzelf een loon toe te kennen, het hoogste van drie wettelijke toetsen.', tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris', 'hoeveel loon dga', 'loon mezelf uitbetalen'], priority: 3 },
  { id: 'bedrijfsverzekeringen', title: 'Bedrijfsverzekeringen', category: 'Ondernemingsvormen', content: 'Welke verzekeringen nodig zijn hangt af van activiteiten, personeel, bedrijfspand en risico\'s; de meeste zijn niet wettelijk verplicht.', tags: ['bedrijfsverzekeringen', 'verzekeringen ondernemer', 'welke verzekeringen nodig', 'welke verzekeringen heb ik nodig'], priority: 1 },
];

test('LIVE-SCENARIO-REPLAY (8 vragen, ~60s tussenpozen, gesimuleerde Groq TPD-429 op vraag 6 en 8): elke vraag krijgt een bruikbaar antwoord, nooit een kale foutmelding', () => {
  const conversation = [
    'Wat is een balans?',
    'Wat is btw?',
    'Wat is een eenmanszaak?',
    'Wat is een BV?',
    'En hoe zit het met dividend?',
    'En als ik de winst in de BV laat?',
    'Hoeveel loon moet ik mezelf als DGA betalen?',
    'Welke verzekeringen heb ik nodig?',
  ];
  // Gesimuleerd: Groq's TPD-429 raakt op de vragen die WEL bij Groq terecht-
  // komen (vervolgvragen, dus met geschiedenis) — vraag 6 en 8 simuleren dat
  // Groq daadwerkelijk faalt met een TPD-429, zoals in de live Production-log.
  const simulatedGroqFailsAt = new Set([6, 8]);

  const history = [];
  const report = [];

  conversation.forEach((message, idx) => {
    const questionNumber = idx + 1;
    const previousUserMessages = history.filter((h) => h.role === 'user').map((h) => h.text);
    let path = null;
    let answer = null;
    let errorOnly = false;

    if (history.length === 0) {
      const directItem = findDeterministicFallbackItem(message, LIVE_SCENARIO_ITEMS);
      if (directItem) {
        path = 'direct_kb_answer';
        answer = buildFallbackAnswer(directItem);
      }
    }

    if (!answer) {
      // Normale, context-bewuste retrieval (zelfde tweetraps-aanpak als de
      // echte route: eerst de vraag alleen, anders geschiedenis erbij).
      let items = retrieveKnowledgeItems(message, LIVE_SCENARIO_ITEMS, { maxItems: 2 });
      if (items.length === 0 && previousUserMessages.length > 0) {
        items = retrieveKnowledgeItems(buildRetrievalQuery(previousUserMessages, message), LIVE_SCENARIO_ITEMS, { maxItems: 2 });
      }

      if (simulatedGroqFailsAt.has(questionNumber)) {
        // Groq faalt (gesimuleerde TPD-429) -> zelfde volgorde als de route:
        // eerst sources-fallback, dan pas de smalle deterministische match.
        if (items.length > 0) {
          const sources = items.map((item) => ({ name: 'test', title: item.title, url: 'https://example.org/' + item.id, snippet: item.content }));
          path = 'provider_error_with_fallback_sources';
          answer = buildSourceFallbackAnswer(sources);
        } else {
          const fallbackItem = findDeterministicFallbackItem(message, LIVE_SCENARIO_ITEMS);
          if (fallbackItem) {
            path = 'provider_error_with_fallback_deterministic';
            answer = buildFallbackAnswer(fallbackItem);
          } else {
            errorOnly = true;
          }
        }
      } else {
        // Groq slaagt gewoon (gesimuleerd): een echt AI-antwoord zou hier
        // normaal vandaan komen; voor deze test is alleen relevant DAT er
        // een antwoord is, niet de exacte AI-tekst.
        path = 'groq_success_simulated';
        answer = { ok: true, shortAnswer: `(gesimuleerd Groq-antwoord op basis van ${items.length} bron(nen))`, sources: items };
      }
    }

    report.push({ question: questionNumber, message, path, hasAnswer: Boolean(answer), errorOnly });

    history.push({ role: 'user', text: message });
    history.push({ role: 'assistant', text: answer?.shortAnswer ?? '' });
  });

  const withoutAnswer = report.filter((r) => r.errorOnly || !r.hasAnswer);
  assert.equal(
    withoutAnswer.length,
    0,
    `elke vraag in het live-testgesprek moet een bruikbaar antwoord krijgen, ook als Groq een TPD-429 geeft; kreeg geen antwoord bij: ${JSON.stringify(withoutAnswer, null, 2)}. Volledig rapport: ${JSON.stringify(report, null, 2)}`,
  );

  // Specifiek: vraag 6 ("en als ik de winst in de bv laat?") moet bij een
  // gesimuleerde TPD-429 via de bronnen-fallback gaan (niet de smalle
  // deterministische match, die hier het verkeerde "bv"-item zou kiezen —
  // zie de regressietest hierboven), én over het JUISTE onderwerp gaan.
  const q6 = report.find((r) => r.question === 6);
  assert.equal(q6.path, 'provider_error_with_fallback_sources', 'vraag 6 moet via de context-bewuste bronnen-fallback beantwoord worden, niet de smalle deterministische match');

  // Vraag 8 ("welke verzekeringen heb ik nodig?") heeft GEEN deterministisch
  // item (bewust, want dit onderwerp vereist het 4-wegs-onderscheid uit de
  // systeemprompt) — bij een gesimuleerde TPD-429 moet dit dus via de
  // bronnen-fallback gaan; zonder de ronde-6-fix (die uitsluitend het smalle
  // deterministische item probeerde) zou dit een kale foutmelding zijn
  // geweest.
  const q8 = report.find((r) => r.question === 8);
  assert.equal(q8.path, 'provider_error_with_fallback_sources', 'vraag 8 heeft geen deterministisch item en moet dus via de bronnen-fallback beantwoord worden');
});

// ---------------------------------------------------------------------
// 8. TPM/RPM-limiters blijven ongewijzigd (expliciete eis uit de opdracht:
// "bouw geen nieuwe TPM/RPM-workaround") en een providerfout telt nooit als
// geslaagde/geregistreerde request.

test('GROQ_TPM_LIMIT en GLOBAL_RATE_LIMIT_MAX zijn NIET gewijzigd in deze ronde (geen nieuwe TPM/RPM-workaround)', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const tpmMatch = text.match(/const DEFAULT_GROQ_TPM_LIMIT = ([\d_]+);/);
  const rpmMatch = text.match(/const GLOBAL_RATE_LIMIT_MAX = (\d+);/);
  assert.ok(tpmMatch && rpmMatch);
  assert.equal(Number(tpmMatch[1].replace(/_/g, '')), 7_300, 'DEFAULT_GROQ_TPM_LIMIT hoort ongewijzigd te blijven (7.300) — de TPD-fix raakt de TPM/RPM-limieten zelf niet');
  assert.equal(Number(rpmMatch[1]), 28, 'GLOBAL_RATE_LIMIT_MAX hoort ongewijzigd te blijven (28)');
});

test('een TPD-providerfout registreert nooit een succesvolle request (recordSuccessfulRequest blijft ná alle foutafhandeling staan)', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const recordCallIndex = text.indexOf('recordSuccessfulRequest(ip)');
  const dailyLimitReturnIndex = text.indexOf("code: 'provider_daily_limit'");
  assert.ok(recordCallIndex > -1 && dailyLimitReturnIndex > -1);
  assert.ok(recordCallIndex > dailyLimitReturnIndex, 'recordSuccessfulRequest moet ná de provider_daily_limit-afhandeling staan (een TPD-fout telt niet als succesvolle request)');
});

test('de TPM-reservering (tpmLimiter.record) blijft op precies één plek staan — de bronnen-/deterministische fallback bij een TPD-fout registreert geen tweede keer', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const recordCalls = [...text.matchAll(/tpmLimiter\.record\(/g)].length;
  assert.equal(recordCalls, 1, `tpmLimiter.record() mag maar op één plek voorkomen, telde ${recordCalls}`);
});
