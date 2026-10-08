// Nieuwe Kenniscentrum-architectuur (2026-10-08):
//
//   officiële bron → bronlaag → selectie (max. 2) → Avydo-artikel (AI)
//   → vaste validatie → Pull Request
//
// Getest: bronrecords en sourceUrl-deduplicatie, de migratie van alle
// bestaande bron-URL's, behoud van bestaande URL's/slugs, de selectie
// (max. 2, nul toegestaan, KVK-lastmod geen nieuws, overlap), de vaste
// validatie (titel, feiten, status, datums, duplicaten, bron), de
// gestructureerde AI-output en de volledige redactierun met gemockte fetch.
// Geen netwerk, geen echte AI-aanroep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeSourceUrl,
  SourceUrlSet,
  writeSourceRecord,
  readSourceRecords,
  updateSourceRecord,
  loadKnownSourceUrls,
} from './source-records.mjs';
import { selectTopics, classifyCandidate, findFutureEffectiveDate, findSameOrNewerYearArticle, MAX_TOPICS_PER_RUN } from './select-topics.mjs';
import {
  validateAvydoArticle,
  findUnsupportedFacts,
  checkStatus,
  titleSimilarity,
  ARTICLE_STATUSES,
} from './validate-article.mjs';
import {
  generateAvydoArticle,
  runEditorialPipeline,
  renderArticleMarkdown,
  parsePendingSourceUrls,
  buildArticlePrompt,
  resolveModel,
  PR_SOURCE_MARKER,
  GROQ_CHAT_COMPLETIONS_URL,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
  describeGroqError,
  redactSecrets,
} from './editorial.mjs';
import { estimateTokens } from '../../src/lib/token-estimate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(ROOT, 'src/content/kenniscentrum');
const SOURCES_DIR = path.join(ROOT, 'src/content/bronnen');
const NOW = new Date('2026-10-08T06:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function tempDir(name) {
  return mkdtempSync(path.join(tmpdir(), `kenniscentrum-${name}-`));
}

// --- Testbron en een geldig Avydo-artikel daarop ---

const SOURCE_BODY = [
  'Het kabinet wil de btw-aangifte voor kleine ondernemers eenvoudiger maken. Ondernemers met een omzet tot € 20.000 per jaar zouden volgens het wetsvoorstel nog maar één keer per jaar aangifte hoeven te doen.',
  'Het wetsvoorstel is vandaag in internetconsultatie gegaan. Reageren kan tot en met 15 november 2026. Daarna wordt het voorstel mogelijk aangepast en aan de Tweede Kamer aangeboden.',
  'De nieuwe regeling moet per 1 januari 2028 ingaan. Tot die tijd blijven de huidige aangiftetermijnen gelden. Het algemene btw-tarief van 21% verandert niet.',
  'Volgens de staatssecretaris scheelt de maatregel kleine ondernemers tijd en administratieve lasten, terwijl de Belastingdienst minder aangiften hoeft te verwerken.',
].join('\n\n');

const RECORD = {
  sourceUrl: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/05/kabinet-wil-btw-aangifte-kleine-ondernemers-vereenvoudigen',
  sourceName: 'Rijksoverheid',
  title: 'Kabinet wil btw-aangifte voor kleine ondernemers vereenvoudigen',
  description: 'Het kabinet wil de btw-aangifte voor kleine ondernemers eenvoudiger maken.',
  body: SOURCE_BODY,
  sourcePublishedAt: daysAgo(3),
  fetchedAt: daysAgo(0),
  category: 'Btw',
  priority: 'actueel',
  audiences: ['mkb-ondernemer'],
  processingStatus: 'kandidaat',
};

const VALID_ARTICLE = {
  title: 'Eén btw-aangifte per jaar voor kleine ondernemers: voorstel in consultatie',
  summary: 'Het kabinet wil dat ondernemers met een omzet tot € 20.000 nog maar één keer per jaar btw-aangifte doen. Het voorstel ligt in internetconsultatie.',
  body: [
    '## Wat is er aan de hand?',
    '',
    'Het kabinet wil de btw-aangifte voor kleine ondernemers eenvoudiger maken. Volgens het wetsvoorstel zouden ondernemers met een omzet tot € 20.000 per jaar nog maar één keer per jaar aangifte hoeven te doen. Het voorstel is in internetconsultatie gegaan; reageren kan tot en met 15 november 2026.',
    '',
    '## Voor wie is dit relevant?',
    '',
    'Voor kleine ondernemers die nu vaker per jaar btw-aangifte doen. Volgens het kabinet scheelt de maatregel tijd en administratieve lasten.',
    '',
    '## Wat is de status?',
    '',
    'Dit is een voorstel, nog geen geldende regel. De regeling moet per 1 januari 2028 ingaan; tot die tijd blijven de huidige aangiftetermijnen gelden. Het voorstel kan na de consultatie nog veranderen.',
  ].join('\n'),
  relevance: 'Doet u nu elk kwartaal btw-aangifte en is uw omzet klein, dan kan dit voorstel u later tijd besparen. Er verandert nu nog niets.',
  status: 'consultatie',
  category: 'Btw',
  audiences: ['mkb-ondernemer'],
  tags: ['btw', 'kleine ondernemers'],
};

const OTHER_AVYDO_ARTICLES = [
  { file: 'a.md', title: 'Vennootschapsbelasting: hoe werkt de tariefopbouw voor uw BV?', category: 'Vennootschapsbelasting', sourceUrl: 'https://www.belastingdienst.nl/a' },
];

// --- Bronlaag: sourceUrl-normalisatie en bronrecords ---

test('normalizeSourceUrl: trailing slash, http/https, hoofdletters in host en fragment geven dezelfde sleutel', () => {
  const key = normalizeSourceUrl('https://www.kvk.nl/belastingen/btw-id/');
  for (const variant of ['https://www.kvk.nl/belastingen/btw-id', 'http://WWW.KVK.NL/belastingen/btw-id/', 'https://www.kvk.nl/belastingen/btw-id/#kop', 'https://www.kvk.nl:443/belastingen/btw-id//']) {
    assert.equal(normalizeSourceUrl(variant), key, variant);
  }
  assert.notEqual(normalizeSourceUrl('https://www.kvk.nl/belastingen/btw-id?x=1'), key, 'querystring blijft onderscheidend');
  assert.equal(new SourceUrlSet(['https://www.kvk.nl/a/']).has('http://www.kvk.nl/a'), true);
});

test('bronrecord schrijven: één JSON-bestand per bron; een tweede schrijfactie voor dezelfde (genormaliseerde) URL werkt hetzelfde bestand bij', () => {
  const dir = tempDir('records');
  try {
    const id = writeSourceRecord(dir, RECORD);
    assert.equal(id, `${RECORD.sourcePublishedAt.slice(0, 10)}-kabinet-wil-btw-aangifte-voor-kleine-ondernemers-vereenvoudigen`);
    const again = writeSourceRecord(dir, { ...RECORD, sourceUrl: `${RECORD.sourceUrl}/`, processingStatus: 'afgewezen', rejectionReason: 'test' });
    assert.equal(again, id);
    const records = readSourceRecords(dir);
    assert.equal(records.length, 1);
    assert.equal(records[0].processingStatus, 'afgewezen');
    updateSourceRecord(dir, RECORD.sourceUrl, { processingStatus: 'verwerkt', avydoSlug: 'x', rejectionReason: undefined });
    const [updated] = readSourceRecords(dir);
    assert.equal(updated.processingStatus, 'verwerkt');
    assert.equal(updated.avydoSlug, 'x');
    assert.equal(updated.rejectionReason, undefined);
    assert.throws(() => writeSourceRecord(dir, { ...RECORD, processingStatus: 'gepubliceerd' }), /verwerkingsstatus/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sourceUrl-deduplicatie: bekende URL\'s komen uit de bronlaag én uit de Avydo-artikelen, genormaliseerd', () => {
  const urls = loadKnownSourceUrls({ sourcesDir: SOURCES_DIR, contentDir: CONTENT_DIR });
  // Een bron die alleen nog in de bronlaag staat (vervallen artikel).
  assert.equal(urls.has('http://www.kvk.nl/deponeren/zelf-deponeren-jaarrekening'), true);
  assert.equal(urls.has('https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zelfstandigenwet-biedt-meer-duidelijkheid-en-erkenning-voor-zzpers/'), true);
  assert.equal(urls.has('https://www.rijksoverheid.nl/actueel/nieuws/2099/01/01/onbekend'), false);
});

// --- Migratie van bestaande content ---

const LEGACY_URLS = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/legacy-source-urls.json'), 'utf8'));
const SLUGS = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/kenniscentrum-slugs-2026-10-08.json'), 'utf8'));
const RECORDS = readSourceRecords(SOURCES_DIR);

test('migratie: geen enkele bestaande officiële bron-URL is verloren gegaan (alle 121 unieke URL\'s van vóór de omzetting staan in de bronlaag)', () => {
  assert.equal(LEGACY_URLS.length, 121);
  const keys = new SourceUrlSet(RECORDS.map((r) => r.sourceUrl));
  for (const url of LEGACY_URLS) assert.ok(keys.has(url), `ontbreekt in de bronlaag: ${url}`);
  // Precies één record per bron-URL.
  const normalized = RECORDS.map((r) => normalizeSourceUrl(r.sourceUrl));
  assert.equal(new Set(normalized).size, normalized.length);
});

test('migratie: elk bronrecord is geldig; verwerkte bronnen verwijzen naar een bestaand Avydo-artikel met dezelfde bron', () => {
  for (const r of RECORDS) {
    assert.ok(['kandidaat', 'verwerkt', 'afgewezen'].includes(r.processingStatus), r.id);
    assert.ok(['Belastingdienst', 'Rijksoverheid', 'KVK'].includes(r.sourceName), r.id);
    if (r.processingStatus === 'afgewezen') assert.ok(r.rejectionReason, `${r.id}: reden ontbreekt`);
    if (r.avydoSlug) {
      const file = path.join(CONTENT_DIR, `${r.avydoSlug}.md`);
      assert.ok(existsSync(file), `${r.id} → ${r.avydoSlug}`);
      assert.match(readFileSync(file, 'utf8'), new RegExp(`^sourceUrl: "${r.sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'm'));
    }
  }
});

test('bronrelatie: elk Avydo-artikel heeft een bronrecord met dezelfde sourceUrl (bron → artikel en artikel → bron)', () => {
  const keys = new SourceUrlSet(RECORDS.map((r) => r.sourceUrl));
  for (const file of readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))) {
    const url = readFileSync(path.join(CONTENT_DIR, file), 'utf8').match(/^sourceUrl: "(.*)"$/m)[1];
    assert.ok(keys.has(url), `${file}: geen bronrecord voor ${url}`);
  }
});

test('bestaande URL\'s: de 68 behouden artikelen staan er met dezelfde slug; de 13 vervallen artikelen hebben een afgewezen bronrecord', () => {
  assert.equal(SLUGS.retained.length, 68);
  assert.equal(SLUGS.removed.length, 13);
  for (const slug of SLUGS.retained) assert.ok(existsSync(path.join(CONTENT_DIR, `${slug}.md`)), slug);
  for (const slug of SLUGS.removed) {
    assert.equal(existsSync(path.join(CONTENT_DIR, `${slug}.md`)), false, slug);
    const record = JSON.parse(readFileSync(path.join(SOURCES_DIR, `${slug}.json`), 'utf8'));
    assert.equal(record.processingStatus, 'afgewezen', slug);
  }
  assert.equal(readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).length, 68);
});

// --- Selectie ---

const kvkRecord = {
  sourceUrl: 'https://www.kvk.nl/belastingen/btw-aangifte-doen/',
  sourceName: 'KVK',
  title: 'Btw-aangifte doen: zo werkt de omzetbelasting voor ondernemers',
  description: 'Als ondernemer doet u periodiek btw-aangifte.',
  body: `${'Als ondernemer doet u btw-aangifte bij de Belastingdienst. '.repeat(15)}`,
  sourceLastModified: daysAgo(1),
  category: 'Btw',
  priority: 'praktisch',
  processingStatus: 'kandidaat',
};

function newsRecord(overrides = {}) {
  return { ...RECORD, ...overrides };
}

test('selectie: maximaal 2 onderwerpen per run, ook als er meer geschikte kandidaten zijn', () => {
  const records = [
    newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/1', title: 'Kabinet verhoogt de werkkostenregeling voor werkgevers', category: 'Personeel & loonheffingen' }),
    newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/2', title: 'Nieuwe regels voor de jaarrekening van middelgrote bedrijven', category: 'Administratie & jaarrekening' }),
    newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/3', title: 'Box 3: kabinet past heffing op spaargeld aan', category: 'Inkomstenbelasting' }),
  ];
  const { selected, deferred } = selectTopics(records, { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.equal(MAX_TOPICS_PER_RUN, 2);
  assert.equal(selected.length, 2);
  assert.ok(deferred.some((d) => /dagelijks maximum/.test(d.reason)));
});

test('selectie: 0 onderwerpen is een geldige uitkomst (oud nieuws, geen brontekst) — met een duidelijke reden', () => {
  const records = [
    newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/oud', sourcePublishedAt: daysAgo(200), body: 'Een oud bericht over de btw. '.repeat(40) }),
    newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/dun', body: 'Te kort.' }),
  ];
  const result = selectTopics(records, { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.equal(result.selected.length, 0);
  assert.ok(result.noTopicReason);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected.find((r) => r.record.sourceUrl.endsWith('/dun')).reason, /brontekst/);
  assert.match(result.rejected.find((r) => r.record.sourceUrl.endsWith('/oud')).reason, /niet meer actueel/);
});

test('selectie: actueel nieuws gaat voor regelgeving; een ouder bericht met een toekomstige ingangsdatum is wél kandidaat', () => {
  const old = newsRecord({
    sourceUrl: 'https://www.rijksoverheid.nl/ouder',
    title: 'Wetsvoorstel minimumloon voor jongeren naar de Kamer',
    category: 'Personeel & loonheffingen',
    sourcePublishedAt: daysAgo(150),
    body: `${'Het wetsvoorstel verhoogt het minimumloon voor jongeren. '.repeat(10)}De wet gaat in per 1 januari 2028.`,
  });
  const fresh = newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/vers' });
  assert.ok(findFutureEffectiveDate(old.body, NOW));
  assert.equal(classifyCandidate(old, { now: NOW, avydoArticles: [] }).tier, 2);
  const { selected } = selectTopics([old, fresh], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.deepEqual(selected.map((s) => [s.record.sourceUrl, s.tier, s.kind]), [
    ['https://www.rijksoverheid.nl/vers', 1, 'toelichting'],
    ['https://www.rijksoverheid.nl/ouder', 2, 'toelichting'],
  ]);
});

test('selectie: KVK-lastmod is geen nieuws — een recent gewijzigde KVK-pagina is hooguit blijvende uitleg (gids), en alleen op een dag zonder actueel onderwerp', () => {
  const c = classifyCandidate(kvkRecord, { now: NOW, avydoArticles: [] });
  assert.deepEqual([c.tier, c.kind], [3, 'gids']);
  const withNews = selectTopics([kvkRecord, newsRecord()], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.deepEqual(withNews.selected.map((s) => s.record.sourceName), ['Rijksoverheid']);
  assert.ok(withNews.deferred.some((d) => d.record.sourceName === 'KVK'));
  const alone = selectTopics([kvkRecord], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.deepEqual(alone.selected.map((s) => s.kind), ['gids']);
});

test('selectie: overlap met een bestaand Avydo-artikel, een bron die al een artikel heeft, of een openstaand voorstel → niet gekozen', () => {
  const existing = [{ file: 'b.md', title: 'Btw-aangifte voor kleine ondernemers vereenvoudigen', category: 'Btw', sourceUrl: 'https://www.belastingdienst.nl/b' }];
  const overlap = selectTopics([newsRecord()], { now: NOW, avydoArticles: existing });
  assert.equal(overlap.selected.length, 0);
  assert.match(overlap.rejected[0].reason, /al behandeld/);

  const covered = selectTopics([newsRecord()], { now: NOW, avydoArticles: [{ file: 'c.md', title: 'Iets anders', category: 'Btw', sourceUrl: `${RECORD.sourceUrl}/` }] });
  assert.equal(covered.selected.length, 0);

  const pending = selectTopics([newsRecord()], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES, pendingSourceUrls: [RECORD.sourceUrl] });
  assert.equal(pending.selected.length, 0);
  assert.match(pending.deferred[0].reason, /Pull Request/);
});

test('selectie: twee kandidaten over hetzelfde onderwerp → alleen de eerste', () => {
  const a = newsRecord({ sourceUrl: 'https://www.rijksoverheid.nl/a' });
  const b = newsRecord({ sourceUrl: 'https://www.belastingdienst.nl/b', sourceName: 'Belastingdienst', title: 'Btw-aangifte voor kleine ondernemers wordt vereenvoudigd' });
  const { selected } = selectTopics([a, b], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.equal(selected.length, 1);
});

// Regressie productie-run #38 (2026-10-08): "Belastingtarieven en cijfers van
// 2025" werd als blijvende uitleg gekozen, terwijl er al een Avydo-artikel
// over de tarieven van 2026 bestaat. De titel-Jaccard zag dat niet.
function kvkYearRecord(year, overrides = {}) {
  return {
    ...kvkRecord,
    sourceUrl: `https://www.kvk.nl/geldzaken/belastingtarieven-${year}/`,
    title: `Belastingtarieven en cijfers van ${year}`,
    description: `Alle belastingtarieven voor ondernemers in ${year} overzichtelijk bij elkaar, van inkomstenbelasting en btw tot box 3.`,
    body: `${'De tarieven van de inkomstenbelasting, btw en vennootschapsbelasting op een rij. '.repeat(12)}`,
    category: 'Fiscale actualiteit',
    ...overrides,
  };
}
const TARIEVEN_2026_ARTICLE = {
  file: '2026-09-28-inzicht-in-de-belastingtarieven-en-cijfers-van-2026.md',
  title: 'Belastingtarieven en cijfers voor ondernemers in 2026: waar vindt u het overzicht?',
  category: 'Fiscale actualiteit',
  sourceUrl: 'https://www.kvk.nl/geldzaken/belastingtarieven-2026/',
};

test('jaargebonden onderwerp: een oud jaar wordt niet gekozen als er al een nieuwer Avydo-artikel over hetzelfde onderwerp is (ook bij andere formulering of categorie)', () => {
  const old = kvkYearRecord(2025);
  assert.ok(findSameOrNewerYearArticle(old.title, [TARIEVEN_2026_ARTICLE]));
  const c = classifyCandidate(old, { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.equal(c.eligible, false);
  assert.match(c.reason, /jaargebonden onderwerp over 2025, verouderd: er is al een Avydo-artikel voor 2026/);
  const otherCategory = classifyCandidate(kvkYearRecord(2025, { category: 'Inkomstenbelasting' }), { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.equal(otherCategory.eligible, false);
  const { selected, rejected } = selectTopics([old], { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.equal(selected.length, 0);
  assert.equal(rejected.length, 1);
});

test('jaargebonden onderwerp: hetzelfde jaar nogmaals is een dubbele actualisatie en wordt niet gekozen', () => {
  // Hier vangt de bestaande titel-overlap het al (zelfde jaartal); de jaarcontrole zelf ziet het ook.
  const c = classifyCandidate(kvkYearRecord(2026), { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.equal(c.eligible, false);
  assert.match(c.reason, /al behandeld|dubbel: er is al een Avydo-artikel voor 2026/);
  const sameYear = findSameOrNewerYearArticle('Belastingtarieven en cijfers van 2026', [TARIEVEN_2026_ARTICLE]);
  assert.deepEqual([sameYear.year, sameYear.sourceYear], [2026, 2026]);
});

test('jaargebonden onderwerp: een nieuwer jaar, of een jaarlijks onderwerp zonder bestaand artikel, kan wél gekozen worden', () => {
  const newer = classifyCandidate(kvkYearRecord(2027), { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.deepEqual([newer.eligible, newer.tier, newer.kind], [true, 3, 'gids']);
  const noArticle = selectTopics([kvkYearRecord(2026)], { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES });
  assert.deepEqual(noArticle.selected.map((s) => s.record.title), ['Belastingtarieven en cijfers van 2026']);
  // Onderwerpen zonder jaartal en onderwerpen die maar deels overlappen blijven ongemoeid.
  assert.equal(findSameOrNewerYearArticle('Jaarrekening wel of niet deponeren?', [TARIEVEN_2026_ARTICLE]), null);
  assert.equal(findSameOrNewerYearArticle('Belastingplan 2026: nieuwe maatregelen voor werkgevers', [TARIEVEN_2026_ARTICLE]), null);
});

test('productie-run #38 nagespeeld: tarieven 2025 afgewezen, "Jaarrekening wel of niet deponeren?" wordt de enige blijvende uitleg, "Verklaringen deponeren" afgewezen', () => {
  const jaarrekening = {
    ...kvkRecord,
    sourceUrl: 'https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/',
    title: 'Jaarrekening wel of niet deponeren?',
    description: 'Of je een jaarrekening moet deponeren, hangt af van je rechtsvorm.',
    body: `${'Een bv moet de jaarrekening deponeren bij KVK; een eenmanszaak niet. '.repeat(12)}`,
    sourceLastModified: '2025-08-26T00:00:00.000Z',
    category: 'Administratie & jaarrekening',
  };
  const verklaringen = {
    ...kvkRecord,
    sourceUrl: 'https://www.kvk.nl/deponeren/verklaringen-deponeren/',
    title: 'Verklaringen deponeren',
    description: 'Welke verklaringen deponeer je bij KVK?',
    body: `${'Sommige verklaringen deponeer je bij KVK. '.repeat(20)}`,
    sourceLastModified: '2025-01-07T00:00:00.000Z',
    category: 'Administratie & jaarrekening',
  };
  const tarieven = kvkYearRecord(2025, { sourceLastModified: '2026-02-24T00:00:00.000Z' });
  const second = { ...jaarrekening, sourceUrl: 'https://www.kvk.nl/deponeren/andere/', title: 'Btw-aangifte corrigeren: zo herstel je een fout', category: 'Btw', sourceLastModified: '2025-03-01T00:00:00.000Z' };
  const result = selectTopics([tarieven, jaarrekening, verklaringen, second], { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.deepEqual(result.selected.map((s) => [s.record.title, s.kind]), [['Jaarrekening wel of niet deponeren?', 'gids']]);
  // Maximaal één blijvende uitleg per dag: de andere geschikte gids wordt uitgesteld, niet afgewezen.
  assert.ok(result.deferred.some((d) => d.record.title === 'Btw-aangifte corrigeren: zo herstel je een fout' && /blijvende uitleg/.test(d.reason)));
  assert.match(result.rejected.find((r) => r.record.title === 'Verklaringen deponeren').reason, /zonder sterk fiscaal signaal/);
  assert.match(result.rejected.find((r) => r.record.title.endsWith('2025')).reason, /jaargebonden/);
  // Alleen tarieven 2025 en verklaringen: 0 artikelen is een geldige uitkomst.
  const none = selectTopics([tarieven, verklaringen], { now: NOW, avydoArticles: [TARIEVEN_2026_ARTICLE] });
  assert.equal(none.selected.length, 0);
  assert.ok(none.noTopicReason);
});

test('selectie: alleen kandidaten; verwerkte en afgewezen records worden niet opnieuw gekozen (ook niet de echte bronlaag)', () => {
  const real = selectTopics(RECORDS, { now: NOW, avydoArticles: [] });
  assert.equal(real.selected.length, 0);
  assert.equal(RECORDS.filter((r) => r.processingStatus === 'kandidaat').length, 0);
});

// --- Vaste validatie ---

const VALID_CONTEXT = { now: NOW, avydoArticles: OTHER_AVYDO_ARTICLES, sourceReachable: true };

test('validatie: een correct Avydo-artikel op basis van de bron slaagt', () => {
  const result = validateAvydoArticle(VALID_ARTICLE, RECORD, VALID_CONTEXT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('validatie titel: gelijk of vrijwel gelijk aan de brontitel wordt afgewezen; te kort ook', () => {
  assert.match(validateAvydoArticle({ ...VALID_ARTICLE, title: RECORD.title }, RECORD, VALID_CONTEXT).errors.join(), /gelijk aan de brontitel/);
  const near = 'Kabinet wil de btw-aangifte voor kleine ondernemers vereenvoudigen';
  assert.ok(titleSimilarity(near, RECORD.title) >= 0.75);
  assert.match(validateAvydoArticle({ ...VALID_ARTICLE, title: near }, RECORD, VALID_CONTEXT).errors.join(), /vrijwel gelijk/);
  assert.match(validateAvydoArticle({ ...VALID_ARTICLE, title: 'Btw' }, RECORD, VALID_CONTEXT).errors.join(), /titel heeft een onlogische lengte/);
});

test('validatie inhoud: samenvatting, tussenkoppen, lengte, duiding, categorie en doelgroep worden gecontroleerd', () => {
  const errors = validateAvydoArticle({
    ...VALID_ARTICLE,
    summary: 'Kort.',
    body: 'Alleen een korte tekst zonder koppen.',
    relevance: 'Dit kan gevolgen hebben voor uw btw-aangifte of -administratie. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
    category: 'Onbekend',
    audiences: ['iedereen'],
  }, RECORD, VALID_CONTEXT).errors.join(' | ');
  for (const re of [/samenvatting/, /te kort/, /tussenkoppen/, /Wat betekent dit voor u/, /ongeldige categorie/, /ongeldige doelgroep/]) assert.match(errors, re);
});

test('feiten: bedragen, percentages, datums en jaartallen die niet in de bron staan, blokkeren het artikel', () => {
  assert.deepEqual(findUnsupportedFacts('Omzet tot €20.000, tarief 21 procent, per 1 januari 2028.', SOURCE_BODY), []);
  const missing = findUnsupportedFacts('Een boete van € 5.000, 9% korting, uiterlijk 1 maart en in 2029.', SOURCE_BODY);
  assert.deepEqual(missing, ['bedrag 5000', 'percentage 9%', 'datum 1 maart', 'jaartal 2029']);
  const result = validateAvydoArticle({ ...VALID_ARTICLE, body: `${VALID_ARTICLE.body}\n\nDe boete bedraagt € 5.000.` }, RECORD, VALID_CONTEXT);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /bedrag 5000 staat niet in de brontekst/);
});

test('feiten: de publicatiedatum van het bronbericht telt als feit uit de bron', () => {
  const record = { ...RECORD, sourcePublishedAt: '2026-10-05T10:00:00.000Z' };
  const article = { ...VALID_ARTICLE, body: VALID_ARTICLE.body.replace('Het kabinet wil', 'Op 5 oktober 2026 maakte het kabinet bekend dat het wil') };
  assert.deepEqual(validateAvydoArticle(article, record, VALID_CONTEXT).errors, []);
  assert.match(validateAvydoArticle(article, { ...record, sourcePublishedAt: '2026-10-04T10:00:00.000Z' }, VALID_CONTEXT).errors.join(), /datum 5 oktober/);
});

test('status: een voorstel mag niet als geldende wet worden gepresenteerd; een toekomstige datum niet als al geldend', () => {
  const asLaw = { ...VALID_ARTICLE, body: `${VALID_ARTICLE.body}\n\nDe nieuwe regel is van kracht.` };
  assert.match(checkStatus(asLaw, SOURCE_BODY, NOW).join(), /presenteert het als geldend/);
  const futureAsCurrent = { ...VALID_ARTICLE, body: `${VALID_ARTICLE.body}\n\nSinds 1 januari 2028 geldt de jaaraangifte.` };
  assert.match(checkStatus(futureAsCurrent, SOURCE_BODY, NOW).join(), /toekomstige datum/);
  // De bron noemt een wetsvoorstel: zonder voorlopige status geen artikel.
  assert.match(checkStatus({ ...VALID_ARTICLE, status: undefined }, SOURCE_BODY, NOW).join(), /geen voorlopige status/);
  assert.match(checkStatus({ ...VALID_ARTICLE, status: 'van-kracht' }, SOURCE_BODY, NOW).join(), /geen voorlopige status/);
  assert.match(checkStatus({ ...VALID_ARTICLE, status: 'wet' }, SOURCE_BODY, NOW).join(), /ongeldige status/);
  assert.deepEqual(checkStatus(VALID_ARTICLE, SOURCE_BODY, NOW), []);
});

test('status: de geldige statuswaarden zijn gelijk aan het schema (src/content/config.ts) en hebben allemaal een label', async () => {
  const config = readFileSync(path.join(ROOT, 'src/content/config.ts'), 'utf8');
  const schemaStatuses = [...config.match(/articleStatuses = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ARTICLE_STATUSES, schemaStatuses);
  const { STATUS_LABELS } = await import('../../src/lib/news-presentation.mjs');
  assert.deepEqual(Object.keys(STATUS_LABELS), schemaStatuses);
});

test('datums: een bronpublicatiedatum in de toekomst blokkeert het artikel', () => {
  const result = validateAvydoArticle(VALID_ARTICLE, { ...RECORD, sourcePublishedAt: '2026-12-01T00:00:00.000Z' }, VALID_CONTEXT);
  assert.match(result.errors.join(), /publicatiedatum van de bron ligt in de toekomst/);
});

test('bron en duplicaat: onofficiële host, onbereikbare bron, andere links en overlap met een bestaand Avydo-artikel blokkeren', () => {
  assert.match(validateAvydoArticle(VALID_ARTICLE, { ...RECORD, sourceUrl: 'https://example.com/x' }, VALID_CONTEXT).errors.join(), /hoort niet bij Rijksoverheid/);
  assert.match(validateAvydoArticle(VALID_ARTICLE, { ...RECORD, sourceName: 'Nieuwsblog' }, VALID_CONTEXT).errors.join(), /geen officiële bronnaam/);
  assert.match(validateAvydoArticle(VALID_ARTICLE, RECORD, { ...VALID_CONTEXT, sourceReachable: false }).errors.join(), /niet bereikbaar/);
  assert.match(validateAvydoArticle({ ...VALID_ARTICLE, body: `${VALID_ARTICLE.body}\n\nZie https://example.com.` }, RECORD, VALID_CONTEXT).errors.join(), /linkt naar een andere bron/);
  const existing = [{ file: 'd.md', title: 'Eén btw-aangifte per jaar voor kleine ondernemers', category: 'Btw', sourceUrl: 'https://www.belastingdienst.nl/d' }];
  assert.match(validateAvydoArticle(VALID_ARTICLE, RECORD, { ...VALID_CONTEXT, avydoArticles: existing }).errors.join(), /overlapt met bestaand Avydo-artikel/);
  const sameSource = [{ file: 'e.md', title: 'Iets anders', category: 'Btw', sourceUrl: RECORD.sourceUrl }];
  assert.match(validateAvydoArticle(VALID_ARTICLE, RECORD, { ...VALID_CONTEXT, avydoArticles: sameSource }).errors.join(), /al een Avydo-artikel op basis van deze bron/);
});

// --- AI-redactiestap (gemockt) ---

// Groq-antwoord (OpenAI-compatibel): de tool-argumenten komen als JSON-tekst.
function groqResponse(args, { status = 200, name = 'avydo_artikel' } = {}) {
  const body = { choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: args } }] } }] };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const aiResponse = (input) => groqResponse(JSON.stringify(input));
const isGroq = (url) => String(url) === GROQ_CHAT_COMPLETIONS_URL;
const AI_INPUT = { voldoendeInformatie: true, ...VALID_ARTICLE, status: 'consultatie', tags: ['Btw', 'kleine ondernemers'] };

// Het artikelschema zoals de redactie het sinds 2026-10-08 gebruikt; mag
// bij de overstap naar Groq niet veranderen.
const ARTICLE_SCHEMA_FIELDS = ['voldoendeInformatie', 'redenOnvoldoende', 'title', 'summary', 'body', 'relevance', 'status', 'category', 'audiences', 'tags'];
const ARTICLE_SCHEMA_REQUIRED = ['voldoendeInformatie', 'title', 'summary', 'body', 'relevance', 'status', 'category', 'audiences', 'tags'];

test('generatie (Groq): juiste URL, Bearer-sleutel, function-tool met parameters, verplichte tool_choice; de volledige brontekst gaat mee', async () => {
  let request;
  const result = await generateAvydoArticle(RECORD, 'toelichting', {
    apiKey: 'test-key',
    now: NOW,
    fetchImpl: async (url, opts) => {
      request = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return aiResponse(AI_INPUT);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer test-key');
  assert.equal(request.headers['x-api-key'], undefined);
  assert.equal(request.headers['anthropic-version'], undefined);
  assert.equal(request.body.model, 'openai/gpt-oss-20b');
  assert.equal(request.body.temperature, 0.3);
  assert.equal(request.body.reasoning_effort, 'low');
  assert.equal(request.body.max_tokens, MAX_OUTPUT_TOKENS);
  assert.ok(MAX_OUTPUT_TOKENS >= 2500 && MAX_OUTPUT_TOKENS <= 3500);
  assert.equal(request.body.tools.length, 1);
  assert.equal(request.body.tools[0].type, 'function');
  assert.equal(request.body.tools[0].function.name, 'avydo_artikel');
  assert.equal(request.body.tools[0].input_schema, undefined);
  assert.equal(request.body.tools[0].function.input_schema, undefined);
  assert.deepEqual(request.body.tool_choice, { type: 'function', function: { name: 'avydo_artikel' } });
  const schema = request.body.tools[0].function.parameters;
  assert.equal(schema.type, 'object');
  assert.ok(request.body.messages.length === 1 && request.body.messages[0].role === 'user');
  assert.ok(request.body.messages[0].content.includes(SOURCE_BODY));
  assert.equal(request.body.messages[0].content, buildArticlePrompt(RECORD, 'toelichting', NOW));
  assert.match(buildArticlePrompt(RECORD, 'toelichting', NOW), /Noem geen bedragen, percentages, datums of jaartallen die niet letterlijk in de brontekst staan/);
});

test('generatie (Groq): het artikelschema is ongewijzigd (velden, verplichte velden, enums)', async () => {
  let schema;
  await generateAvydoArticle(RECORD, 'toelichting', {
    apiKey: 'k', now: NOW,
    fetchImpl: async (_url, opts) => {
      schema = JSON.parse(opts.body).tools[0].function.parameters;
      return aiResponse(AI_INPUT);
    },
  });
  assert.deepEqual(Object.keys(schema.properties), ARTICLE_SCHEMA_FIELDS);
  assert.deepEqual(schema.required, ARTICLE_SCHEMA_REQUIRED);
  assert.deepEqual(schema.properties.status.enum, ['geen', ...ARTICLE_STATUSES]);
  assert.equal(schema.properties.category.enum.length, 8);
  assert.equal(schema.properties.tags.maxItems, 6);
  assert.deepEqual(schema.properties.audiences.items.enum, ['zzp', 'bv-dga', 'werkgever', 'starter', 'mkb-ondernemer']);
});

test('generatie (Groq): tool_calls[0].function.arguments wordt met JSON.parse gelezen en levert het gestructureerde artikel', async () => {
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse(AI_INPUT) });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.article).sort(), ['audiences', 'body', 'category', 'relevance', 'status', 'summary', 'tags', 'title']);
  assert.equal(result.article.title, VALID_ARTICLE.title);
  assert.equal(result.article.body, VALID_ARTICLE.body);
  assert.equal(result.article.status, 'consultatie');
  assert.deepEqual(result.article.tags, ['btw', 'kleine ondernemers']);
  const geen = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse({ ...AI_INPUT, status: 'geen' }) });
  assert.equal(geen.article.status, undefined);
});

test('generatie (Groq): ongeldige JSON, geen tool-call, een andere tool of een API-fout → geen artikel, geen exception', async () => {
  const cases = [
    groqResponse('{"title": "afgekapt'),
    groqResponse('"alleen tekst"'),
    groqResponse(JSON.stringify(AI_INPUT), { name: 'iets_anders' }),
    new Response(JSON.stringify({ choices: [{ message: { content: 'vrije tekst' } }] }), { status: 200 }),
    new Response('{}', { status: 500 }),
    new Response('{"error":{"code":"tool_use_failed"}}', { status: 400 }),
  ];
  for (const response of cases) {
    const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => response });
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  }
  const insufficient = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse({ ...AI_INPUT, voldoendeInformatie: false, redenOnvoldoende: 'te vaag' }) });
  assert.deepEqual([insufficient.ok, /te vaag/.test(insufficient.reason)], [false, true]);
});

test('generatie (Groq): HTTP 429 → geen artikel, gemarkeerd als limiet, precies één aanroep (geen retry)', async () => {
  let calls = 0;
  const result = await generateAvydoArticle(RECORD, 'toelichting', {
    apiKey: 'k', now: NOW,
    fetchImpl: async () => { calls += 1; return new Response('{"error":"rate_limit"}', { status: 429 }); },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.rateLimited, true);
  assert.match(result.reason, /429/);
});

test('generatie (Groq): zonder GROQ_API_KEY geen AI-aanroep', async () => {
  let calls = 0;
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: '', now: NOW, fetchImpl: async () => { calls += 1; return aiResponse(AI_INPUT); } });
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.match(result.reason, /GROQ_API_KEY ontbreekt/);
});

test('model: standaard openai/gpt-oss-20b; KENNISCENTRUM_MODEL gaat vóór GROQ_MODEL', () => {
  assert.equal(DEFAULT_MODEL, 'openai/gpt-oss-20b');
  assert.equal(resolveModel({}), 'openai/gpt-oss-20b');
  assert.equal(resolveModel({ KENNISCENTRUM_MODEL: '', GROQ_MODEL: '' }), 'openai/gpt-oss-20b');
  assert.equal(resolveModel({ GROQ_MODEL: 'openai/gpt-oss-120b' }), 'openai/gpt-oss-120b');
  assert.equal(resolveModel({ KENNISCENTRUM_MODEL: 'x/a', GROQ_MODEL: 'x/b' }), 'x/a');
});

test('Avydo-artikel-output: frontmatter past op het schema, met avydoContent, bron, aparte brondatum en Avydo-publicatiedatum', () => {
  const md = renderArticleMarkdown({ ...VALID_ARTICLE, title: 'Titel met "aanhalingstekens"' }, RECORD, 'toelichting', NOW);
  const frontmatter = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  const config = readFileSync(path.join(ROOT, 'src/content/config.ts'), 'utf8');
  const kenniscentrumSchema = config.slice(config.indexOf('const kenniscentrum'), config.indexOf('const bronnen'));
  const schemaKeys = new Set([...kenniscentrumSchema.matchAll(/^ {4}(\w+): z\./gm)].map((m) => m[1]));
  for (const [, key] of frontmatter.matchAll(/^([A-Za-z]\w*):/gm)) assert.ok(schemaKeys.has(key), key);
  assert.match(frontmatter, /^title: "Titel met \\"aanhalingstekens\\""$/m);
  assert.match(frontmatter, /^avydoContent: "toelichting"$/m);
  assert.match(frontmatter, new RegExp(`^publishedAt: ${NOW.toISOString()}$`, 'm'));
  assert.match(frontmatter, new RegExp(`^sourcePublishedAt: ${RECORD.sourcePublishedAt}$`, 'm'));
  assert.match(frontmatter, new RegExp(`^sourceUrl: "${RECORD.sourceUrl}"$`, 'm'));
  assert.match(frontmatter, /^status: "consultatie"$/m);
  assert.match(frontmatter, /^hidden: false$/m);
  assert.doesNotMatch(frontmatter, /^fetchedAt:/m);
});

// --- Volledige redactierun (tijdelijke mappen, gemockte fetch) ---

async function runPipelineWith(aiInput, { records = [RECORD], pending = [], apiKey = 'k', fetchImpl } = {}) {
  const contentDir = tempDir('content');
  const sourcesDir = tempDir('sources');
  for (const r of records) writeSourceRecord(sourcesDir, r);
  const logs = [];
  try {
    const run = await runEditorialPipeline({
      contentDir, sourcesDir, now: NOW, apiKey, pendingSourceUrls: pending, log: (l) => logs.push(l),
      aiCallSpacingMs: 0,
      fetchImpl: fetchImpl ?? (async (url) => (isGroq(url) ? aiResponse(aiInput) : new Response('<html></html>', { status: 200 }))),
    });
    return { run, logs, articles: readdirSync(contentDir).filter((f) => f.endsWith('.md')).map((f) => ({ f, text: readFileSync(path.join(contentDir, f), 'utf8') })), records: readSourceRecords(sourcesDir) };
  } finally {
    rmSync(contentDir, { recursive: true, force: true });
    rmSync(sourcesDir, { recursive: true, force: true });
  }
}

test('redactierun: één gekozen bron → één gevalideerd Avydo-artikel, bronrecord gekoppeld (verwerkt + avydoSlug), Pull Request-tekst met bron, reden, status en validatie', async () => {
  const { run, articles, records } = await runPipelineWith(AI_INPUT);
  assert.equal(run.created.length, 1);
  assert.equal(articles.length, 1);
  const slug = articles[0].f.replace(/\.md$/, '');
  assert.match(slug, /^2026-10-08-een-btw-aangifte-per-jaar-voor-kleine-ondernemers/);
  assert.match(articles[0].text, /^avydoContent: "toelichting"$/m);
  assert.equal(records[0].processingStatus, 'verwerkt');
  assert.equal(records[0].avydoSlug, slug);
  const pr = run.pullRequest;
  assert.ok(pr);
  assert.match(pr.title, /Avydo-artikel/);
  for (const re of [/automatisch/i, /Officiële bron:\*\* Rijksoverheid/, /Waarom gekozen:\*\* actueel bericht/, /Status:\*\* consultatie/, /alle vaste controles geslaagd/, new RegExp(`<!-- ${PR_SOURCE_MARKER}: ${RECORD.sourceUrl} -->`)]) {
    assert.match(pr.body, re);
  }
});

test('redactierun: validatiefout → geen artikel, geen Pull Request, bron blijft kandidaat, reden gelogd', async () => {
  const { run, articles, records, logs } = await runPipelineWith({ ...AI_INPUT, body: `${AI_INPUT.body}\n\nDe boete is € 5.000.` });
  assert.equal(run.created.length, 0);
  assert.equal(run.pullRequest, null);
  assert.deepEqual(articles, []);
  assert.equal(records[0].processingStatus, 'kandidaat');
  assert.match(run.summary.failed[0].reason, /bedrag 5000 staat niet in de brontekst/);
  assert.ok(logs.some((l) => /validatie mislukt/.test(l)));
});

test('redactierun: geen geschikt onderwerp → 0 artikelen, geen Pull Request, "Geen artikel vandaag" gelogd; ongeschikte bron afgewezen met reden', async () => {
  const { run, articles, records, logs } = await runPipelineWith(AI_INPUT, { records: [{ ...RECORD, sourcePublishedAt: daysAgo(400), body: 'Oud. '.repeat(200) }] });
  assert.equal(run.created.length, 0);
  assert.equal(run.pullRequest, null);
  assert.deepEqual(articles, []);
  assert.ok(run.summary.noArticleReason);
  assert.ok(logs.some((l) => /^Geen artikel vandaag/.test(l)));
  assert.equal(records[0].processingStatus, 'afgewezen');
  assert.ok(records[0].rejectionReason);
});

test('redactierun: zonder API-key ontstaat er geen (half) artikel en geen Pull Request; de bron blijft kandidaat en er wordt geen AI aangeroepen', async () => {
  let aiCalls = 0;
  const contentDir = tempDir('content-nokey');
  const sourcesDir = tempDir('sources-nokey');
  writeSourceRecord(sourcesDir, RECORD);
  try {
    const run = await runEditorialPipeline({
      contentDir, sourcesDir, now: NOW, apiKey: '', log: () => {},
      fetchImpl: async (url) => {
        if (String(url).includes('groq.com') || String(url).includes('anthropic.com')) aiCalls += 1;
        return new Response('<html></html>', { status: 200 });
      },
    });
    assert.equal(aiCalls, 0);
    assert.equal(run.created.length, 0);
    assert.equal(run.pullRequest, null);
    assert.match(run.summary.failed[0].reason, /GROQ_API_KEY ontbreekt/);
    assert.deepEqual(readdirSync(contentDir), []);
    assert.equal(readSourceRecords(sourcesDir)[0].processingStatus, 'kandidaat');
  } finally {
    rmSync(contentDir, { recursive: true, force: true });
    rmSync(sourcesDir, { recursive: true, force: true });
  }
  // De workflow maakt alleen een PR als er een artikel is, en geeft de sleutel als repository secret door.
  const wf = readFileSync(path.join(ROOT, '.github/workflows/kenniscentrum-update.yml'), 'utf8');
  assert.match(wf, /GROQ_API_KEY: \$\{\{ secrets\.GROQ_API_KEY \}\}/);
  assert.doesNotMatch(wf, /^\s*environment:/m);
  assert.match(wf, /- name: Pull Request maken\n\s+if: steps\.fetch\.outputs\.created != '0'/);
});

test('openstaande of afgewezen redactie-PR\'s: hun bron-URL\'s worden niet opnieuw gekozen; gemergde PR\'s tellen niet', () => {
  const prs = [
    { headRefName: 'kenniscentrum/avydo-2026-10-07-1', mergedAt: null, body: `x\n<!-- ${PR_SOURCE_MARKER}: https://www.rijksoverheid.nl/a -->` },
    { headRefName: 'kenniscentrum/avydo-2026-10-06-1', mergedAt: '2026-10-06T10:00:00Z', body: `<!-- ${PR_SOURCE_MARKER}: https://www.rijksoverheid.nl/b -->` },
    { headRefName: 'feature/iets', mergedAt: null, body: `<!-- ${PR_SOURCE_MARKER}: https://www.rijksoverheid.nl/c -->` },
  ];
  assert.deepEqual(parsePendingSourceUrls(prs), ['https://www.rijksoverheid.nl/a']);
});

// --- Workflow: Pull Request in plaats van een directe commit ---

test('workflow: de dagelijkse run maakt alleen bij een geslaagd artikel een Pull Request en pusht nooit rechtstreeks naar de live branch', () => {
  const wf = readFileSync(path.join(ROOT, '.github/workflows/kenniscentrum-update.yml'), 'utf8');
  assert.match(wf, /group: kenniscentrum-update/);
  assert.match(wf, /pull-requests: write/);
  assert.match(wf, /if: steps\.fetch\.outputs\.created != '0'/);
  assert.match(wf, /git checkout -b "\$branch"/);
  assert.match(wf, /git push -u origin "\$branch"/);
  assert.match(wf, /gh pr create/);
  assert.match(wf, /npm run kenniscentrum:test/);
  assert.match(wf, /npm run build/);
  assert.equal((wf.match(/git push/g) ?? []).length, 1);
});

// --- Regressie: de Kenniscentrum-redactie hangt niet meer af van Anthropic ---

test('regressie: redactie, import en workflow gebruiken geen ANTHROPIC_API_KEY of Anthropic-API meer', () => {
  const files = ['scripts/kenniscentrum/editorial.mjs', 'scripts/kenniscentrum/fetch-articles.mjs', 'scripts/kenniscentrum/select-topics.mjs', 'scripts/kenniscentrum/validate-article.mjs', '.github/workflows/kenniscentrum-update.yml'];
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const forbidden of [/ANTHROPIC_API_KEY/, /api\.anthropic\.com/, /anthropic-version/, /input_schema/, /tool_use/]) {
      assert.doesNotMatch(text, forbidden, `${file} bevat ${forbidden}`);
    }
  }
  assert.match(readFileSync(path.join(ROOT, 'scripts/kenniscentrum/fetch-articles.mjs'), 'utf8'), /process\.env\.GROQ_API_KEY/);
});

test('regressie: met alleen ANTHROPIC_API_KEY (zonder Groq-sleutel) ontstaat er geen artikel en wordt er geen AI aangeroepen', async () => {
  const previous = { anthropic: process.env.ANTHROPIC_API_KEY, groq: process.env.GROQ_API_KEY };
  process.env.ANTHROPIC_API_KEY = 'alleen-anthropic';
  delete process.env.GROQ_API_KEY;
  let aiCalls = 0;
  try {
    const { run, articles } = await runPipelineWith(AI_INPUT, {
      apiKey: process.env.GROQ_API_KEY ?? '',
      fetchImpl: async (url) => {
        if (String(url).includes('groq.com') || String(url).includes('anthropic.com')) aiCalls += 1;
        return new Response('<html></html>', { status: 200 });
      },
    });
    assert.equal(aiCalls, 0);
    assert.equal(run.created.length, 0);
    assert.equal(run.pullRequest, null);
    assert.deepEqual(articles, []);
  } finally {
    if (previous.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.anthropic;
    if (previous.groq !== undefined) process.env.GROQ_API_KEY = previous.groq;
  }
});

test('redactierun (Groq): 429 bij het eerste onderwerp → gecontroleerd stoppen, geen tweede AI-aanroep, geen artikel/PR; bronnen blijven kandidaat', async () => {
  const second = { ...RECORD, sourceUrl: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/06/tweede-bericht', title: 'Tweede bericht over loonheffingen voor werkgevers' };
  let aiCalls = 0;
  const { run, articles, records, logs } = await runPipelineWith(AI_INPUT, {
    records: [RECORD, second],
    fetchImpl: async (url) => {
      if (isGroq(url)) { aiCalls += 1; return new Response('{}', { status: 429 }); }
      return new Response('<html></html>', { status: 200 });
    },
  });
  assert.equal(run.summary.selected, 2);
  assert.equal(aiCalls, 1);
  assert.equal(run.summary.failed.length, 2);
  assert.match(run.summary.failed[1].reason, /niet geprobeerd: Groq-limiet bereikt/);
  assert.equal(run.created.length, 0);
  assert.equal(run.pullRequest, null);
  assert.deepEqual(articles, []);
  assert.ok(records.every((r) => r.processingStatus !== 'verwerkt'));
  assert.ok(logs.some((l) => /Groq-limiet bereikt/.test(l)));
});

test('redactierun (Groq): twee onderwerpen → wachttijd tussen de twee AI-aanroepen; hooguit twee artikelen', async () => {
  const second = { ...RECORD, sourceUrl: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/06/tweede-bericht', title: 'Tweede bericht over loonheffingen voor werkgevers' };
  const contentDir = tempDir('content-spacing');
  const sourcesDir = tempDir('sources-spacing');
  for (const r of [RECORD, second]) writeSourceRecord(sourcesDir, r);
  const sleeps = [];
  let aiCalls = 0;
  try {
    const run = await runEditorialPipeline({
      contentDir, sourcesDir, now: NOW, apiKey: 'k', log: () => {},
      sleep: async (ms) => { sleeps.push(ms); },
      fetchImpl: async (url) => {
        if (isGroq(url)) { aiCalls += 1; return aiResponse(AI_INPUT); }
        return new Response('<html></html>', { status: 200 });
      },
    });
    assert.equal(run.summary.selected, 2);
    assert.ok(run.summary.selected <= MAX_TOPICS_PER_RUN);
    assert.equal(aiCalls, 2);
    assert.deepEqual(sleeps, [60000]);
    assert.ok(run.created.length >= 1 && run.created.length <= 2);
  } finally {
    rmSync(contentDir, { recursive: true, force: true });
    rmSync(sourcesDir, { recursive: true, force: true });
  }
});

// --- Regressie run #40: Groq HTTP 400 zonder foutmelding in de log ---
//
// Run #40 logde alleen "AI-aanroep mislukt (HTTP 400, model ...)". De
// request zelf is hieronder vastgelegd en vergeleken met de werkende
// AI-assistent (groq.ts); Groq's eigen foutmelding komt nu in de log.

const FAKE_KEY = 'gsk_testsleutelABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RUN40_RECORD = {
  ...RECORD,
  sourceName: 'KVK',
  sourceUrl: 'https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/',
  title: 'Jaarrekening wel of niet deponeren?',
  sourcePublishedAt: undefined,
  sourceLastModified: '2025-08-26T00:00:00.000Z',
  body: `${SOURCE_BODY}\n\n`.repeat(30).slice(0, 4701),
};
const RUN40_400_BODY = JSON.stringify({
  error: {
    message: 'Failed to call a function. Please adjust your prompt. See \'failed_generation\' for more details.',
    type: 'invalid_request_error',
    code: 'tool_use_failed',
    failed_generation: '{"name": "avydo_artikel", "arguments": {"title": "Jaarrekening',
  },
});

async function captureRequest(record, kind = 'gids') {
  let captured;
  await generateAvydoArticle(record, kind, {
    apiKey: FAKE_KEY, now: NOW,
    fetchImpl: async (url, opts) => { captured = { url, headers: opts.headers, body: JSON.parse(opts.body) }; return aiResponse(AI_INPUT); },
  });
  return captured;
}

test('regressie run #40: request-body heeft dezelfde vorm als de werkende AI-assistent (groq.ts)', async () => {
  const { url, headers, body } = await captureRequest(RUN40_RECORD);
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepEqual(Object.keys(headers).sort(), ['authorization', 'content-type']);
  assert.equal(headers['content-type'], 'application/json');
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'reasoning_effort', 'temperature', 'tool_choice', 'tools']);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.temperature, 0.3);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 3000);
  assert.deepEqual(body.messages.map((m) => Object.keys(m).sort()), [['content', 'role']]);
  assert.equal(typeof body.messages[0].content, 'string');
  assert.deepEqual(Object.keys(body.tools[0]).sort(), ['function', 'type']);
  assert.deepEqual(Object.keys(body.tools[0].function).sort(), ['description', 'name', 'parameters']);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: body.tools[0].function.name } });
  // Dezelfde velden en waarden als in de assistent.
  const groqTs = readFileSync(path.join(ROOT, 'src/lib/ai-providers/groq.ts'), 'utf8');
  for (const snippet of [
    "'https://api.groq.com/openai/v1/chat/completions'",
    'authorization: `Bearer ${apiKey}`',
    'temperature: 0.3',
    "reasoning_effort: 'low'",
    "type: 'function',",
    'parameters: tool.schema',
    "tool_choice: { type: 'function', function: { name: tool.name } }",
    "const DEFAULT_MODEL = 'openai/gpt-oss-20b'",
  ]) assert.ok(groqTs.includes(snippet), `groq.ts bevat niet meer: ${snippet}`);
});

test('regressie run #40: het artikelschema gebruikt alleen standaard JSON Schema-sleutelwoorden', async () => {
  const { body } = await captureRequest(RUN40_RECORD);
  const allowed = new Set(['type', 'properties', 'required', 'description', 'enum', 'items', 'maxItems']);
  const used = new Set();
  (function walk(schema) {
    for (const [key, value] of Object.entries(schema)) {
      used.add(key);
      if (key === 'properties') Object.values(value).forEach(walk);
      else if (key === 'items') walk(value);
    }
  })(body.tools[0].function.parameters);
  for (const key of used) assert.ok(allowed.has(key), `onverwacht schema-sleutelwoord ${key}`);
  for (const value of Object.values(body.tools[0].function.parameters.properties)) {
    const types = Array.isArray(value.type) ? value.type : [value.type];
    assert.ok(types.every((t) => ['string', 'boolean', 'array', 'null'].includes(t)));
    if (value.enum) assert.ok(value.enum.every((v) => typeof v === 'string' && v.length > 0));
  }
});

test('regressie run #40: request (volledige KVK-brontekst) plus max_tokens blijft onder Groq\'s 8.000 tokens/minuut', async () => {
  for (const record of [RUN40_RECORD, { ...RUN40_RECORD, body: 'x'.repeat(20000) }]) {
    const { body } = await captureRequest(record);
    assert.ok(body.messages[0].content.includes(record.body.slice(0, 9000)));
    assert.ok(estimateTokens(JSON.stringify(body)) + body.max_tokens < 8000);
  }
});

test('regressie run #40: HTTP 400 van Groq → geen artikel, maar wel Groq\'s eigen foutmelding (type, code, melding) in de reden en de log', async () => {
  const logs = [];
  const contentDir = tempDir('content-400');
  const sourcesDir = tempDir('sources-400');
  writeSourceRecord(sourcesDir, RECORD);
  try {
    const run = await runEditorialPipeline({
      contentDir, sourcesDir, now: NOW, apiKey: FAKE_KEY, log: (l) => logs.push(l), aiCallSpacingMs: 0,
      fetchImpl: async (url) => (isGroq(url)
        ? new Response(RUN40_400_BODY, { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req_01abc' } })
        : new Response('<html></html>', { status: 200 })),
    });
    assert.equal(run.created.length, 0);
    assert.equal(run.pullRequest, null);
    assert.deepEqual(readdirSync(contentDir), []);
    const reason = run.summary.failed[0].reason;
    assert.match(reason, /HTTP 400/);
    assert.match(reason, /type=invalid_request_error/);
    assert.match(reason, /code=tool_use_failed/);
    assert.match(reason, /melding: Failed to call a function/);
    assert.match(reason, /request-id=req_01abc/);
    assert.match(reason, /model "openai\/gpt-oss-20b"/);
    const text = logs.join('\n');
    assert.match(text, /geen artikel: AI-aanroep mislukt .*code=tool_use_failed/);
    assert.match(text, /Groq failed_generation \(ingekort\): \{"name": "avydo_artikel"/);
    assert.ok(!text.includes(FAKE_KEY));
    assert.ok(!JSON.stringify(run.summary).includes(FAKE_KEY));
  } finally {
    rmSync(contentDir, { recursive: true, force: true });
    rmSync(sourcesDir, { recursive: true, force: true });
  }
});

test('veilige foutlogging: de API-sleutel en Authorization-headers komen nooit in de reden of log, ook niet als Groq ze terugstuurt', async () => {
  const echo = JSON.stringify({ error: { message: `Invalid API Key ${FAKE_KEY} (Authorization: Bearer ${FAKE_KEY})`, type: 'invalid_request_error', code: 'invalid_api_key', failed_generation: `authorization: "Bearer ${FAKE_KEY}"` } });
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: FAKE_KEY, now: NOW, fetchImpl: async () => new Response(echo, { status: 401 }) });
  assert.equal(result.ok, false);
  const all = JSON.stringify(result);
  assert.ok(!all.includes(FAKE_KEY));
  assert.ok(!all.includes('gsk_'));
  assert.doesNotMatch(all, /Bearer (?!\[VERWIJDERD\])/);
  assert.match(result.reason, /HTTP 401/);
  assert.match(result.reason, /code=invalid_api_key/);
  // Ook een andere sleutelvorm dan gsk_ wordt verwijderd zodra die gelijk is aan de gebruikte sleutel.
  assert.equal(redactSecrets('sleutel geheim-12345678 hier', 'geheim-12345678'), 'sleutel [VERWIJDERD] hier');
  assert.equal(redactSecrets('Authorization: Bearer abc.def', undefined), 'Authorization: [VERWIJDERD]');
});

test('veilige foutlogging: niet-JSON-antwoord en lange antwoorden worden ingekort weergegeven; 429 houdt zijn limietgedrag', async () => {
  const plain = describeGroqError(400, '<html>Bad Request</html>');
  assert.equal(plain.summary, 'HTTP 400 antwoord: <html>Bad Request</html>');
  assert.equal(plain.failedGeneration, undefined);
  const long = describeGroqError(400, JSON.stringify({ error: { message: 'x'.repeat(5000), code: 'c', failed_generation: 'y'.repeat(5000) } }));
  assert.ok(long.summary.length <= 800);
  assert.ok(long.failedGeneration.length <= 1500);
  const limited = await generateAvydoArticle(RECORD, 'toelichting', {
    apiKey: FAKE_KEY, now: NOW,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached for model openai/gpt-oss-20b', type: 'tokens', code: 'rate_limit_exceeded' } }), { status: 429 }),
  });
  assert.equal(limited.rateLimited, true);
  assert.match(limited.reason, /HTTP 429 type=tokens code=rate_limit_exceeded melding: Rate limit reached/);
});

// --- Regressie run #41: "redenOnvoldoende": null werd door Groq afgewezen ---
//
// Groq valideert de gegenereerde tool-argumenten tegen het schema vóórdat
// wij ze zien. Run #41: "parameters for tool avydo_artikel did not match
// schema: errors: [`/redenOnvoldoende`: expected string, but got null]".
// Deze kleine validator dekt precies de sleutelwoorden die het schema mag
// gebruiken (zie de test "alleen standaard JSON Schema-sleutelwoorden").

function schemaErrors(schema, value, at = '') {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? 'number' : typeof v);
  if (types.length && !types.includes(typeOf(value))) {
    errors.push(`${at || '/'}: expected ${types.join(' or ')}, but got ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: value must be one of the enum values`);
  if (typeOf(value) === 'object' && schema.properties) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing property '${key}'`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties[key]) errors.push(...schemaErrors(schema.properties[key], v, `${at}/${key}`));
    }
  }
  if (typeOf(value) === 'array') {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => errors.push(...schemaErrors(schema.items, v, `${at}/${i}`)));
  }
  return errors;
}

async function articleSchema() {
  let schema;
  await generateAvydoArticle(RECORD, 'toelichting', {
    apiKey: 'k', now: NOW,
    fetchImpl: async (_url, opts) => { schema = JSON.parse(opts.body).tools[0].function.parameters; return aiResponse(AI_INPUT); },
  });
  return schema;
}

// Het argument uit run #41 (failed_generation), ingekort tot de schemavelden.
const RUN41_ARGUMENTS = {
  ...AI_INPUT,
  audiences: ['bv-dga', 'mkb-ondernemer', 'werkgever'],
  status: 'geen',
  category: 'Administratie & jaarrekening',
  redenOnvoldoende: null,
};

test('regressie run #41: de validator geeft exact Groq\'s fout op het oude schema (redenOnvoldoende alleen string)', async () => {
  const schema = await articleSchema();
  const oldSchema = { ...schema, properties: { ...schema.properties, redenOnvoldoende: { type: 'string' } } };
  assert.deepEqual(schemaErrors(oldSchema, RUN41_ARGUMENTS), ['/redenOnvoldoende: expected string, but got null']);
});

test('regressie run #41: voldoendeInformatie true + redenOnvoldoende null → schema geldig, artikel gaat door', async () => {
  const schema = await articleSchema();
  assert.deepEqual(schemaErrors(schema, RUN41_ARGUMENTS), []);
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse(RUN41_ARGUMENTS) });
  assert.equal(result.ok, true);
  assert.equal(result.article.category, 'Administratie & jaarrekening');
  assert.equal('redenOnvoldoende' in result.article, false);
});

test('schema: voldoendeInformatie true zonder redenOnvoldoende → geldig; normale artikelrespons blijft werken en doorstaat de validatie', async () => {
  const schema = await articleSchema();
  const { redenOnvoldoende, ...withoutReason } = RUN41_ARGUMENTS;
  assert.equal(redenOnvoldoende, null);
  assert.deepEqual(schemaErrors(schema, withoutReason), []);
  assert.deepEqual(schemaErrors(schema, AI_INPUT), []);
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse(AI_INPUT) });
  assert.equal(result.ok, true);
  assert.deepEqual(validateAvydoArticle(result.article, RECORD, VALID_CONTEXT).errors, []);
});

test('schema: voldoendeInformatie false + reden → geldig; de pipeline maakt geen artikel en neemt de reden over', async () => {
  const schema = await articleSchema();
  const insufficient = { ...AI_INPUT, voldoendeInformatie: false, redenOnvoldoende: 'De bron noemt alleen een verwijzing naar een formulier.' };
  assert.deepEqual(schemaErrors(schema, insufficient), []);
  const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse(insufficient) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bron bevat onvoldoende informatie: De bron noemt alleen een verwijzing naar een formulier.');
});

test('schema: voldoendeInformatie false zonder bruikbare reden (null, leeg of ontbrekend) → afgewezen, met expliciete melding', async () => {
  for (const reden of [null, '', '   ', undefined]) {
    const input = { ...AI_INPUT, voldoendeInformatie: false, redenOnvoldoende: reden };
    if (reden === undefined) delete input.redenOnvoldoende;
    const result = await generateAvydoArticle(RECORD, 'toelichting', { apiKey: 'k', now: NOW, fetchImpl: async () => aiResponse(input) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'bron bevat onvoldoende informatie (model gaf geen reden op)');
  }
  const { run, articles } = await runPipelineWith({ ...AI_INPUT, voldoendeInformatie: false, redenOnvoldoende: null });
  assert.equal(run.created.length, 0);
  assert.equal(run.pullRequest, null);
  assert.deepEqual(articles, []);
});

test('schema: alleen redenOnvoldoende mag null zijn; alle artikelvelden blijven verplicht en strikt getypeerd', async () => {
  const schema = await articleSchema();
  assert.deepEqual(schema.required, ['voldoendeInformatie', 'title', 'summary', 'body', 'relevance', 'status', 'category', 'audiences', 'tags']);
  const nullable = Object.entries(schema.properties).filter(([, v]) => Array.isArray(v.type) && v.type.includes('null')).map(([k]) => k);
  assert.deepEqual(nullable, ['redenOnvoldoende']);
  assert.deepEqual(schema.properties.redenOnvoldoende.type, ['string', 'null']);
  for (const field of schema.required) {
    const errors = schemaErrors(schema, { ...RUN41_ARGUMENTS, [field]: null });
    assert.ok(errors.some((e) => e.startsWith(`/${field}: expected`)), `${field} mag niet null zijn`);
    const { [field]: _omitted, ...missing } = RUN41_ARGUMENTS;
    assert.ok(schemaErrors(schema, missing).includes(`: missing property '${field}'`), `${field} moet verplicht blijven`);
  }
  assert.ok(schemaErrors(schema, { ...RUN41_ARGUMENTS, status: 'onzin' }).length > 0);
  assert.ok(schemaErrors(schema, { ...RUN41_ARGUMENTS, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).length > 0);
});

test('prompt: voldoendeInformatie is leidend; redenOnvoldoende alleen bij false, anders null', () => {
  const prompt = buildArticlePrompt(RECORD, 'toelichting', NOW);
  assert.match(prompt, /voldoendeInformatie is leidend/);
  assert.match(prompt, /zet voldoendeInformatie op false en geef in redenOnvoldoende kort aan waarom/);
  assert.match(prompt, /zet voldoendeInformatie op true en zet redenOnvoldoende op null/);
});
