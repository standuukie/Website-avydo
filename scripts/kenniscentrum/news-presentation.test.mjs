// Redactionele weergave van het Kenniscentrum (2026-10-07): sjabloon-duidingen
// niet tonen, één overzicht zonder scheiding tussen nieuws en naslag
// (2026-10-08), statusbadges en de Intermediairdagen uit de selectie.
// Sinds 2026-10-08 bestaat het Kenniscentrum uitsluitend uit Avydo-artikelen;
// de officiële bronnen staan in de bronlaag (src/content/bronnen/).
// Alles hier is weergave; de AI-context en -retrieval blijven ongewijzigd.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as presentation from '../../src/lib/news-presentation.mjs';
import {
  GENERIC_RELEVANCE_TEXTS,
  hasOwnRelevance,
  STATUS_LABELS,
  dateIsSourceLastModified,
} from '../../src/lib/news-presentation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(ROOT, 'src/content/kenniscentrum');
const SOURCES_DIR = path.join(ROOT, 'src/content/bronnen');
// Bronrecord met de (oude) slug van een artikel dat bij de omzetting is vervallen.
const recordForSlug = (file) => JSON.parse(readFileSync(path.join(SOURCES_DIR, file.replace(/\.md$/, '.json')), 'utf8'));

const ARTICLES = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const [, frontmatter = '', body = ''] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    const get = (key) => frontmatter.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
    return {
      file,
      body,
      title: get('title'),
      summary: get('summary'),
      relevance: get('relevance')?.replace(/\\"/g, '"'),
      sourceName: get('sourceName'),
      sourceUrl: get('sourceUrl'),
      status: get('status'),
      avydoContent: get('avydoContent'),
      hidden: get('hidden') === 'true',
      fetched: get('fetchedAt') != null,
      sourcePublishedAt: get('sourcePublishedAt'),
    };
  });
const ACTIVE = ARTICLES.filter((a) => !a.hidden);

// Het Kenniscentrum groeit: de dagelijkse redactiepipeline voegt nieuwe
// Avydo-artikelen toe. Controles op de inhoud van de contentmigratie van
// 2026-10-08 gaan daarom over die vaste set (de 68 behouden slugs uit de
// fixture), niet over het totaal. Alles daarbuiten is een nieuw
// pipeline-artikel, met eigen invarianten (zie hieronder).
const MIGRATION = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/kenniscentrum-slugs-2026-10-08.json'), 'utf8'));
const RETAINED = new Set(MIGRATION.retained.map((slug) => `${slug}.md`));
const MIGRATED = ARTICLES.filter((a) => RETAINED.has(a.file));
const MIGRATED_ACTIVE = MIGRATED.filter((a) => !a.hidden);
const NEW_ARTICLES = ARTICLES.filter((a) => !RETAINED.has(a.file));
const ACTIVE_RO = MIGRATED_ACTIVE.filter((a) => a.sourceName === 'Rijksoverheid');
// De handgeschreven gidsen van 2026-10-01. Geen frontmatterveld onderscheidt
// ze van een nieuw pipeline-artikel (beide zonder fetchedAt), dus expliciet.
const HAND_GUIDES = [
  '2026-10-01-box-3-hoe-wordt-uw-vermogen-belast.md',
  '2026-10-01-btw-aangifte-termijnen-tijdvakken-en-te-laat.md',
  '2026-10-01-de-jaarrekening-wat-zijn-uw-verplichtingen-als-ondernemer.md',
  '2026-10-01-dividend-uitkeren-uit-uw-bv-box-2-en-dividendbelasting.md',
  '2026-10-01-eenmanszaak-of-bv-wanneer-is-de-overstap-fiscaal-interessant.md',
  '2026-10-01-gebruikelijk-loon-hoeveel-salaris-moet-u-uzelf-als-dga-uitkeren.md',
  '2026-10-01-kleineondernemersregeling-kor-btw-vrijstelling.md',
  '2026-10-01-minimumloon-en-loonheffingen-verplichtingen-als-werkgever.md',
  '2026-10-01-ondernemersaftrek-welke-fiscale-aftrekposten-gelden-voor-u.md',
  '2026-10-01-rekening-courant-met-uw-bv-voorkom-een-belaste-onttrekking.md',
  '2026-10-01-vennootschapsbelasting-hoe-werkt-de-tariefopbouw-voor-uw-bv.md',
  '2026-10-01-werkkostenregeling-wkr-wat-mag-u-onbelast-vergoeden.md',
];
const byFile = (file) => {
  const article = ARTICLES.find((a) => a.file === file);
  assert.ok(article, `${file} ontbreekt in de content-map`);
  return article;
};

test('GENERIC_RELEVANCE_TEXTS: de sjablonen van de oude nieuwsengine blijven herkend (en worden in de validatie afgewezen)', () => {
  assert.equal(GENERIC_RELEVANCE_TEXTS.size, 9);
  const source = readFileSync(path.join(ROOT, 'scripts/kenniscentrum/fetch-articles.mjs'), 'utf8');
  assert.doesNotMatch(source, /RELEVANCE_TEMPLATES/, 'de import schrijft geen duiding meer');
  const validator = readFileSync(path.join(ROOT, 'scripts/kenniscentrum/validate-article.mjs'), 'utf8');
  assert.match(validator, /hasOwnRelevance\(relevance\)/);
});

test('hasOwnRelevance: sjablonen en lege teksten zijn geen eigen duiding', () => {
  for (const t of GENERIC_RELEVANCE_TEXTS) assert.equal(hasOwnRelevance(t), false);
  assert.equal(hasOwnRelevance(''), false);
  assert.equal(hasOwnRelevance(undefined), false);
  assert.equal(hasOwnRelevance('Belangrijk voor werkgevers: per 1 januari verandert de premie.'), true);
});

test('alle zichtbare artikelen hebben een eigen duiding (geen sjabloontekst)', () => {
  // Alle 68 artikelen uit de migratie zijn er nog en zichtbaar, waarvan 26 van Rijksoverheid.
  assert.equal(MIGRATION.retained.length, 68);
  assert.deepEqual(MIGRATED_ACTIVE.map((a) => a.file).sort(), [...RETAINED].sort());
  assert.equal(ACTIVE_RO.length, 26);
  // Elk zichtbaar artikel, ook een nieuw pipeline-artikel, heeft een eigen duiding.
  for (const a of ACTIVE) assert.ok(hasOwnRelevance(a.relevance), `${a.file}: geen eigen duiding`);
});

test('nieuwe artikelen (na de migratie) komen uit de redactiepipeline: Avydo-artikel met eigen duiding, tussenkoppen en officiële bron', () => {
  for (const a of NEW_ARTICLES) {
    assert.equal(MIGRATION.removed.includes(a.file.replace(/\.md$/, '')), false, `${a.file}: vervallen artikel is teruggekomen`);
    assert.match(a.file, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/, a.file);
    assert.ok(a.file.slice(0, 10) >= '2026-10-08', `${a.file}: ouder dan de migratie`);
    assert.equal(a.hidden, false, a.file);
    assert.equal(a.fetched, false, `${a.file}: een pipeline-artikel heeft geen fetchedAt`);
    assert.ok(['gids', 'toelichting'].includes(a.avydoContent), a.file);
    if (a.sourceName !== 'KVK') assert.equal(a.avydoContent, 'toelichting', a.file);
    assert.ok(hasOwnRelevance(a.relevance), a.file);
    assert.ok((a.body.match(/^## \S/gm) ?? []).length >= 2, `${a.file}: te weinig tussenkoppen`);
    assert.equal(HAND_GUIDES.includes(a.file), false, a.file);
  }
});

test('Avydo-model: elk artikel is een zichtbaar Avydo-artikel (avydoContent) met één officiële bron', () => {
  assert.equal(ARTICLES.filter((a) => a.hidden).length, 0, 'geen verborgen bronartikelen meer in de content-map');
  for (const a of ARTICLES) {
    assert.ok(['gids', 'toelichting'].includes(a.avydoContent), `${a.file}: geen avydoContent`);
    assert.ok(['Belastingdienst', 'Rijksoverheid', 'KVK'].includes(a.sourceName), a.file);
    assert.match(a.sourceUrl ?? '', /^https:\/\/www\.(belastingdienst|rijksoverheid|kvk)\.nl\//, a.file);
  }
});

test('Avydo-model: omgezette artikelen hebben een eigen tekst met tussenkoppen; nieuws van Belastingdienst/Rijksoverheid heeft een aparte brondatum', () => {
  for (const a of ACTIVE.filter((x) => x.fetched)) {
    assert.ok((a.body.match(/^## \S/gm) ?? []).length >= 2, `${a.file}: te weinig tussenkoppen`);
    assert.ok(a.body.trim().length > (a.summary ?? '').length * 1.3, `${a.file}: tekst is niet meer dan de samenvatting`);
    if (a.sourceName !== 'KVK') assert.ok(a.sourcePublishedAt, `${a.file}: sourcePublishedAt ontbreekt`);
  }
});

// 2026-10-08: het Kenniscentrum is één verzameling artikelen, zonder
// scheiding tussen nieuws en naslag in weergave of contentmodel.
test('één Kenniscentrum: geen scheiding tussen nieuws en naslag', () => {
  assert.deepEqual(Object.keys(presentation).sort(), [
    'GENERIC_RELEVANCE_TEXTS',
    'OUTDATED_STATUSES',
    'STATUS_LABELS',
    'dateIsSourceLastModified',
    'hasOwnRelevance',
  ]);

  const index = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/index.astro'), 'utf8');
  const card = readFileSync(path.join(ROOT, 'src/components/kenniscentrum/ArticleCard.astro'), 'utf8');
  const page = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/[...slug].astro'), 'utf8');
  for (const text of [index, card, page]) {
    assert.doesNotMatch(text, /data-kind|\bnaslag\b/i);
  }
  for (const pattern of [/newsArticles/, /DEFAULT_KIND/, /activeKind/, /kindExplicit/, /effectiveKind/, /matchesKind/, /'soort'/]) {
    assert.doesNotMatch(index, pattern);
  }
  assert.doesNotMatch(page, />Soort</);

  // Uitgelicht en de eerste reeks komen uit de volledige (zichtbare) collectie.
  assert.match(index, /getCollection\('kenniscentrum', \(\{ data \}\) => !data\.hidden\)/);
  assert.match(index, /pickHighlighted\(allArticles, 4\)/);
  assert.match(index, /allArticles\.slice\(0, INITIAL_VISIBLE\)/);
  assert.match(index, /\{allArticles\.map\(\(article\) =>/);

  // De overige filters, zoeken en "Toon meer" blijven bestaan.
  for (const pattern of [/data-category-filter/, /data-source-filter/, /data-audience-filter/, /id="kc-search"/, /id="kc-load-more"/]) {
    assert.match(index, pattern);
  }
  for (const param of ['categorie', 'bron', 'doelgroep', 'q']) {
    assert.match(index, new RegExp(`params\\.set\\('${param}'`));
  }

  // Contentmodel: elk frontmatterveld van elk artikel (ook verborgen) staat
  // in het schema; er blijven geen losse, niet-gebruikte velden achter.
  const config = readFileSync(path.join(ROOT, 'src/content/config.ts'), 'utf8');
  const schemaKeys = new Set([...config.matchAll(/^ {4}(\w+): z\./gm)].map((m) => m[1]));
  assert.ok(schemaKeys.has('sourceUrl') && schemaKeys.has('status'), 'schemavelden niet gevonden in config.ts');
  for (const file of readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))) {
    const frontmatter = readFileSync(path.join(CONTENT_DIR, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    for (const [, key] of frontmatter.matchAll(/^([A-Za-z]\w*):/gm)) {
      assert.ok(schemaKeys.has(key), `${file}: frontmatterveld "${key}" staat niet in het schema`);
    }
  }

  // De handgeschreven gidsen blijven gewoon artikelen in dezelfde verzameling.
  const handGuides = MIGRATED_ACTIVE.filter((a) => a.avydoContent === 'gids' && !a.fetched);
  assert.deepEqual(handGuides.map((a) => a.file).sort(), HAND_GUIDES);
  for (const file of HAND_GUIDES) assert.equal(byFile(file).hidden, false, file);
});

test('Intermediairdagen staan niet in het Kenniscentrum, maar blijven als afgewezen bron bestaan voor deduplicatie', () => {
  for (const file of [
    '2026-10-05-schrijf-u-nu-in-voor-de-intermediairdagen-2026.md',
    '2026-09-14-intermediairdagen-2026-belastingplan-2027-kennissessies-en-netwerkkansen.md',
  ]) {
    assert.equal(ARTICLES.some((a) => a.file === file), false, file);
    const record = recordForSlug(file);
    assert.equal(record.processingStatus, 'afgewezen', file);
    assert.match(record.sourceUrl ?? '', /^https:\/\//);
  }
  assert.ok(!ACTIVE.some((a) => /intermediairdagen/i.test(a.title ?? '')));
});

test('statuswaarden zijn geldig en staan op de bedoelde artikelen', () => {
  for (const a of ARTICLES.filter((x) => x.status)) {
    assert.ok(a.status in STATUS_LABELS, `${a.file}: onbekende status ${a.status}`);
  }
  const statusOf = (prefix) => ARTICLES.find((a) => a.file.startsWith(prefix))?.status;
  assert.equal(statusOf('2025-02-06-afschaffen-van-inhoudingen'), 'herzien');
  assert.equal(statusOf('2025-05-09-internetconsultatie-afschaffen'), 'herzien');
  assert.equal(statusOf('2025-09-12-wetsvoorstel-voor-basisverzekering'), 'historisch');
  assert.equal(statusOf('2025-07-07-wetsvoorstel-voor-meer-duidelijkheid'), 'deels-geschrapt');
  assert.equal(statusOf('2026-10-01-zelfstandigenwet'), 'consultatie');
  // Geverifieerd 2026-10-07: inmiddels aangenomen en van kracht.
  assert.equal(statusOf('2025-07-07-transacties-met-crypto'), 'van-kracht');
  assert.equal(statusOf('2025-04-25-kabinet-treft-maatregelen'), 'van-kracht');
  assert.equal(statusOf('2025-03-14-kabinet-stuurt-wetsvoorstel-tegenbewijsregeling'), 'van-kracht');
  // Huidige regel (van kracht) naast het voornemen om die per 2028 af te schaffen.
  assert.equal(statusOf('2025-10-30-regeling-voor-huisvestingskosten'), 'van-kracht');
  assert.equal(statusOf('2026-09-10-werkgever-mag-geen-huur'), 'voornemen');
  // Subsidie gesloten; Vbar-aanpassing ingehaald door het schrappen in maart 2026.
  assert.equal(statusOf('2025-09-29-subsidie-voor-mbk'), 'historisch');
  assert.equal(statusOf('2025-03-27-ondernemerschap-blijft'), 'historisch');
  // Wtta: door de Eerste Kamer aangenomen, in werking per 1 januari 2027.
  assert.equal(statusOf('2025-11-11-eerste-kamer-stemt-in'), 'aangenomen');
});

test('KVK-naslag ontdubbeld: doublures, video’s en tool-/dienstpagina’s zijn afgewezen bronnen, geen artikel', () => {
  const hiddenKvk = [
    '2026-09-29-ontdek-hoe-je-de-eu-kor-voor-je-webshop-gebruikt.md', // EU-KOR: gedekt door #17 en #16
    '2026-09-24-kleineondernemersregeling-kor-interessant-voor-jouw-bedrijf.md', // KOR: Avydo-gids
    '2026-09-15-wat-betekent-prinsjesdag-voor-jouw-bedrijf.md', // overzichtspagina; uitleg in #50
    '2026-08-28-hoe-werkt-btw-aangifte-omzetbelasting-voor-ondernemers.md', // btw-aangifte: Avydo-gids
    '2026-08-27-hoe-kies-ik-een-boekhoudpakket.md', // video; artikel #54 blijft
    '2026-03-17-belastingvrij-belonen-doe-je-met-de-wkr.md', // WKR: Avydo-gids
    '2026-03-03-hoe-zit-het-met-mijn-btw-nummer-als-ik-een-bedrijf-start.md', // video; #38 en #45 blijven
    '2026-02-19-welke-rechtsvorm-past-bij-jou.md', // keuzehulp (tool); #19 en gids blijven
    '2026-02-19-boekhouder-of-niet.md', // videoreeks; #33 blijft
    '2026-02-06-wat-je-moet-weten-over-vennootschapsbelasting.md', // Vpb: Avydo-gids
    '2025-11-26-controleer-je-jaarrekening.md', // dienstpagina deponeringscontrole
  ];
  for (const file of hiddenKvk) {
    assert.equal(ARTICLES.some((a) => a.file === file), false, file);
    const record = recordForSlug(file);
    assert.equal(record.processingStatus, 'afgewezen', file);
    assert.match(record.sourceUrl ?? '', /^https:\/\/www\.kvk\.nl\//, file);
  }
  // Behouden: verschillende vragen binnen hetzelfde onderwerp.
  for (const file of [
    '2026-08-26-wat-is-een-omzetbelastingnummer-ob-nummer.md',
    '2026-07-21-het-btw-nummer-btw-id-dit-moet-je-weten.md',
    '2026-07-22-een-btw-nummer-opzoeken-hoe-doe-ik-dat.md',
    '2026-03-10-waarom-is-mijn-btw-id-volgens-vies-ongeldig.md',
    '2026-09-25-eenmanszaak-of-bv-zo-kies-je-je-rechtsvorm.md',
    '2026-10-01-wet-dba-voorkom-schijnzelfstandigheid.md',
    '2026-04-24-zzp-er-inhuren-binnen-de-wet-dba.md',
    '2025-03-31-kvk-opstelportaal-voor-middelgroot-verdwijnt.md',
  ]) {
    assert.equal(byFile(file).hidden, false, file);
  }
  // Handgeschreven Avydo-gidsen blijven allemaal zichtbaar; uit de migratie
  // blijven van KVK 26 omgezette artikelen en 1 handgeschreven gids over.
  // Nieuwe KVK-artikelen uit de redactiepipeline tellen hier niet mee.
  assert.deepEqual(MIGRATED_ACTIVE.filter((a) => a.avydoContent === 'gids' && !a.fetched).map((a) => a.file).sort(), HAND_GUIDES);
  const migratedKvk = MIGRATED_ACTIVE.filter((a) => a.sourceName === 'KVK');
  assert.equal(migratedKvk.length, 27);
  assert.deepEqual(migratedKvk.filter((a) => !a.fetched).map((a) => a.file), ['2026-10-01-de-jaarrekening-wat-zijn-uw-verplichtingen-als-ondernemer.md']);
});

test('ongeschikte artikelen zijn geen artikel meer, maar een afgewezen bron (sourceUrl blijft voor deduplicatie)', () => {
  for (const prefix of [
    '2026-08-18-geen-verzuimboete-minimumbelasting', '2026-08-18-bent-u-cryptodienstverlener',
    '2026-08-03-begin-augustus-herinneren', '2026-07-09-handboek-milieubelastingen',
    '2026-06-30-voorkom-dubbele-accijns', '2026-05-08-zo-bepaal-je-de-juiste-douanewaarde',
    '2026-04-02-zo-check-je-hoe-je-zakenrelatie', '2026-03-03-deponeren.md',
    '2026-02-24-handleiding-waardering-van-verpachte', '2026-01-29-kvk-prinsjesdag-2025',
    '2026-01-02-landelijke-landbouwnormen', '2025-12-03-vanaf-1-januari-2026-btwwft',
    '2025-06-24-drijvende-huizen', '2025-01-07-fusie-splitsing', '2024-01-22-goederen-inklaren',
  ]) {
    assert.equal(ARTICLES.some((a) => a.file.startsWith(prefix)), false, prefix);
    const records = readdirSync(SOURCES_DIR).filter((f) => f.startsWith(prefix.replace(/\.md$/, '')));
    assert.equal(records.length, 1, prefix);
    const record = recordForSlug(records[0]);
    assert.equal(record.processingStatus, 'afgewezen', prefix);
    assert.match(record.sourceUrl ?? '', /^https:\/\//, prefix);
  }
  // Nog actueel volgens KVK (portaal verdwijnt "binnenkort"): blijft zichtbaar.
  assert.equal(byFile('2025-03-31-kvk-opstelportaal-voor-middelgroot-verdwijnt.md').hidden, false);
});

test('eigen Avydo-content (migratie): 12 handgeschreven gidsen en 56 artikelen op basis van een opgehaald bronbericht (55 omgezet in oktober 2026, 1 eerdere toelichting)', () => {
  const handGuides = MIGRATED.filter((a) => !a.fetched);
  assert.deepEqual(handGuides.map((a) => a.file).sort(), HAND_GUIDES);
  for (const a of handGuides) assert.equal(a.avydoContent, 'gids', a.file);
  const fromSource = MIGRATED.filter((a) => a.fetched);
  assert.equal(fromSource.length, 56);
  // Een opgehaald bronbericht (fetchedAt) komt alleen uit de migratie; de
  // redactiepipeline schrijft geen fetchedAt.
  assert.deepEqual(ARTICLES.filter((a) => a.fetched).map((a) => a.file).sort(), fromSource.map((a) => a.file).sort());
  assert.ok(fromSource.some((a) => a.file === '2026-09-15-belastingplan-2027-op-rijksoverheid-nl-staan-de-voorgestelde-veranderingen.md'));
  // Nieuws en (aangekondigde) wijzigingen zijn een toelichting; blijvende uitleg is een gids.
  for (const a of fromSource.filter((x) => x.sourceName !== 'KVK')) assert.equal(a.avydoContent, 'toelichting', a.file);
});

test('datumweergave: een KVK-sitemapdatum wordt als "bron bijgewerkt" getoond, niet als publicatiedatum; Avydo- en brondatum apart', () => {
  // Omgezet KVK-artikel: datum is de lastmod van de bronpagina.
  assert.equal(dateIsSourceLastModified({ sourceName: 'KVK', fetchedAt: '2026-10-01', avydoContent: 'gids' }), true);
  // Handgeschreven gids en nieuw Avydo-artikel (geen fetchedAt): eigen datum.
  assert.equal(dateIsSourceLastModified({ sourceName: 'KVK', fetchedAt: undefined, avydoContent: 'gids' }), false);
  assert.equal(dateIsSourceLastModified({ sourceName: 'KVK', fetchedAt: '2026-10-01', sourcePublishedAt: '2026-09-01' }), false);
  assert.equal(dateIsSourceLastModified({ sourceName: 'Belastingdienst', fetchedAt: '2026-10-01' }), false);
  assert.equal(dateIsSourceLastModified({ sourceName: 'Rijksoverheid', fetchedAt: '2026-10-01' }), false);
  const page = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/[...slug].astro'), 'utf8');
  assert.match(page, /Deze gids is geschreven door Avydo/);
  assert.match(page, /Deze toelichting is geschreven door Avydo/);
  assert.match(page, /voor het laatst bijgewerkt op/);
  assert.match(page, />Auteur</);
  assert.match(page, /Datum bronbericht/);
  assert.match(page, /showAvydoDate/);
});

test('geen achterhaalde relatieve tijdsaanduidingen in Rijksoverheid-samenvattingen', () => {
  for (const a of ACTIVE_RO) {
    assert.doesNotMatch(a.summary ?? '', /\b(vandaag|gisteren|morgen)\b/i, a.file);
  }
});

test('de Zelfstandigenwet-toelichting heeft eigen tussenkoppen en noemt de status', () => {
  const a = ACTIVE_RO.find((x) => x.file.startsWith('2026-10-01-zelfstandigenwet'));
  const headings = [...a.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.ok(headings.includes('Wat is de status?'), headings.join(' | '));
  assert.match(a.body, /internetconsultatie/);
  assert.match(a.body, /nog geen geldende wet/);
});

test('weergave: geen sjabloonduiding, geen dubbele samenvatting en een juiste bronvermelding', () => {
  const card = readFileSync(path.join(ROOT, 'src/components/kenniscentrum/ArticleCard.astro'), 'utf8');
  assert.match(card, /showRelevance &&/);
  assert.match(card, /Door Avydo &middot; bron: \{sourceName\}/);
  assert.doesNotMatch(card, /avydoContent \?/);
  const page = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/[...slug].astro'), 'utf8');
  assert.match(page, /\{showRelevance && \(/);
  // Geen weergave meer die suggereert dat de pagina de originele brontekst is.
  assert.doesNotMatch(page, /Brontekst|showSourceText|sourceBodyBlocks/);
  assert.match(page, /niet de tekst van de bron zelf/);
  assert.match(page, /data-outdated-notice/);
  assert.match(page, /data-source-block/);
  const index = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/index.astro'), 'utf8');
  assert.match(index, /pickHighlighted\(allArticles/);
  assert.doesNotMatch(index, /korte, eigen uitleg/);
  for (const text of [card, page, index]) {
    assert.doesNotMatch(text, />[^<{]*\b(je|jij|jou|jouw)\b[^<]*</i, 'UI-tekst in je-vorm');
  }
});

// Redactionele verbeteringsronde (2026-10-08) na de kwaliteitsaudit.
test('redactie: geen los zichtbare HTML-entiteiten en geen afgekapte samenvattingen in zichtbare artikelen', () => {
  for (const file of readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    if (/^hidden: true$/m.test(text)) continue;
    assert.doesNotMatch(text, /&(?:[a-zA-Z]+|#x?[0-9a-fA-F]+);/, file);
    const summary = text.match(/^summary: "(.*)"$/m)?.[1] ?? '';
    assert.doesNotMatch(summary, /(…|\.\.\.)$/, file);
  }
});

test('redactie: status, titel, prioriteit en categorie sluiten aan op de audit', () => {
  const get = (file, key) => readFileSync(path.join(CONTENT_DIR, file), 'utf8').match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
  assert.match(get('2026-10-01-zelfstandigenwet-biedt-meer-duidelijkheid-en-erkenning-voor-zzp-ers.md', 'relevance'), /reageren kan tot en met 29 oktober/);
  assert.doesNotMatch(get('2025-07-07-transacties-met-crypto-straks-meer-in-beeld-bij-belastingdienst.md', 'title'), /straks/);
  assert.doesNotMatch(get('2025-03-14-kabinet-stuurt-wetsvoorstel-tegenbewijsregeling-box-3-naar-tweede-kamer.md', 'title'), /wetsvoorstel|Tweede Kamer/);
  for (const file of [
    '2026-09-23-je-bv-en-prinsjesdag-dit-zijn-de-belastingplannen.md',
    '2026-09-16-prinsjesdag-2026-dit-verandert-er-voor-ondernemers.md',
    '2026-07-06-dit-is-waarom-prinsjesdag-belangrijk-is.md',
  ]) {
    assert.notEqual(get(file, 'priority'), 'belangrijk', file);
  }
  assert.equal(get('2026-09-28-inzicht-in-de-belastingtarieven-en-cijfers-van-2026.md', 'category'), 'Fiscale actualiteit');
  for (const file of [
    '2026-09-08-zakelijke-post-alleen-digitaal-ontvangen-geef-nu-uw-keuze-door.md',
    '2026-08-28-update-herstel-belastingrente-vennootschapsbelasting-massaal-bezwaar-gestart.md',
    '2026-05-21-bestelauto-met-ondernemerstarief-en-vrachtauto-s-sinds-1-juli-2026-tijdelijk-min.md',
    '2025-03-31-kvk-opstelportaal-voor-middelgroot-verdwijnt.md',
  ]) {
    assert.equal(hasOwnRelevance(get(file, 'relevance')), true, file);
  }
});

test('redactie: interne links in artikelteksten verwijzen naar zichtbare artikelen', () => {
  const visible = new Set(ACTIVE.map((a) => a.file.replace(/\.md$/, '')));
  let links = 0;
  for (const a of ACTIVE) {
    for (const [, slug] of a.body.matchAll(/\]\(\/kenniscentrum\/([^)#?]+)\)/g)) {
      links += 1;
      assert.ok(visible.has(slug), `${a.file} → ${slug}`);
    }
  }
  assert.ok(links >= 2);
  const box3 = byFile('2026-10-01-box-3-hoe-wordt-uw-vermogen-belast.md');
  assert.match(box3.body, /\/kenniscentrum\/2025-03-14-kabinet-stuurt-wetsvoorstel-tegenbewijsregeling-box-3-naar-tweede-kamer/);
});
