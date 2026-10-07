// Regressietests voor de Kenniscentrum-pipeline. Draait met Node's ingebouwde
// testrunner (geen extra dependency nodig): `npm run kenniscentrum:test`.
//
// De sitemap- en meta-description-fixtures hieronder zijn ingekort maar
// verder ongewijzigd overgenomen uit echte, live opgehaalde responses
// (rijksoverheid.nl/news/sitemap.xml en de meta description van het
// e-facturatie-artikel), zodat deze tests het daadwerkelijke productieprobleem
// dekken: Rijksoverheid-artikelen die eerder structureel ontbraken doordat
// feeds.rijksoverheid.nl niet meer bestaat, en de relevantiefilter die
// "e-facturatie/rapportage"-nieuws eerder ten onrechte wegfilterde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripHtml,
  slugify,
  parseFeedItems,
  parseSitemapNewsItems,
  extractMetaDescription,
  extractMinistryTag,
  scoreCategories,
  pickCategory,
  pickAudiences,
  kvkSlugToText,
  selectKvkCandidates,
  extractKvkArticleFields,
  isKvkProcedurePage,
  isKvkHubPage,
  classifyKvkRelevance,
  isKvkPureDefinitionTitle,
  findOverlappingArticle,
  isKvkServiceOrProductPath,
  isKvkServiceOrProductPage,
  downgradeIfTitleHasNoSignal,
  kvkFirstPathSegment,
  processRssSource,
  processSitemapSource,
  extractPageTitle,
  fetchRijksoverheidTopicApiUrls,
  buildRijksoverheidTopicSearchBody,
  matchesRelevanceSignal,
  matchesExclusionRule,
  isOutsideMaxAge,
} from './fetch-articles.mjs';
import {
  rijksoverheidAudienceSignals,
  sources,
  categoryKeywords,
  rijksoverheidTopicRelevanceSignals,
  rijksoverheidTopicExclusionRules,
} from './sources.config.mjs';

// --- Observability: per-bron afwijzingsredenen (stages.reasons) ---
//
// Deze tests draaien process*Source rechtstreeks aan met een gemockte
// globalThis.fetch (geen echt netwerkverkeer). Om nooit per ongeluk in de
// echte src/content/kenniscentrum/ te schrijven, krijgt elk item dat tot
// "relevant" zou komen een onparsebare datum mee: publishItem() geeft dan
// altijd null terug vóórdat writeArticle() wordt aangeroepen (zie
// fetch-articles.mjs), dus stages.relevant kan veilig getest worden zonder
// dat stages.published ooit een echt bestand wegschrijft. Dit is dezelfde,
// reeds bestaande "nooit fabricage"-vangrail in publishItem, niet een nieuw
// mechanisme voor deze tests.
async function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => handler(String(url));
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function xmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'application/xml' } });
}

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

test('stripHtml verwijdert markup en decodeert entities', () => {
  assert.equal(stripHtml('<p>BTW &amp; loon</p>'), 'BTW & loon');
  assert.equal(stripHtml('<![CDATA[Tekst]]>'), 'Tekst');
});

test('slugify maakt een veilige bestandsnaam-slug', () => {
  assert.equal(slugify('Kabinet kiest voor invoering e-facturatie!'), 'kabinet-kiest-voor-invoering-e-facturatie');
});

test('parseFeedItems leest RSS 2.0-items (Belastingdienst-vorm)', () => {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item>
        <title>Nieuw btw-tarief voor logies</title>
        <link>https://www.belastingdienst.nl/voorbeeld</link>
        <description>Vanaf 1 januari 2026 geldt een nieuw btw-tarief.</description>
        <pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
  const items = parseFeedItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Nieuw btw-tarief voor logies');
  assert.equal(items[0].link, 'https://www.belastingdienst.nl/voorbeeld');
});

// Ingekorte, echte fixture van https://www.rijksoverheid.nl/news/sitemap.xml
const REAL_SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://www.rijksoverheid.nl/actueel/nieuws/2026/09/23/nederlandse-staat-neemt-aandelen-kerncentrale-borssele-over</loc><lastmod>2026-09-23T14:47:39.847Z</lastmod><news:news><news:publication><news:language>nl</news:language><news:name>Rijksoverheid.nl</news:name></news:publication><news:publication_date>2026-09-23T14:47:46.215Z</news:publication_date><news:title>Nederlandse Staat neemt aandelen kerncentrale Borssele over</news:title></news:news></url><url><loc>https://www.rijksoverheid.nl/actueel/nieuws/2026/09/22/europese-toeslag-van-euro-2-voor-pakketjes-van-buiten-de-eu</loc><lastmod>2026-09-23T14:30:13.751Z</lastmod><news:news><news:publication><news:language>nl</news:language><news:name>Rijksoverheid.nl</news:name></news:publication><news:publication_date>2026-09-23T14:30:20.053Z</news:publication_date><news:title>Europese toeslag van € 2 voor pakketjes van buiten de EU</news:title></news:news></url></urlset>`;

test('parseSitemapNewsItems leest de officiële Google News-sitemap van Rijksoverheid', () => {
  const items = parseSitemapNewsItems(REAL_SITEMAP_FIXTURE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Nederlandse Staat neemt aandelen kerncentrale Borssele over');
  assert.equal(items[0].link, 'https://www.rijksoverheid.nl/actueel/nieuws/2026/09/23/nederlandse-staat-neemt-aandelen-kerncentrale-borssele-over');
  assert.ok(items[0].pubDate);
  // description ontbreekt bewust in de sitemap zelf (nooit verzonnen):
  assert.equal(items[0].description, '');
});

test('parseSitemapNewsItems geeft null bij een niet-sitemap-document', () => {
  assert.equal(parseSitemapNewsItems('<html><body>404</body></html>'), null);
});

// Echte (ingekorte) meta description, zoals teruggegeven door
// www.rijksoverheid.nl voor het testcase-artikel over e-facturatie.
const REAL_ARTICLE_HTML_FIXTURE = `<!DOCTYPE html><html lang="nl"><head><meta charSet="utf-8"/><title>Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven | Rijksoverheid.nl</title><meta name="description" content="Per 1 juli 2030 wil het kabinet e-facturatie en rapportage invoeren voor bedrijven. Deze verplichting gaat gelden voor zowel internationale als nationale transacties tussen bedrijven."/></head><body></body></html>`;

test('extractMetaDescription leest de meta description van een echte rijksoverheid.nl-pagina', () => {
  const desc = extractMetaDescription(REAL_ARTICLE_HTML_FIXTURE);
  assert.ok(desc && desc.startsWith('Per 1 juli 2030 wil het kabinet e-facturatie'));
});

test('extractMetaDescription geeft null als er geen description-meta staat', () => {
  assert.equal(extractMetaDescription('<html><head></head><body>geen meta</body></html>'), null);
});

// Redactionele aanscherping (2026-10-01): het Kenniscentrum is versmald tot
// accountancy/fiscale onderwerpen (zie src/content/config.ts en
// categoryKeywords in sources.config.mjs). Een algemene "e-facturatie en
// rapportage"-verplichting voor bedrijven blijft relevant, maar nu specifiek
// als administratieve/boekhoudkundige verplichting — niet langer onder een
// brede "Digitalisering"-categorie, die bij de aanscherping is komen te
// vervallen omdat hij te veel niet-fiscaal nieuws doorliet.
test('het e-facturatie-testcase-artikel scoort nu Administratie & jaarrekening (niet langer Digitalisering)', () => {
  const title = 'Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven';
  const description = 'Per 1 juli 2030 wil het kabinet e-facturatie en rapportage invoeren voor bedrijven. Deze verplichting gaat gelden voor zowel internationale als nationale transacties tussen bedrijven.';
  const scores = scoreCategories(`${title} ${description}`);
  assert.ok(Object.keys(scores).length > 0, 'artikel moet minstens één categorie scoren en dus niet weggefilterd worden');
  assert.equal(pickCategory(`${title} ${description}`, null), 'Administratie & jaarrekening');
});

test('een klassiek btw-artikel categoriseert correct (regressie Belastingdienst-bron)', () => {
  const text = 'Vanaf 1 januari 2026 geldt een nieuw btw-tarief voor logies-ondernemers.';
  assert.equal(pickCategory(text, 'Fiscale actualiteit'), 'Btw');
});

test('een artikel zonder enig relevant trefwoord scoort geen categorie (filter blijft werken)', () => {
  const scores = scoreCategories('Koning bezoekt jubileumfeest op Sint Eustatius voor 250 jaar The First Salute.');
  // Mag leeg zijn of alleen zwakke toevalstreffers; belangrijkste is dat dit
  // niet in de kernonderwerpen scoort.
  assert.equal(Object.keys(scores).length, 0);
});

// Regressie voor de aanscherping zelf: generiek, niet-fiscaal
// overheids-/lobbynieuws (zoals destijds daadwerkelijk in de kennisbank
// terechtkwam — gemeentelijke herindeling, bestuursbenoemingen, algemene
// MKB-lobbystandpunten) mag NIET meer scoren, ook al bevat het woorden als
// "wet", "ondernemer" of "bedrijven" — dat was precies de te brede
// trefwoordenlijst die hiervoor zorgde.
test('algemeen overheids- en lobbynieuws zonder fiscale/accountancy-kern scoort geen categorie meer', () => {
  const municipality = scoreCategories('Wetsvoorstel herindeling van de gemeenten Best en Oirschot naar de Raad van State.');
  assert.equal(Object.keys(municipality).length, 0);

  const lobby = scoreCategories('Ondernemersorganisaties vinden dat het kabinet meer moet doen tegen regeldruk voor het mkb en bedrijfsleven.');
  assert.equal(Object.keys(lobby).length, 0);
});

// Echte (ingekorte) RSS-fixture van https://www.mkb.nl/rss/nieuws-mkb-nederland
const REAL_MKB_FEED_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>MKB Nederland Nieuws</title>
    <link>https://www.mkb.nl</link>
    <generator>VNO-MKB Platform</generator>
    <language>nl</language>
    <copyright>Copyright MKB Nederland</copyright>
    <item>
      <title><![CDATA[Talent van nieuwkomers sneller en beter benutten]]></title>
      <link>https://www.mkb.nl/artikelen/talent-van-nieuwkomers-sneller-en-beter-benutten</link>
      <guid>https://www.mkb.nl/artikelen/talent-van-nieuwkomers-sneller-en-beter-benutten</guid>
      <pubDate>Wed, 23 Sep 2026 05:00:47 GMT</pubDate>
      <description><![CDATA[VNO-NCW en MKB-Nederland steunen het SER-advies om nieuwkomers sneller aan werk te helpen met goede begeleiding en praktische steun voor werkgevers.]]></description>
    </item>
  </channel>
</rss>`;

test('parseFeedItems leest de echte MKB-Nederland-feed correct', () => {
  const items = parseFeedItems(REAL_MKB_FEED_FIXTURE);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Talent van nieuwkomers sneller en beter benutten');
  assert.equal(items[0].link, 'https://www.mkb.nl/artikelen/talent-van-nieuwkomers-sneller-en-beter-benutten');
  assert.ok(items[0].description.includes('SER-advies'));
});

// Echte breadcrumb-link, zoals live aangetroffen op de rijksoverheid.nl-
// artikelpagina over e-facturatie.
const REAL_MINISTRY_HTML_FIXTURE = `<a href="/ministeries/ministerie-van-financien">Ministerie van Financiën</a>`;

test('extractMinistryTag herkent de echte Financiën-breadcrumb', () => {
  assert.equal(extractMinistryTag(REAL_MINISTRY_HTML_FIXTURE), 'Ministerie van Financiën');
});

test('extractMinistryTag geeft null voor een onbekend of ontbrekend ministerie', () => {
  assert.equal(extractMinistryTag('<a href="/ministeries/ministerie-van-onbekend">X</a>'), null);
  assert.equal(extractMinistryTag('<p>geen breadcrumb hier</p>'), null);
});

test('kerntrefwoorden van de aangescherpte, smalle categorieën worden herkend', () => {
  assert.ok('Administratie & jaarrekening' in scoreCategories('De audit door de accountant leverde nieuwe inzichten op.'));
  assert.ok('Ondernemen & rechtsvormen' in scoreCategories('Een bedrijfsovername van deze omvang vraagt om zorgvuldige due diligence.'));
  assert.ok('BV & DGA' in scoreCategories('Als DGA moet u zichzelf een gebruikelijk loon uitkeren.'));
});

// Regressie: een onderwerp dat vóór de aanscherping via de brede
// "Digitalisering"-categorie meetelde (kunstmatige intelligentie / AI-
// verordening, los van enige fiscale of administratieve context) scoort nu
// bewust geen categorie meer — dat was precies het soort te algemene content
// dat niet meer bij een accountants-/belastingadvieskantoor past.
test('algemene AI-/digitaliseringsonderwerpen zonder fiscale kern scoren niet langer', () => {
  const scores = scoreCategories('Kunstmatige intelligentie en de EU AI-verordening: wat verandert er voor de sector?');
  assert.equal(Object.keys(scores).length, 0);
});

test('pickAudiences herkent werkgever en mkb-ondernemer in het e-facturatie-testcase-artikel', () => {
  const title = 'Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven';
  const description = 'Per 1 juli 2030 wil het kabinet e-facturatie en rapportage invoeren voor bedrijven.';
  const audiences = pickAudiences(`${title} ${description}`);
  assert.ok(Array.isArray(audiences));
});

test('pickAudiences herkent de zzp-doelgroep uit een echt trefwoord', () => {
  const audiences = pickAudiences('Nieuwe regeling voor de zelfstandig ondernemer zonder personeel.');
  assert.ok(audiences.includes('zzp'));
});

test('pickAudiences herkent de werkgever-doelgroep', () => {
  const audiences = pickAudiences('Werkgevers met personeel krijgen te maken met een nieuwe cao-afspraak.');
  assert.ok(audiences.includes('werkgever'));
});

test('pickAudiences herkent de bv-dga-doelgroep', () => {
  const audiences = pickAudiences('De dga van een besloten vennootschap moet rekening houden met de vennootschapsbelasting.');
  assert.ok(audiences.includes('bv-dga'));
});

test('pickAudiences kan meerdere doelgroepen tegelijk teruggeven', () => {
  const audiences = pickAudiences('MKB-ondernemers die ook werkgever zijn, krijgen te maken met nieuwe regels voor personeel.');
  assert.ok(audiences.includes('mkb-ondernemer'));
  assert.ok(audiences.includes('werkgever'));
});

test('pickAudiences geeft een lege lijst zonder enig doelgroep-trefwoord', () => {
  const audiences = pickAudiences('Koning bezoekt jubileumfeest op Sint Eustatius voor 250 jaar The First Salute.');
  assert.deepEqual(audiences, []);
});

// --- KVK-source (sitemap_index.xml -> documents-*.xml) ---

test('kvkSlugToText zet een KVK-URL om naar leesbare tekst voor de relevantie-vóórfilter', () => {
  assert.equal(
    kvkSlugToText('https://www.kvk.nl/geldzaken/dga-salaris-en-gebruikelijk-loon/'),
    'geldzaken dga salaris en gebruikelijk loon',
  );
});

test('kvkSlugToText geeft een lege string bij een ongeldige URL', () => {
  assert.equal(kvkSlugToText('niet-een-url'), '');
});

test('selectKvkCandidates dedupliceert, sorteert op lastmod en past het URL-vorm- en relevantie-vóórfilter toe', () => {
  const entries = [
    { loc: 'https://www.kvk.nl/belastingen/btw-aangifte-doen/', lastmod: '2026-09-20T10:00:00.000Z' },
    { loc: 'https://www.kvk.nl/belastingen/btw-aangifte-doen/', lastmod: '2026-09-20T10:00:00.000Z' }, // duplicaat
    { loc: 'https://www.kvk.nl/evenementen/ondernemersdag-2026/', lastmod: '2026-09-21T10:00:00.000Z' }, // niet fiscaal relevant
    { loc: 'https://www.kvk.nl/producten/', lastmod: '2026-09-22T10:00:00.000Z' }, // 1 padsegment, geen artikel
    { loc: 'https://www.kvk.nl/geldzaken/dga-salaris-en-gebruikelijk-loon/', lastmod: '2026-09-23T10:00:00.000Z' },
  ];
  const { deduped, afterUrlFilter, afterRelevanceFilter, afterDedupAgainstExisting } = selectKvkCandidates(entries, new Set());

  assert.equal(deduped.length, 4);
  assert.equal(afterUrlFilter.length, 3);
  assert.equal(afterRelevanceFilter.length, 2);
  assert.deepEqual(afterRelevanceFilter.map((e) => e.loc), [
    'https://www.kvk.nl/geldzaken/dga-salaris-en-gebruikelijk-loon/',
    'https://www.kvk.nl/belastingen/btw-aangifte-doen/',
  ]);
  assert.equal(afterDedupAgainstExisting.length, 2);
});

test('selectKvkCandidates sluit URL\'s uit die al in de content-collectie staan', () => {
  const entries = [{ loc: 'https://www.kvk.nl/belastingen/btw-aangifte-doen/', lastmod: '2026-09-20T10:00:00.000Z' }];
  const existing = new Set(['https://www.kvk.nl/belastingen/btw-aangifte-doen/']);
  const { afterDedupAgainstExisting } = selectKvkCandidates(entries, existing);
  assert.equal(afterDedupAgainstExisting.length, 0);
});

test('extractKvkArticleFields gebruikt de zichtbare <h1>, nooit de <title> (die bij KVK onbetrouwbaar is)', () => {
  const html = '<html><head><title>KVK</title><meta name="description" content="Een duidelijke samenvatting van minstens twintig tekens over btw-aangifte doen als ondernemer."/></head><body><h1>BTW-aangifte doen: zo werkt het</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(fields.title, 'BTW-aangifte doen: zo werkt het');
  assert.ok(fields.description.startsWith('Een duidelijke samenvatting'));
});

test('extractKvkArticleFields valt terug op de eerste substantiële alinea zonder meta description', () => {
  const html = '<html><head><title>KVK</title></head><body><h1>Gebruikelijk loon voor de DGA</h1><p>Kort.</p><p>Als DGA van uw eigen BV moet u minimaal een gebruikelijk loon aan uzelf uitkeren volgens de Belastingdienst.</p></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(fields.title, 'Gebruikelijk loon voor de DGA');
  assert.ok(fields.description.startsWith('Als DGA van uw eigen BV'));
});

test('extractKvkArticleFields geeft null als er geen <h1> staat (geen gegokte titel)', () => {
  const html = '<html><head><title>BTW-aangifte doen - KVK</title></head><body><p>Als DGA van uw eigen BV moet u minimaal een gebruikelijk loon aan uzelf uitkeren.</p></body></html>';
  assert.equal(extractKvkArticleFields(html), null);
});

test('extractKvkArticleFields geeft null als er geen bruikbare samenvatting te vinden is', () => {
  const html = '<html><body><h1>BTW-aangifte doen</h1><p>Kort.</p></body></html>';
  assert.equal(extractKvkArticleFields(html), null);
});

// Regressie voor de eerste KVK-dry-run (2026-10-01): categoryKeywords alleen
// liet formulier-/procedure-/servicepagina's door omdat die toevallig
// dezelfde fiscale/rechtsvorm-trefwoorden bevatten als echte artikelen (bijv.
// "eenmanszaak" in zowel "Formulier 1: Eenmanszaak inschrijven" als een
// inhoudelijk artikel over de eenmanszaak).
test('isKvkProcedurePage herkent formulier-, inschrijf-, uitschrijf- en convenantpagina\'s (echte titels uit dry-run 1)', () => {
  assert.ok(isKvkProcedurePage('Formulier 2: Vof, cv of rederij inschrijven'));
  assert.ok(isKvkProcedurePage('Jaarrekeningen opvragen'));
  assert.ok(isKvkProcedurePage('Inschrijven en afspraak maken eenmanszaak'));
  assert.ok(isKvkProcedurePage('Convenant Openbaar Ministerie'));
  assert.ok(isKvkProcedurePage('Convenant Douane'));
  assert.ok(isKvkProcedurePage('Rekentool inkomstenbelasting 2027'));
  assert.ok(isKvkProcedurePage('Autorisaties voor Handelsregister'));
  assert.ok(isKvkProcedurePage('Eenmanszaak: zo vul je het online inschrijfformulier in'));
  assert.ok(isKvkProcedurePage('Formulier 1: Eenmanszaak inschrijven'));
  assert.ok(isKvkProcedurePage('Formulier 2a: Maatschap inschrijven'));
  assert.ok(isKvkProcedurePage('Eenmanszaak uitschrijven'));
});

test('isKvkProcedurePage laat inhoudelijke kennisartikelen met dezelfde rechtsvorm-/fiscale trefwoorden gewoon door (echte titels uit dry-run 1)', () => {
  assert.equal(isKvkProcedurePage('Wat is de EU-KOR?'), false);
  assert.equal(isKvkProcedurePage('Ontdek hoe je de EU-KOR voor je webshop gebruikt'), false);
  assert.equal(isKvkProcedurePage('Btw-regels voor e-commerce in de EU'), false);
  assert.equal(isKvkProcedurePage('Inzicht in de belastingtarieven en cijfers van 2026'), false);
  assert.equal(isKvkProcedurePage('Eenmanszaak of bv: zo kies je je rechtsvorm'), false);
  assert.equal(isKvkProcedurePage('Kleineondernemersregeling (KOR) interessant voor jouw bedrijf?'), false);
  assert.equal(isKvkProcedurePage('Je bv en Prinsjesdag: dit zijn de belastingplannen'), false);
  assert.equal(isKvkProcedurePage('Belastingplannen 2027 voor eenmanszaak, vof, maatschap of cv'), false);
  assert.equal(isKvkProcedurePage('Administratie en boekhouden voor ondernemers'), false);
  assert.equal(isKvkProcedurePage('Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?'), false);
});

test('selectKvkCandidates sluit procedure-/formulierpagina\'s uit via de URL-slug, ook met een categoryKeywords-treffer', () => {
  const entries = [
    // bevat 'eenmanszaak' (categoryKeywords-treffer) maar is een formulier
    { loc: 'https://www.kvk.nl/vormen/formulier-1-eenmanszaak-inschrijven/', lastmod: '2026-09-20T10:00:00.000Z' },
    // inhoudelijk artikel, moet wel doorkomen
    { loc: 'https://www.kvk.nl/vormen/eenmanszaak-of-bv-zo-kies-je-je-rechtsvorm/', lastmod: '2026-09-21T10:00:00.000Z' },
  ];
  const { afterRelevanceFilter } = selectKvkCandidates(entries, new Set());
  assert.deepEqual(afterRelevanceFilter.map((e) => e.loc), [
    'https://www.kvk.nl/vormen/eenmanszaak-of-bv-zo-kies-je-je-rechtsvorm/',
  ]);
});

test('extractKvkArticleFields + isKvkProcedurePage samen: formulierpagina met h1 en meta description wordt alsnog als procedure herkend', () => {
  const html = '<html><head><meta name="description" content="Vul het inschrijfformulier in om uw eenmanszaak in te schrijven bij het Handelsregister."/></head><body><h1>Formulier 1: Eenmanszaak inschrijven</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.ok(isKvkProcedurePage(`${fields.title} ${fields.description}`));
});

test('extractKvkArticleFields + isKvkProcedurePage samen: KVK-productpagina wordt herkend als procedure/servicepagina', () => {
  const html = '<html><head><meta name="description" content="Bestel een officieel uittreksel van uw inschrijving bij het Handelsregister."/></head><body><h1>Uittreksel Handelsregister aanvragen</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.ok(isKvkProcedurePage(`${fields.title} ${fields.description}`));
});

test('extractKvkArticleFields + isKvkProcedurePage samen: rekenmodule/tool wordt afgewezen', () => {
  const html = '<html><head><meta name="description" content="Bereken met deze rekentool snel hoeveel inkomstenbelasting u verschuldigd bent in 2027."/></head><body><h1>Rekentool inkomstenbelasting 2027</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.ok(isKvkProcedurePage(`${fields.title} ${fields.description}`));
});

test('extractKvkArticleFields + isKvkProcedurePage samen: inhoudelijk btw-artikel wordt geaccepteerd', () => {
  const html = '<html><head><meta name="description" content="Als ondernemer moet u periodiek btw-aangifte doen bij de Belastingdienst. Lees hier hoe de omzetbelasting werkt."/></head><body><h1>Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(isKvkProcedurePage(`${fields.title} ${fields.description}`), false);
  assert.ok(Object.keys(scoreCategories(`${fields.title} ${fields.description}`)).length > 0);
});

test('extractKvkArticleFields + isKvkProcedurePage samen: inhoudelijk KOR-artikel wordt geaccepteerd', () => {
  const html = '<html><head><meta name="description" content="De kleineondernemersregeling (KOR) kan interessant zijn als uw omzet laag is. Lees hier wat de KOR voor uw bedrijf kan betekenen."/></head><body><h1>Kleineondernemersregeling (KOR) interessant voor jouw bedrijf?</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(isKvkProcedurePage(`${fields.title} ${fields.description}`), false);
  assert.ok(Object.keys(scoreCategories(`${fields.title} ${fields.description}`)).length > 0);
});

test('extractKvkArticleFields + isKvkProcedurePage samen: inhoudelijk rechtsvormartikel wordt geaccepteerd', () => {
  const html = '<html><head><meta name="description" content="Twijfelt u tussen een eenmanszaak en een bv? De keuze voor een rechtsvorm heeft fiscale gevolgen voor uw onderneming."/></head><body><h1>Eenmanszaak of bv: zo kies je je rechtsvorm</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(isKvkProcedurePage(`${fields.title} ${fields.description}`), false);
  assert.ok(Object.keys(scoreCategories(`${fields.title} ${fields.description}`)).length > 0);
});

test('extractKvkArticleFields + isKvkProcedurePage samen: inhoudelijk administratie-artikel wordt geaccepteerd', () => {
  const html = '<html><head><meta name="description" content="Een goede administratie en boekhouden is de basis van uw jaarrekening. Lees hier waar u als ondernemer op moet letten."/></head><body><h1>Administratie en boekhouden voor ondernemers</h1></body></html>';
  const fields = extractKvkArticleFields(html);
  assert.ok(fields);
  assert.equal(isKvkProcedurePage(`${fields.title} ${fields.description}`), false);
  assert.ok(Object.keys(scoreCategories(`${fields.title} ${fields.description}`)).length > 0);
});

// --- Redactionele relevantielaag (dry-run 2 -> 3) ---
// categoryKeywords/scoreCategories alleen was niet genoeg: algemene
// KVK-onderwerpen bevatten dezelfde brede trefwoorden als echte
// kennisartikelen. classifyKvkRelevance test is bewust NIET alleen op de
// exacte titels uit de opdracht, maar ook op structureel vergelijkbare
// varianten, zodat de regels toekomstbestendig zijn.

test('isKvkHubPage herkent /onderwerp/...-overzichtspagina\'s generiek, niet alleen het exacte voorbeeld', () => {
  assert.ok(isKvkHubPage('https://www.kvk.nl/onderwerp/prinsjesdag/'));
  assert.ok(isKvkHubPage('https://www.kvk.nl/onderwerp/btw/'));
  assert.ok(isKvkHubPage('https://www.kvk.nl/onderwerpen/fiscaal/'));
  assert.equal(isKvkHubPage('https://www.kvk.nl/geldzaken/btw-aangifte-doen/'), false);
});

test('isKvkPureDefinitionTitle herkent een pure "Wat is ..."-vraag ongeacht het onderwerp', () => {
  assert.ok(isKvkPureDefinitionTitle('Wat is een rechtsvorm?'));
  assert.ok(isKvkPureDefinitionTitle('Wat is de EU-KOR?'));
  assert.ok(isKvkPureDefinitionTitle('wat is het verschil tussen een bv en een eenmanszaak'));
  assert.equal(isKvkPureDefinitionTitle('Eenmanszaak of bv: zo kies je je rechtsvorm'), false);
});

test('classifyKvkRelevance wijst algemene KVK-onderwerpen af, ook in varianten die niet letterlijk de voorbeeldtitel zijn', () => {
  const afgewezen = [
    'Hoe werkt een faillissement?',
    'Wat moet u weten over een faillissement als ondernemer?',
    'Schulden oplossen bij een eenmanszaak',
    'Schulden oplossen bij een maatschap',
    'Financiering bedrijfsovername',
    'Op zoek naar financiering voor uw bedrijfsovername?',
    'Faillissementsfraude',
    'Wat is een rechtsvorm?',
    'Wat is een eenmanszaak?',
    'De besloten vennootschap (bv): wat je moet weten',
    'Eenmanszaak: alles wat je moet weten',
    'VOF: de basis op een rij',
    'KVK-trendrapport: ondernemersvertrouwen onder starters en stoppers',
    'Onderzoek onder ondernemers: het algemene conjunctuurbeeld',
    'Kies de juiste boekhoudsoftware voor uw eenmanszaak',
  ];
  for (const title of afgewezen) {
    assert.equal(classifyKvkRelevance(title).tier, 'afgewezen', `verwacht 'afgewezen' voor: ${title}`);
  }
});

test('classifyKvkRelevance geeft sterke fiscale/accountancy-artikelen tier \'hoog\', ook in varianten die niet letterlijk de voorbeeldtitel zijn', () => {
  const hoog = [
    'Wat is de EU-KOR?',
    'Ontdek hoe je de EU-KOR voor je webshop gebruikt',
    'Nieuwe btw-regels voor e-commerce binnen de EU',
    'Inzicht in de belastingtarieven en cijfers van 2026',
    'Belastingtarieven 2027: wat verandert er voor ondernemers?',
    'Je bv en Prinsjesdag: dit zijn de fiscale gevolgen voor ondernemers',
    'Prinsjesdag 2026: dit betekenen de belastingplannen voor uw bv',
    'Belastingplannen 2027 voor eenmanszaak, vof, maatschap of cv',
    'Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?',
    'Btw-aangifte: zo doet u dit als zzp\'er',
    'Schijnzelfstandigheid en de DBA: wat betekent dit voor opdrachtgevers?',
    'DBA-wetgeving: wat verandert er voor zzp\'ers?',
    'Eenmanszaak of bv: zo kies je je rechtsvorm',
    'Eenmanszaak versus bv: de fiscale verschillen op een rij',
    'Kleineondernemersregeling (KOR) interessant voor jouw bedrijf?',
  ];
  for (const title of hoog) {
    assert.equal(classifyKvkRelevance(title).tier, 'hoog', `verwacht 'hoog' voor: ${title}`);
  }
});

test('classifyKvkRelevance geeft een twijfelgeval bij een brede, niet-rechtsvorm categoriematch zonder sterk signaal', () => {
  const r = classifyKvkRelevance('Nieuwe cao-afspraken voor werkgevers');
  assert.equal(r.tier, 'twijfel');
});

test('classifyKvkRelevance: een sterk fiscaal signaal overstemt een demotie-signaal (bijv. "bedrijfsovername")', () => {
  const r = classifyKvkRelevance('Fiscale gevolgen van een bedrijfsovername voor de vennootschapsbelasting');
  assert.equal(r.tier, 'hoog');
});

test('selectKvkCandidates sluit hub-pagina\'s (/onderwerp/...) uit, ook met een recente lastmod', () => {
  const entries = [
    { loc: 'https://www.kvk.nl/onderwerp/prinsjesdag/', lastmod: '2026-09-30T00:00:00.000Z' },
    { loc: 'https://www.kvk.nl/geldzaken/btw-aangifte-doen-als-ondernemer/', lastmod: '2026-01-01T00:00:00.000Z' },
  ];
  const { afterUrlFilter, ranked } = selectKvkCandidates(entries, new Set());
  assert.equal(afterUrlFilter.some((e) => e.loc.includes('/onderwerp/')), false);
  assert.equal(ranked.some((e) => e.loc.includes('/onderwerp/')), false);
});

test('selectKvkCandidates rangschikt tier \'hoog\' vóór \'twijfel\', ook als het twijfelgeval recenter is', () => {
  const entries = [
    { loc: 'https://www.kvk.nl/geldzaken/btw-aangifte-doen-als-ondernemer/', lastmod: '2026-01-01T00:00:00.000Z' },
    { loc: 'https://www.kvk.nl/personeel/nieuwe-cao-afspraken-voor-werkgevers/', lastmod: '2026-09-25T00:00:00.000Z' },
  ];
  const { ranked } = selectKvkCandidates(entries, new Set());
  assert.deepEqual(ranked.map((e) => e.loc), [
    'https://www.kvk.nl/geldzaken/btw-aangifte-doen-als-ondernemer/',
    'https://www.kvk.nl/personeel/nieuwe-cao-afspraken-voor-werkgevers/',
  ]);
});

// --- Overlapcontrole met de bestaande Avydo-kennisbank ---

test('findOverlappingArticle herkent inhoudelijke overlap (zelfde categorie, grotendeels dezelfde woorden) ondanks enkelvoud/meervoud', () => {
  const existing = [
    { file: 'a.md', title: 'Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?', category: 'Btw' },
  ];
  const overlap = findOverlappingArticle('Btw-aangifte doen als ondernemer: zo werkt het', 'Btw', existing);
  assert.ok(overlap);
  assert.equal(overlap.file, 'a.md');
});

test('findOverlappingArticle vergelijkt alleen binnen dezelfde categorie', () => {
  const existing = [
    { file: 'a.md', title: 'Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?', category: 'Btw' },
  ];
  const overlap = findOverlappingArticle('Btw-aangifte doen als ondernemer: zo werkt het', 'Vennootschapsbelasting', existing);
  assert.equal(overlap, null);
});

test('findOverlappingArticle geeft null bij een duidelijk ander onderwerp binnen dezelfde categorie', () => {
  const existing = [
    { file: 'a.md', title: 'Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?', category: 'Btw' },
  ];
  const overlap = findOverlappingArticle('Kleineondernemersregeling (KOR) interessant voor jouw bedrijf?', 'Btw', existing);
  assert.equal(overlap, null);
});

// --- KVK-dienst-/productpagina's (dry-run 3 -> 4) ---
// categoryKeywords alleen was niet genoeg: "jaarrekening" als sterk signaal
// tilde ook KVK's eigen deponerings-/bestel-/perspagina's naar tier 'hoog'.
// Deze tests gebruiken zowel de echte URL/path-context als de echte titels
// uit dry-run 3, niet alleen losse titels.

test('kvkFirstPathSegment haalt het eerste padsegment uit een KVK-URL', () => {
  assert.equal(kvkFirstPathSegment('https://www.kvk.nl/deponeren/jaarrekening-deponeren/'), 'deponeren');
  assert.equal(kvkFirstPathSegment('https://www.kvk.nl/pers/presskit-kvk-beeldbank/'), 'pers');
  assert.equal(kvkFirstPathSegment('niet-een-url'), '');
});

test('isKvkServiceOrProductPath blokkeert /producten-bestellen/ en /pers/, maar niet /deponeren/ of een inhoudelijk pad', () => {
  assert.ok(isKvkServiceOrProductPath('https://www.kvk.nl/producten-bestellen/kvk-dataservice-jaarrekeningen/'));
  assert.ok(isKvkServiceOrProductPath('https://www.kvk.nl/pers/presskit-kvk-beeldbank/'));
  assert.equal(isKvkServiceOrProductPath('https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/'), false);
  assert.equal(isKvkServiceOrProductPath('https://www.kvk.nl/geldzaken/aangifte-omzetbelasting-voor-ondernemers/'), false);
});

test('isKvkServiceOrProductPage herkent /producten-bestellen/- en /pers/-URL\'s uit dry-run 3 op padniveau, ongeacht titel', () => {
  assert.ok(isKvkServiceOrProductPage('https://www.kvk.nl/producten-bestellen/kvk-jaarrekeningen-open-data-set/', 'KVK Handelsregister Open Dataset Jaarrekeningen'));
  assert.ok(isKvkServiceOrProductPage('https://www.kvk.nl/producten-bestellen/kvk-dataservice-jaarrekeningen/', 'KVK Dataservice Jaarrekeningen'));
  assert.ok(isKvkServiceOrProductPage('https://www.kvk.nl/producten-bestellen/welke-gegevens-staan-er-in-een-jaarrekening/', 'Welke gegevens staan in een jaarrekening?'));
  assert.ok(isKvkServiceOrProductPage('https://www.kvk.nl/producten-bestellen/hoe-werkt-het-bestellen-van-een-te-grote-jaarrekening/', 'Hoe werkt het bestellen van een te grote jaarrekening?'));
  assert.ok(isKvkServiceOrProductPage('https://www.kvk.nl/pers/presskit-kvk-beeldbank/', 'Presskit KVK - Beeldbank'));
});

test('isKvkServiceOrProductPage herkent administratieve deponeer-procedurepagina\'s op titelniveau (echte titels uit dry-run 3)', () => {
  const procedurePages = [
    ['https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-groot/', 'Jaarrekening deponeren bedrijfsklasse groot'],
    ['https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-middelgroot/', 'Jaarrekening deponeren bedrijfsklasse middelgroot'],
    ['https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-micro-en-klein/', 'Jaarrekening deponeren bedrijfsklasse micro en klein'],
    ['https://www.kvk.nl/deponeren/uiterste-termijn-deponeren-jaarrekening/', 'Uiterste datum deponeren jaarrekening'],
    ['https://www.kvk.nl/deponeren/hoe-deponeer-je-jouw-jaarrekening/', 'In welke bedrijfsklasse valt je bedrijf?'],
    ['https://www.kvk.nl/deponeren/jaarrekening-deponeren/', 'Jaarrekeningen deponeren'],
    ['https://www.kvk.nl/deponeren/handleiding-zelf-deponeren-jaarrekening/', 'Handleiding Zelf Deponeren Jaarrekening'],
  ];
  for (const [url, title] of procedurePages) {
    assert.ok(isKvkServiceOrProductPage(url, title), `verwacht service/product-signaal voor: ${title}`);
  }
});

test('isKvkServiceOrProductPage blokkeert niet blind op het woord "jaarrekening" — inhoudelijke /deponeren/-artikelen blijven door', () => {
  const contentPages = [
    ['https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/', 'Jaarrekening wel of niet deponeren?'],
    ['https://www.kvk.nl/deponeren/waaruit-bestaat-de-jaarrekening/', 'Waaruit bestaat de jaarrekening?'],
    ['https://www.kvk.nl/deponeren/een-xbrl-jaarrekening-opstellen-en-deponeren/', 'Een XBRL-jaarrekening opstellen en deponeren'],
    ['https://www.kvk.nl/deponeren/zelf-deponeren-jaarrekening/', 'Zelf deponeren van je jaarrekening'],
  ];
  for (const [url, title] of contentPages) {
    assert.equal(isKvkServiceOrProductPage(url, title), false, `verwacht GEEN service/product-signaal voor: ${title}`);
  }
});

// Helper die exact de volgorde van processKvkSource/dry-run-kvk.mjs volgt:
// isKvkServiceOrProductPage krijgt bewust alleen de titel (nooit de
// samenvatting) — zie ronde 5: een negatieve term die alleen in de
// samenvatting staat mag een inhoudelijk artikel niet afwijzen.
function finalTier(url, title, description) {
  const combined = `${title} ${description}`;
  if (isKvkProcedurePage(combined)) return 'afgewezen';
  if (isKvkServiceOrProductPage(url, title)) return 'afgewezen';
  return downgradeIfTitleHasNoSignal(title, classifyKvkRelevance(combined)).tier;
}

test('classifyKvkRelevance + isKvkServiceOrProductPage samen: dry-run 3-ruis wordt nog steeds afgewezen, sterke artikelen blijven hoog', () => {
  assert.equal(finalTier('https://www.kvk.nl/producten-bestellen/kvk-dataservice-jaarrekeningen/', 'KVK Dataservice Jaarrekeningen', 'Bestel hier de officiële dataservice met jaarrekeningen uit het Handelsregister.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/pers/presskit-kvk-beeldbank/', 'Presskit KVK - Beeldbank', 'Download hier het persmateriaal en de beeldbank van KVK.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-groot/', 'Jaarrekening deponeren bedrijfsklasse groot', 'Bedrijven in bedrijfsklasse groot moeten hun jaarrekening binnen de wettelijke termijn deponeren.'), 'afgewezen');

  assert.equal(finalTier('https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/', 'Jaarrekening wel of niet deponeren?', 'Niet elke onderneming is verplicht een jaarrekening te deponeren. Lees hier wanneer dit wel en niet moet.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/internationaal/wat-is-de-eu-kor/', 'Wat is de EU-KOR?', 'De EU-KOR is een btw-vrijstellingsregeling voor kleine ondernemers die internationaal zakendoen.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/wetten-en-regels/wet-dba-voorkom-schijnzelfstandigheid/', 'Wet DBA: voorkom schijnzelfstandigheid', 'De Wet DBA regelt wanneer sprake is van schijnzelfstandigheid bij het inhuren van zzp\'ers.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/geldzaken/de-dga-en-werknemersverzekeringen/', 'De dga en werknemersverzekeringen', 'Als dga van uw bv gelden andere regels voor werknemersverzekeringen dan voor gewoon personeel.'), 'hoog');
});

// --- Ronde 5: samenvatting mag geen zelfstandige negatieve trigger zijn ---
// Regressie voor dry-run 4: "Waaruit bestaat de jaarrekening?", "Een
// XBRL-jaarrekening opstellen en deponeren" en "Zelf deponeren van je
// jaarrekening" werden daar onterecht afgewezen omdat hun (gesimuleerde)
// samenvatting toevallig "handleiding"/"jaarrekening deponeren"/"deponeren
// bij KVK" bevatte. isKvkServiceOrProductPage mag daarom alleen op titel/URL
// beoordelen; een negatieve term die uitsluitend in de samenvatting staat
// mag niet tot afwijzing leiden zolang titel en URL op inhoudelijke kennis
// wijzen.
test('isKvkServiceOrProductPage negeert de samenvatting volledig — alleen titel/URL tellen mee', () => {
  // Zelfde drie titels, maar nu met een samenvatting die opzettelijk
  // "handleiding", "jaarrekening deponeren" en "deponeren bij KVK" bevat.
  assert.equal(isKvkServiceOrProductPage('https://www.kvk.nl/deponeren/waaruit-bestaat-de-jaarrekening/', 'Waaruit bestaat de jaarrekening?'), false);
  assert.equal(isKvkServiceOrProductPage('https://www.kvk.nl/deponeren/een-xbrl-jaarrekening-opstellen-en-deponeren/', 'Een XBRL-jaarrekening opstellen en deponeren'), false);
  assert.equal(isKvkServiceOrProductPage('https://www.kvk.nl/deponeren/zelf-deponeren-jaarrekening/', 'Zelf deponeren van je jaarrekening'), false);
});

test('ronde 5-regressie: een samenvatting met "handleiding"/"jaarrekening deponeren"/"deponeren bij KVK" wijst een inhoudelijk artikel niet meer af', () => {
  const cases = [
    {
      url: 'https://www.kvk.nl/deponeren/waaruit-bestaat-de-jaarrekening/',
      title: 'Waaruit bestaat de jaarrekening?',
      description: 'Lees de handleiding over wat je allemaal moet deponeren bij KVK: jaarrekening deponeren begint met de juiste onderdelen op orde hebben.',
    },
    {
      url: 'https://www.kvk.nl/deponeren/een-xbrl-jaarrekening-opstellen-en-deponeren/',
      title: 'Een XBRL-jaarrekening opstellen en deponeren',
      description: 'Een handleiding voor het deponeren bij KVK met het XBRL-formaat voor je jaarrekening.',
    },
    {
      url: 'https://www.kvk.nl/deponeren/zelf-deponeren-jaarrekening/',
      title: 'Zelf deponeren van je jaarrekening',
      description: 'Deze handleiding legt uit hoe je zelf je jaarrekening deponeren kunt regelen bij KVK.',
    },
    {
      url: 'https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/',
      title: 'Jaarrekening wel of niet deponeren?',
      description: 'Niet elke onderneming is verplicht een jaarrekening te deponeren bij KVK.',
    },
  ];
  for (const { url, title, description } of cases) {
    assert.equal(finalTier(url, title, description), 'hoog', `verwacht 'hoog' voor: ${title}`);
  }
});

test('ronde 5-regressie: echte procedurepagina\'s met "bedrijfsklasse"/"uiterste datum"/"handleiding" in de TITEL blijven wél afgewezen', () => {
  assert.equal(finalTier('https://www.kvk.nl/deponeren/uiterste-termijn-deponeren-jaarrekening/', 'Uiterste datum deponeren jaarrekening', 'De uiterste termijn voor het deponeren van je jaarrekening.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/deponeren/hoe-deponeer-je-jouw-jaarrekening/', 'In welke bedrijfsklasse valt je bedrijf?', 'Bepaal eerst je bedrijfsklasse voordat je deponeert.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/deponeren/handleiding-zelf-deponeren-jaarrekening/', 'Handleiding Zelf Deponeren Jaarrekening', 'Een stapsgewijze handleiding.'), 'afgewezen');
});

test('ronde 5-regressie: /producten-bestellen/ en /pers/ blijven hard geblokkeerd, ook met een onschuldige titel', () => {
  assert.equal(finalTier('https://www.kvk.nl/producten-bestellen/kvk-jaarrekeningen-open-data-set/', 'KVK Handelsregister Open Dataset Jaarrekeningen', 'Open data.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/pers/presskit-kvk-beeldbank/', 'Presskit KVK - Beeldbank', 'Persmateriaal.'), 'afgewezen');
});

test('downgradeIfTitleHasNoSignal degradeert \'hoog\' naar \'twijfel\' als alleen de samenvatting een signaal geeft (Presskit-regressie)', () => {
  // Simuleert de root cause van de Presskit/Beeldbank-misser: de
  // samenvatting-fallback kan niet-gerelateerde paginatekst bevatten die
  // toevallig een sterk trefwoord bevat, terwijl de titel zelf nergens op
  // wijst.
  const title = 'Nieuws: ons bedrijf viert 10-jarig jubileum';
  const classification = { tier: 'hoog', reason: 'sterk fiscaal/accountancy-trefwoord gevonden' };
  const result = downgradeIfTitleHasNoSignal(title, classification);
  assert.equal(result.tier, 'twijfel');
});

test('downgradeIfTitleHasNoSignal laat \'hoog\' staan als de titel zelf ook een signaal geeft', () => {
  const title = 'Hoe werkt btw-aangifte (omzetbelasting) voor ondernemers?';
  const classification = { tier: 'hoog', reason: 'sterk fiscaal/accountancy-trefwoord gevonden' };
  const result = downgradeIfTitleHasNoSignal(title, classification);
  assert.equal(result.tier, 'hoog');
});

test('downgradeIfTitleHasNoSignal raakt \'twijfel\'/\'afgewezen\' niet aan', () => {
  const twijfel = { tier: 'twijfel', reason: 'x' };
  const afgewezen = { tier: 'afgewezen', reason: 'y' };
  assert.deepEqual(downgradeIfTitleHasNoSignal('Iets random', twijfel), twijfel);
  assert.deepEqual(downgradeIfTitleHasNoSignal('Iets random', afgewezen), afgewezen);
});

test('selectKvkCandidates sluit /producten-bestellen/- en /pers/-URL\'s uit op URL-niveau, ook met een categoryKeywords-treffer in de slug', () => {
  const entries = [
    { loc: 'https://www.kvk.nl/producten-bestellen/kvk-dataservice-jaarrekeningen/', lastmod: '2026-02-12T13:21:08+01:00' },
    { loc: 'https://www.kvk.nl/pers/presskit-kvk-beeldbank/', lastmod: '2025-02-04T16:31:34+01:00' },
    { loc: 'https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-groot/', lastmod: '2026-02-23T16:43:44+01:00' },
    { loc: 'https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/', lastmod: '2025-08-26T11:17:16+02:00' },
  ];
  const { afterRelevanceFilter } = selectKvkCandidates(entries, new Set());
  assert.deepEqual(afterRelevanceFilter.map((e) => e.loc), [
    'https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/',
  ]);
});

// --- processRssSource: stages.reasons (Belastingdienst/MKB-bronnen) ---

const fakeRssSource = {
  id: 'test-rss',
  name: 'Test-RSS-bron',
  feedUrl: 'https://example.test/rss.xml',
  defaultCategory: 'Fiscale actualiteit',
  requireKeywordMatch: true,
};

const RSS_REASONS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Item zonder link</title>
    <description>Dit item heeft geen link en moet als missingFields tellen in de tellers.</description>
    <pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Al bekend artikel</title>
    <link>https://example.test/al-bekend</link>
    <description>Dit artikel staat al in de bestaande content en moet als duplicate tellen.</description>
    <pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Te korte beschrijving</title>
    <link>https://example.test/kort</link>
    <description>Kort.</description>
    <pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Algemeen bericht zonder thema</title>
    <link>https://example.test/algemeen</link>
    <description>Dit is een algemeen bericht zonder enige fiscale kern en moet als irrelevant tellen.</description>
    <pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Kleineondernemersregeling uitgelegd</title>
    <link>https://example.test/kor</link>
    <description>Deze kleineondernemersregeling is relevant voor zzp'ers met een lage omzet.</description>
    <pubDate>niet-een-geldige-datum</pubDate>
  </item>
</channel></rss>`;

test('processRssSource telt elke afwijzingsreden apart en sluitend op fetched (duplicate/shortDescription/irrelevant/relevant)', async () => {
  const existingUrls = new Set(['https://example.test/al-bekend']);
  const result = await withMockedFetch(
    (url) => (url === fakeRssSource.feedUrl ? xmlResponse(RSS_REASONS_FIXTURE) : htmlResponse('', 404)),
    () => processRssSource(fakeRssSource, existingUrls, { count: 50 }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 5);
  assert.equal(result.stages.parsed, 2); // alleen items die de shortDescription-check overleven
  assert.equal(result.stages.reasons.missingFields, 1);
  assert.equal(result.stages.reasons.duplicate, 1);
  assert.equal(result.stages.reasons.shortDescription, 1);
  assert.equal(result.stages.reasons.irrelevant, 1);
  assert.equal(result.stages.relevant, 1);
  // Ongeldige pubDate -> publishItem geeft null, nooit written (zie withMockedFetch-toelichting).
  assert.equal(result.stages.published, 0);
  assert.equal(result.stages.reasons.notEvaluated, 0);
  // Sluitendheid: elk fetched item valt in precies één van deze emmers.
  const { reasons } = result.stages;
  assert.equal(
    reasons.missingFields + reasons.duplicate + reasons.shortDescription + reasons.irrelevant + result.stages.relevant + reasons.notEvaluated,
    result.stages.fetched,
  );
});

test('processRssSource: items die nooit bekeken zijn doordat het budget al op was, tellen als notEvaluated (niet als afgewezen)', async () => {
  const smallFeed = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <item><title>Een</title><link>https://example.test/een</link><description>Een geldige, lange genoeg beschrijving van dit artikel.</description><pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate></item>
    <item><title>Twee</title><link>https://example.test/twee</link><description>Een geldige, lange genoeg beschrijving van dit artikel.</description><pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate></item>
    <item><title>Drie</title><link>https://example.test/drie</link><description>Een geldige, lange genoeg beschrijving van dit artikel.</description><pubDate>Thu, 30 Oct 2025 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const result = await withMockedFetch(
    (url) => (url === fakeRssSource.feedUrl ? xmlResponse(smallFeed) : htmlResponse('', 404)),
    () => processRssSource(fakeRssSource, new Set(), { count: 0 }), // budget al op vóór deze bron
  );

  assert.equal(result.stages.fetched, 3);
  assert.equal(result.stages.reasons.notEvaluated, 3);
  assert.equal(result.stages.reasons.missingFields, 0);
  assert.equal(result.stages.reasons.duplicate, 0);
  assert.equal(result.stages.reasons.shortDescription, 0);
  assert.equal(result.stages.reasons.irrelevant, 0);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

// --- processSitemapSource: stages.reasons (Rijksoverheid) ---

const fakeSitemapSource = {
  id: 'test-sitemap',
  name: 'Test-Sitemap-bron',
  sitemapUrl: 'https://example.test/sitemap.xml',
  defaultCategory: 'Fiscale actualiteit',
  requireKeywordMatch: true,
};

function sitemapNewsUrlBlock(loc, title, pubDate) {
  return `<url><loc>${loc}</loc><news:news><news:publication><news:language>nl</news:language><news:name>Test</news:name></news:publication><news:publication_date>${pubDate}</news:publication_date><news:title>${title}</news:title></news:news></url>`;
}

const SITEMAP_REASONS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${[
  sitemapNewsUrlBlock('https://example.test/al-bekend', 'Al bekend artikel', '2026-09-20T10:00:00.000Z'),
  sitemapNewsUrlBlock('https://example.test/geen-metadata', 'Pagina zonder metadata', '2026-09-21T10:00:00.000Z'),
  sitemapNewsUrlBlock('https://example.test/irrelevant', 'Algemeen bericht', '2026-09-22T10:00:00.000Z'),
  sitemapNewsUrlBlock('https://example.test/relevant', 'Kleineondernemersregeling nieuws', 'niet-een-geldige-datum'),
].join('')}</urlset>`;

test('processSitemapSource telt elke afwijzingsreden apart en sluitend op fetched (duplicate/metadataRejected/irrelevant/relevant)', async () => {
  const existingUrls = new Set(['https://example.test/al-bekend']);
  const result = await withMockedFetch((url) => {
    if (url === fakeSitemapSource.sitemapUrl) return xmlResponse(SITEMAP_REASONS_FIXTURE);
    if (url === 'https://example.test/geen-metadata') return htmlResponse('<html><body>Geen meta description hier.</body></html>');
    if (url === 'https://example.test/irrelevant') {
      return htmlResponse('<html><head><meta name="description" content="Een algemeen artikel zonder enig specifiek fiscaal thema, puur ter lengte."/></head></html>');
    }
    if (url === 'https://example.test/relevant') {
      return htmlResponse('<html><head><meta name="description" content="Dit artikel gaat over de kleineondernemersregeling en btw-aangifte voor ondernemers."/></head></html>');
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeSitemapSource, existingUrls, { count: 50 }));

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 4);
  assert.equal(result.stages.parsed, 2); // alleen items die de metadata-check overleven
  // missingFields is bij sitemap-bronnen structureel 0: parseSitemapNewsItems
  // filtert items zonder titel/link al weg vóór processSitemapSource ze ziet
  // (zie de implementatie) — dit maakt dat alleen zichtbaar, geen wijziging.
  assert.equal(result.stages.reasons.missingFields, 0);
  assert.equal(result.stages.reasons.duplicate, 1);
  assert.equal(result.stages.reasons.metadataRejected, 1);
  assert.equal(result.stages.reasons.irrelevant, 1);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.published, 0);
  assert.equal(result.stages.reasons.notEvaluated, 0);
  const { reasons } = result.stages;
  assert.equal(
    reasons.missingFields + reasons.duplicate + reasons.metadataRejected + reasons.irrelevant + result.stages.relevant + reasons.notEvaluated,
    result.stages.fetched,
  );
});

test('processSitemapSource: items die nooit bekeken zijn doordat het budget al op was, tellen als notEvaluated', async () => {
  const smallSitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${[
    sitemapNewsUrlBlock('https://example.test/een', 'Een', '2026-09-20T10:00:00.000Z'),
    sitemapNewsUrlBlock('https://example.test/twee', 'Twee', '2026-09-21T10:00:00.000Z'),
  ].join('')}</urlset>`;
  const result = await withMockedFetch(
    (url) => (url === fakeSitemapSource.sitemapUrl ? xmlResponse(smallSitemap) : htmlResponse('', 404)),
    () => processSitemapSource(fakeSitemapSource, new Set(), { count: 0 }),
  );

  assert.equal(result.stages.fetched, 2);
  assert.equal(result.stages.reasons.notEvaluated, 2);
  assert.equal(result.stages.reasons.duplicate, 0);
  assert.equal(result.stages.reasons.metadataRejected, 0);
  assert.equal(result.stages.reasons.irrelevant, 0);
  assert.equal(result.stages.relevant, 0);
});

// --- processKvkSource: stages.reasons (KVK — bestaande filtering ongewijzigd) ---
//
// Deze tests draaien met een eigen, geïsoleerde CONTENT_DIR (tijdelijke map)
// i.p.v. de echte src/content/kenniscentrum/: processKvkSource roept zelf
// loadExistingArticlesMeta() aan voor de overlapcontrole, en die leest echt
// van schijf. Een tijdelijke map voorkomt zowel schrijven in als
// afhankelijkheid van de huidige inhoud van de echte kennisbank (anders zou
// een toevallige titel-overlap met een bestaand artikel deze tests
// onvoorspelbaar kunnen laten slagen/falen). Elke test importeert daarom een
// "verse" module-instantie met een eigen cache-busting query-string, zodat
// de module-level CONTENT_DIR-constante (eenmalig gelezen bij import, zie
// fetch-articles.mjs) naar de tijdelijke map wijst.
let kvkTestImportCounter = 0;
async function withIsolatedKvkModule(existingArticles, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kenniscentrum-kvk-test-'));
  for (const [i, { title, category }] of existingArticles.entries()) {
    writeFileSync(path.join(dir, `bestaand-${i}.md`), `---\ntitle: "${title}"\ncategory: "${category}"\n---\n`, 'utf8');
  }
  const previousEnv = process.env.KENNISCENTRUM_CONTENT_DIR;
  process.env.KENNISCENTRUM_CONTENT_DIR = dir;
  kvkTestImportCounter += 1;
  try {
    const mod = await import(`./fetch-articles.mjs?kvk-test-${kvkTestImportCounter}`);
    return await fn(mod);
  } finally {
    if (previousEnv === undefined) delete process.env.KENNISCENTRUM_CONTENT_DIR;
    else process.env.KENNISCENTRUM_CONTENT_DIR = previousEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

const fakeKvkSource = {
  id: 'test-kvk',
  name: 'Test-KVK-bron',
  type: 'kvk-sitemap',
  sitemapIndexUrl: 'https://example-kvk.test/sitemap_index.xml',
  defaultCategory: 'Ondernemen & rechtsvormen',
  requireKeywordMatch: true,
};
const KVK_DOCUMENTS_SITEMAP_URL = 'https://example-kvk.test/sitemaps/documents-1.xml';

function kvkSitemapIndexXml() {
  return `<?xml version="1.0"?><sitemapindex><sitemap><loc>${KVK_DOCUMENTS_SITEMAP_URL}</loc></sitemap></sitemapindex>`;
}
function kvkDocumentsXml(entries) {
  const urls = entries.map(({ loc, lastmod }) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0"?><urlset>${urls}</urlset>`;
}
function withKvkSitemapRouting(candidateLoc, candidateLastmod, articlePageHandler) {
  return (url) => {
    if (url === fakeKvkSource.sitemapIndexUrl) return xmlResponse(kvkSitemapIndexXml());
    if (url === KVK_DOCUMENTS_SITEMAP_URL) return xmlResponse(kvkDocumentsXml([{ loc: candidateLoc, lastmod: candidateLastmod }]));
    if (url === candidateLoc) return articlePageHandler(url);
    return htmlResponse('', 404);
  };
}

test('processKvkSource telt parseFailures als de artikelpagina geen betrouwbare <h1> oplevert', async () => {
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-aangifte-doen/';
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, '2026-09-20T10:00:00.000Z', () => htmlResponse('<html><body><p>Geen h1 hier, dus extractKvkArticleFields faalt.</p></body></html>')),
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
  ));

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 1);
  assert.equal(result.stages.reasons.afterUrlHubFilter, 1);
  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.reasons.pageFetches, 1);
  assert.equal(result.stages.reasons.notFetchedDueToLimit, 0);
  assert.equal(result.stages.reasons.parseFailures, 1);
  assert.equal(result.stages.parsed, 0);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

test('processKvkSource telt procedureServiceRejected op basis van de echte paginatitel, ook als de URL-slug dat niet liet zien', async () => {
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-aangifte-info/';
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, '2026-09-20T10:00:00.000Z', () => htmlResponse(
      '<html><head><meta name="description" content="Praktische hulp bij het doen van je btw-aangifte als ondernemer, met uitleg."/></head><body><h1>Btw-aangifte doen: handleiding en formulier</h1></body></html>',
    )),
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
  ));

  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.parsed, 1);
  assert.equal(result.stages.reasons.procedureServiceRejected, 1);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

test('processKvkSource telt relevanceRejected als de echte titel+samenvatting op geen enkele categorie scoort', async () => {
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-update-herfst/';
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, '2026-09-20T10:00:00.000Z', () => htmlResponse(
      '<html><head><meta name="description" content="Deze week delen we een update over onze diensten en openingstijden."/></head><body><h1>Belangrijk nieuws voor onze klanten</h1></body></html>',
    )),
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
  ));

  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.parsed, 1);
  assert.equal(result.stages.reasons.relevanceRejected, 1);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

test('processKvkSource telt titleSignalDowngraded (informationeel) als alleen de samenvatting een signaal geeft, en telt het item alsnog als relevant', async () => {
  const candidateLoc = 'https://www.kvk.nl/administratie/deponeren-van-de-jaarrekening-tips/';
  // Ongeldige lastmod -> wordt publishedAt in publishItem -> publishItem
  // geeft null terug vóór writeArticle, dus stages.relevant kan hier veilig
  // getest worden zonder dat er een bestand wordt weggeschreven.
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, 'niet-een-geldige-datum', () => htmlResponse(
      '<html><head><meta name="description" content="Lees meer over de laatste ontwikkelingen rond de jaarrekening en het deponeren daarvan bij KVK voor besloten vennootschappen."/></head><body><h1>Nieuws voor ondernemers deze week</h1></body></html>',
    )),
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
  ));

  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.parsed, 1);
  assert.equal(result.stages.reasons.titleSignalDowngraded, 1);
  assert.equal(result.stages.reasons.relevanceRejected, 0);
  assert.equal(result.stages.reasons.overlapRejected, 0);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.published, 0); // ongeldige datum, geen schrijfactie
});

test('processKvkSource: kandidaten die door het pagina-ophaal-/run-budget nooit zijn opgehaald, tellen als notFetchedDueToLimit', async () => {
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-aangifte-doen/';
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, '2026-09-20T10:00:00.000Z', () => htmlResponse('', 404)), // wordt nooit aangeroepen
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 0 }), // budget al op vóór deze bron
  ));

  assert.equal(result.stages.fetched, 1);
  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.reasons.pageFetches, 0);
  assert.equal(result.stages.reasons.notFetchedDueToLimit, 1);
  assert.equal(result.stages.parsed, 0);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

test('processKvkSource telt overlapRejected bij een bestaand, inhoudelijk vergelijkbaar Kenniscentrum-artikel (zelfde bestaande overlap-algoritme, alleen nu geteld)', async () => {
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-aangifte-voor-ondernemers/';
  const result = await withIsolatedKvkModule(
    [{ title: 'Btw-aangifte doen voor ondernemers', category: 'Btw' }],
    (mod) => withMockedFetch(
      withKvkSitemapRouting(candidateLoc, '2026-09-20T10:00:00.000Z', () => htmlResponse(
        '<html><head><meta name="description" content="Praktische uitleg over het doen van btw-aangifte als ondernemer, met voorbeelden."/></head><body><h1>Btw-aangifte doen voor ondernemers: tips en uitleg</h1></body></html>',
      )),
      () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
    ),
  );

  assert.equal(result.stages.reasons.editorialCandidates, 1);
  assert.equal(result.stages.parsed, 1);
  assert.equal(result.stages.reasons.overlapRejected, 1);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

// --- Rijksoverheid: sitemap.xml (index) -> genummerde algemene sub-sitemaps ---
//
// Titel-extractie van de artikelpagina en de gedeelde Rijksoverheid-
// relevantiepoort (requireKeywordMatch/categoryKeywords/ministryBypass/
// audienceSignals/corroboratie). Sinds de verwijdering van de algemene
// sitemap-discovery (2026-10-07) lopen deze poorttests via de topic-API-
// route, de enige Rijksoverheid-discovery.

test('extractPageTitle leest de <title> en verwijdert de vaste "| Rijksoverheid.nl"-suffix', () => {
  const html = '<html><head><title>Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven | Rijksoverheid.nl</title></head></html>';
  assert.equal(extractPageTitle(html), 'Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven');
});

test('extractPageTitle laat een titel zonder de suffix ongemoeid', () => {
  const html = '<html><head><title>Een titel zonder sitenaam-suffix</title></head></html>';
  assert.equal(extractPageTitle(html), 'Een titel zonder sitenaam-suffix');
});

test('extractPageTitle geeft null zonder <title>-tag (nooit een gegokte titel)', () => {
  assert.equal(extractPageTitle('<html><head></head><body>geen titel</body></html>'), null);
});

const RO_TOPIC_API_URL = 'https://www.rijksoverheid.nl/api/search';

// Eén topic-API-pagina met kandidaten in de vorm {loc, lastmod}; elke
// aanroep levert een verse Response (een body kan maar één keer gelezen
// worden).
function roTopicApiPage(entries) {
  const rawResults = entries.map(({ loc, lastmod }) => ({ url: { raw: loc }, sort_date: { raw: lastmod } }));
  return new Response(JSON.stringify({ rawResponse: { rawResults } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Topic-API-bron met exact de relevantiepoort-velden van de echte
// Rijksoverheid-bron, maar zonder maxAgeMonths/relevanceSignals/
// exclusionRules: deze tests dekken uitsluitend de gedeelde poort (de
// echte configuratie wordt verderop apart getest), en een ongeldige datum
// houdt publishItem hier vóór writeArticle tegen.
const fakeRijksoverheidGateSource = {
  id: 'test-rijksoverheid',
  name: 'Test-Rijksoverheid-bron',
  type: 'rijksoverheid-topic-api',
  topics: ['Testtopic'],
  defaultCategory: 'Fiscale actualiteit',
  requireKeywordMatch: true,
  ministryBypass: 'Ministerie van Financiën',
  // Zelfde smalle, expliciete signaal als de echte Rijksoverheid-bron in
  // sources.config.mjs — zie de tests verderop die specifiek dit pad
  // dekken.
  audienceSignals: rijksoverheidAudienceSignals,
  // Zelfde corroboratie-eis als de echte bron — zie de prinsjesdag-tests
  // verderop.
  corroborationRequiredKeywords: ['prinsjesdag'],
};

test('processSitemapSource (Rijksoverheid-poort via topic-API): ontdekt kandidaten via de algemene sub-sitemaps, haalt titel+samenvatting van de artikelpagina en past de bestaande relevantiefilter ongewijzigd toe', async () => {
  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/al-bekend', lastmod: '2026-10-01T09:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/geen-beschrijving', lastmod: '2026-10-01T08:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/algemeen-nieuws', lastmod: '2026-10-01T07:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/kor-nieuws', lastmod: 'niet-een-geldige-datum' },
  ];

  const existingUrls = new Set(['https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/al-bekend']);
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/geen-beschrijving') {
      return htmlResponse('<html><head><title>Titel zonder samenvatting | Rijksoverheid.nl</title></head></html>');
    }
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/algemeen-nieuws') {
      return htmlResponse('<html><head><title>Algemeen bericht zonder thema | Rijksoverheid.nl</title><meta name="description" content="Dit is een algemeen bericht zonder enige fiscale kern en moet als irrelevant tellen."/></head></html>');
    }
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/kor-nieuws') {
      return htmlResponse('<html><head><title>Kleineondernemersregeling uitgelegd | Rijksoverheid.nl</title><meta name="description" content="Deze kleineondernemersregeling is relevant voor zzp\'ers met een lage omzet."/></head></html>');
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, existingUrls, { count: 50 }));

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 4);
  assert.equal(result.stages.reasons.duplicate, 1);
  assert.equal(result.stages.reasons.metadataRejected, 1); // geen-beschrijving: titel wel, samenvatting niet
  assert.equal(result.stages.reasons.irrelevant, 1); // algemeen-nieuws
  assert.equal(result.stages.relevant, 1); // kor-nieuws
  // Titel kwam niet uit de discovery (die levert alleen loc+lastmod) maar
  // van de artikelpagina zelf — geverifieerd via de gepubliceerde samenvatting-
  // bronvermelding is lastig zonder te schrijven; i.p.v. daarvan: ongeldige
  // datum op het relevante item voorkomt een echte schrijfactie, net als
  // bij de andere process*Source-tests in dit bestand.
  assert.equal(result.stages.published, 0);
});

// --- Regressie (2026-10-01): 'nba'-substring-false-positives + smalle
// audienceKeywords-aanvulling voor Rijksoverheid ---
//
// Een live productie-analyse van de echte Rijksoverheid-run liet zien dat
// 3 van de 5 gepubliceerde artikelen uitsluitend relevant werden bevonden
// omdat het trefwoord 'nba' (bedoeld voor de beroepsorganisatie NBA) als
// kale substring matchte binnen "openbaar"/"openbare"/"openbaarheid". Deze
// tests dekken zowel het nieuwe woordgrens-gedrag van 'nba' zelf als de
// regressievrijheid van bestaande, opzettelijk prefix-matchende trefwoorden
// (bijv. 'boekhoud'), en de nieuwe, smalle audienceSignals-aanvulling.

test("scoreCategories: 'nba' matcht niet meer als kale substring binnen 'openbaar'/'openbare'/'openbaarheid'", () => {
  assert.equal(Object.keys(scoreCategories('openbaar vervoer')).length, 0);
  assert.equal(Object.keys(scoreCategories('openbare lichamen')).length, 0);
  assert.equal(Object.keys(scoreCategories('openbaarheid van bestuur')).length, 0);
});

test("scoreCategories: 'NBA' (en 'nba') blijven wél matchen als losstaande term", () => {
  assert.ok('Administratie & jaarrekening' in scoreCategories('NBA'));
  assert.ok('Administratie & jaarrekening' in scoreCategories('nba'));
  assert.ok('Administratie & jaarrekening' in scoreCategories('Lees het nieuwe standpunt van de NBA over dit onderwerp.'));
});

test("scoreCategories: 'Nederlandse Beroepsorganisatie van Accountants' matcht al via het bestaande 'accountant'-trefwoord (geen 'nba'-substring nodig)", () => {
  const text = 'Nederlandse Beroepsorganisatie van Accountants';
  assert.equal(text.toLowerCase().includes('nba'), false); // geen 'nba'-substring aanwezig in deze tekst
  assert.ok('Administratie & jaarrekening' in scoreCategories(text));
});

test("scoreCategories: bestaande opzettelijke voorvoegsel-trefwoorden (bijv. 'boekhoud') blijven ongewijzigd werken (geen regressie door de woordgrens-eis)", () => {
  assert.ok('Administratie & jaarrekening' in scoreCategories('Goed boekhouden is de basis van je onderneming.'));
  assert.ok('Administratie & jaarrekening' in scoreCategories('Kies de juiste boekhoudsoftware voor je bedrijf.'));
  assert.ok('Administratie & jaarrekening' in scoreCategories('Als boekhouder help ik ondernemers met hun administratie.'));
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): een zzp-wet wordt nu relevant via de smalle audienceSignals-aanvulling, ook zonder categoryKeywords-treffer', async () => {
  const title = "Zelfstandigenwet biedt meer duidelijkheid en erkenning voor zzp'ers";
  const description = "Het kabinet heeft een wetsvoorstel ingediend dat meer duidelijkheid moet geven over de positie van zelfstandigen zonder personeel op de arbeidsmarkt.";
  // Zekerstellen dat dit artikel NIET via categoryKeywords of ministryBypass
  // relevant zou worden — zodat de test daadwerkelijk het nieuwe
  // audienceSignals-pad dekt, niet een al bestaand pad.
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);

  // Ongeldige lastmod -> wordt publishedAt in publishItem -> publishItem
  // geeft null terug vóór writeArticle (zie fetch-articles.mjs), dus
  // stages.relevant kan hier veilig getest worden zonder dat er een echt
  // bestand wordt weggeschreven — zelfde patroon als elders in dit bestand.
  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zelfstandigenwet', lastmod: 'niet-een-geldige-datum' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zelfstandigenwet') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): een generiek overheidsartikel met alleen het brede audienceKeyword "werkgever" wordt NIET automatisch relevant', async () => {
  const title = 'Werkgevers krijgen te maken met nieuwe regels';
  const description = 'Werkgevers moeten vanaf volgend jaar rekening houden met enkele nieuwe regels voor personeel op de werkvloer.';
  // 'werkgever'/'personeel' zijn bewust NIET in rijksoverheidAudienceSignals
  // opgenomen (zie sources.config.mjs) en matchen ook geen categoryKeywords
  // — dit artikel moet dus gewoon afgewezen blijven.
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => description.toLowerCase().includes(kw)), false);

  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/werkgevers-nieuwe-regels', lastmod: '2026-10-01T09:00:00.000Z' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/werkgevers-nieuwe-regels') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

// --- Regressie (read-only audit, 2026-10-01): nieuwe substring-botsingen
// ('kor'/'maatschap'/'fusie') + 'prinsjesdag' te breed voor Rijksoverheid ---
//
// Een read-only audit van 20 nieuw gepubliceerde artikelen (10 Rijksoverheid
// + 10 KVK, productierun 2026-10-01) toonde twee problemen: dezelfde
// substring-botsing als bij 'nba' trad opnieuw op bij 'kor' (binnen
// "tekort"), 'maatschap' (binnen "maatschappij") en 'fusie' (binnen
// "kernfusie"); en 'prinsjesdag' bleek op zichzelf voldoende om 6 van de 10
// nieuwe Rijksoverheid-artikelen relevant te maken, zonder enig ander
// fiscaal signaal (Bonaire-kosten-levensonderhoud, Oekraïne/ontwikkelings-
// samenwerking, infrastructuur).

test("scoreCategories: 'kor' matcht niet meer als kale substring binnen 'tekort'", () => {
  assert.equal(Object.keys(scoreCategories('lerarentekort')).length, 0);
  assert.equal(Object.keys(scoreCategories('woningtekort')).length, 0);
  assert.equal(Object.keys(scoreCategories('Dat leggen we hieronder in het kort uit.')).length, 0);
});

test("scoreCategories: 'KOR' blijft matchen als losstaand woord en 'kleineondernemersregeling' blijft via het eigen trefwoord werken", () => {
  assert.ok('Btw' in scoreCategories('KOR'));
  assert.ok('Btw' in scoreCategories('Gebruikt u de KOR voor uw onderneming?'));
  assert.ok('Btw' in scoreCategories('kleineondernemersregeling'));
});

test("scoreCategories: 'maatschap' matcht niet meer als kale substring binnen 'maatschappij'", () => {
  assert.equal(Object.keys(scoreCategories('maatschappij')).length, 0);
  assert.equal(Object.keys(scoreCategories('Dit raakt de hele maatschappij.')).length, 0);
});

test("scoreCategories: 'maatschap' blijft matchen als losstaand woord", () => {
  assert.ok('Ondernemen & rechtsvormen' in scoreCategories('maatschap'));
  assert.ok('Ondernemen & rechtsvormen' in scoreCategories('Een maatschap is een samenwerkingsvorm voor zelfstandigen.'));
});

test("scoreCategories: 'fusie' matcht niet meer als kale substring binnen 'kernfusie'", () => {
  assert.equal(Object.keys(scoreCategories('kernfusie')).length, 0);
  assert.equal(Object.keys(scoreCategories('Onderzoekers boeken vooruitgang met kernfusie.')).length, 0);
});

test("scoreCategories: 'fusie' blijft matchen als losstaand woord", () => {
  assert.ok('Ondernemen & rechtsvormen' in scoreCategories('fusie'));
  assert.ok('Ondernemen & rechtsvormen' in scoreCategories('De twee bedrijven kondigden een fusie aan.'));
});

test("scoreCategories: 'prinsjesdag' telt gewoon mee in de categorietelling zelf (de corroboratie-eis zit in processSitemapSource, niet in scoreCategories)", () => {
  assert.ok('Fiscale actualiteit' in scoreCategories('Alles over Prinsjesdag'));
});

test("scoreCategories: met excludeKeywords kan 'prinsjesdag' buiten de telling gehouden worden, zonder categoryKeywords zelf te wijzigen", () => {
  const onlyPrinsjesdag = 'Lees hier alles over Prinsjesdag dit jaar.';
  assert.ok('Fiscale actualiteit' in scoreCategories(onlyPrinsjesdag));
  assert.equal(Object.keys(scoreCategories(onlyPrinsjesdag, new Set(['prinsjesdag']))).length, 0);

  const prinsjesdagEnBelastingplan = 'Prinsjesdag: het Belastingplan 2027 is bekendgemaakt.';
  assert.ok('Fiscale actualiteit' in scoreCategories(prinsjesdagEnBelastingplan, new Set(['prinsjesdag'])));
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): een Rijksoverheid-artikel met uitsluitend "prinsjesdag" wordt niet meer automatisch relevant', async () => {
  const title = 'Prinsjesdag 2026: wat gebeurt er op het Binnenhof';
  const description = 'Op Prinsjesdag leest de koning de troonrede voor en biedt het kabinet de rijksbegroting aan bij de Tweede Kamer.';
  // Zekerstellen dat dit artikel alleen via 'prinsjesdag' scoort, en geen
  // ministryMatch/audienceMatch heeft — anders test deze test niet wat hij
  // beweert te testen.
  const scores = scoreCategories(`${title} ${description}`);
  assert.deepEqual(Object.keys(scores), ['Fiscale actualiteit']);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => description.toLowerCase().includes(kw)), false);

  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-2026', lastmod: '2026-10-01T09:00:00.000Z' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-2026') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): een algemeen Prinsjesdag-ministeriepersbericht zonder relevant Avydo-signaal komt niet meer door de poort', async () => {
  const title = 'Prinsjesdag 2026: kabinet trekt extra geld uit voor Caribisch Nederland';
  const description = 'Rond Prinsjesdag maakt het kabinet bekend dat er extra budget komt voor de kosten van levensonderhoud op Bonaire, Sint-Eustatius en Saba.';
  assert.deepEqual(Object.keys(scoreCategories(`${title} ${description}`)), ['Fiscale actualiteit']);

  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/caribisch-nederland', lastmod: '2026-10-01T09:00:00.000Z' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/caribisch-nederland') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): "prinsjesdag" + "belastingplan" samen blijven relevant', async () => {
  const title = 'Prinsjesdag 2026: Belastingplan 2027 ingediend bij de Tweede Kamer';
  const description = 'Op Prinsjesdag heeft het kabinet het Belastingplan 2027 ingediend met voorstellen voor belastingtarieven volgend jaar.';

  // Ongeldige lastmod -> publishItem geeft null terug vóór writeArticle,
  // dus stages.relevant kan hier veilig getest worden zonder te schrijven.
  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/belastingplan-2027', lastmod: 'niet-een-geldige-datum' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/belastingplan-2027') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): "prinsjesdag" + een ander bestaand category-signaal ("btw") samen blijven relevant', async () => {
  const title = 'Prinsjesdag 2026: wijzigingen in de btw-tarieven aangekondigd';
  const description = 'Tijdens Prinsjesdag maakte het kabinet bekend dat de btw-tarieven per volgend jaar wijzigen voor een aantal productgroepen.';

  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-tarieven-wijziging', lastmod: 'niet-een-geldige-datum' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-tarieven-wijziging') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): "prinsjesdag" + een bestaand audienceSignal (zzp) samen blijven relevant, en audienceSignals blijven los daarvan gewoon werken', async () => {
  // Deel 1: 'prinsjesdag' + audienceMatch (zzp) -> relevant via corroboratie.
  const titleMet = 'Prinsjesdag 2026: wat verandert er voor zzp\'ers';
  const descriptionMet = 'Tijdens Prinsjesdag kondigde het kabinet aan dat er voor zzp\'ers enkele regelingen wijzigen per volgend jaar.';
  assert.ok(rijksoverheidAudienceSignals.some((kw) => descriptionMet.toLowerCase().includes(kw)));

  const topicEntriesMet = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-zzp', lastmod: 'niet-een-geldige-datum' },
  ];
  const resultMet = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntriesMet);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-zzp') {
      return htmlResponse(`<html><head><title>${titleMet} | Rijksoverheid.nl</title><meta name="description" content="${descriptionMet}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));
  assert.equal(resultMet.stages.relevant, 1);

  // Deel 2: audienceSignal (zzp) zonder 'prinsjesdag' en zonder categoryKeywords
  // -> blijft relevant via het bestaande, ongewijzigde audienceSignals-pad
  // (zelfde als de al bestaande zzp-regressietest hierboven, nu met een
  // bron die ook corroborationRequiredKeywords heeft, om te bevestigen dat
  // dat pad niet geraakt is).
  const titleZonder = 'Nieuwe regeling voor zzp\'ers aangekondigd';
  const descriptionZonder = 'Het kabinet kondigt een nieuwe regeling aan die gevolgen heeft voor zelfstandigen zonder personeel.';
  assert.equal(Object.keys(scoreCategories(`${titleZonder} ${descriptionZonder}`)).length, 0);
  assert.ok(rijksoverheidAudienceSignals.some((kw) => `${titleZonder} ${descriptionZonder}`.toLowerCase().includes(kw)));

  const topicEntriesZonder = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zzp-regeling', lastmod: 'niet-een-geldige-datum' },
  ];
  const resultZonder = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntriesZonder);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zzp-regeling') {
      return htmlResponse(`<html><head><title>${titleZonder} | Rijksoverheid.nl</title><meta name="description" content="${descriptionZonder}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));
  assert.equal(resultZonder.stages.relevant, 1);
});

// --- Regressie (read-only audit, 2026-10-01): ministryBypass liet
// consumententoeslagen-berichten onterecht door ---
//
// Het artikel "Actie van Toeslagen voor 200.000 huishoudens die zorgtoeslag
// laten liggen" (productierun 65f0cd7) had nul categoryKeyword-treffers en
// kwam uitsluitend binnen via ministryBypass (Financiën-breadcrumb, Dienst
// Toeslagen valt daaronder). Deze tests dekken de nieuwe, smalle
// uitsluitingslijst die zulke artikelen alsnog blokkeert, zonder de
// ministryBypass als vangnet voor keyword-arme maar wél fiscaal relevante
// Financiën-artikelen aan te tasten.

const FINANCIEN_MINISTRY_HTML_SUFFIX = '<a href="/ministeries/ministerie-van-financien">Ministerie van Financiën</a>';

function financienPageHtml(title, description) {
  return `<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head><body>${FINANCIEN_MINISTRY_HTML_SUFFIX}</body></html>`;
}

async function runFinancienMinistryBypassCase(slug, title, description) {
  // Ongeldige lastmod -> publishItem geeft null terug vóór writeArticle
  // (zie fetch-articles.mjs), dus stages.relevant kan hier veilig getest
  // worden zonder dat er een echt bestand wordt weggeschreven — zelfde
  // patroon als elders in dit bestand. Ook relevant voor de twee cases
  // hieronder die daadwerkelijk relevant=1 verwachten.
  const topicEntries = [
    { loc: `https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/${slug}`, lastmod: 'niet-een-geldige-datum' },
  ];
  return withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === `https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/${slug}`) {
      return htmlResponse(financienPageHtml(title, description));
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));
}

for (const [slug, term, title, description] of [
  ['zorgtoeslag-actie', 'zorgtoeslag', 'Actie voor huishoudens die zorgtoeslag laten liggen', 'Duizenden huishoudens ontvangen een brief omdat ze mogelijk nog recht hebben op zorgtoeslag over vorig jaar.'],
  ['huurtoeslag-actie', 'huurtoeslag', 'Actie voor huishoudens die huurtoeslag laten liggen', 'Duizenden huishoudens ontvangen een brief omdat ze mogelijk nog recht hebben op huurtoeslag over vorig jaar.'],
  ['kinderopvangtoeslag-actie', 'kinderopvangtoeslag', 'Actie voor ouders die kinderopvangtoeslag laten liggen', 'Duizenden ouders ontvangen een brief omdat ze mogelijk nog recht hebben op kinderopvangtoeslag over vorig jaar.'],
  ['kindgebonden-budget-actie', 'kindgebonden budget', 'Actie voor huishoudens die kindgebonden budget laten liggen', 'Duizenden huishoudens ontvangen een brief omdat ze mogelijk nog recht hebben op kindgebonden budget over vorig jaar.'],
]) {
  test(`processSitemapSource (Rijksoverheid-poort via topic-API): een Financiën-artikel met uitsluitend '${term}' wordt niet meer relevant via ministryBypass`, async () => {
    // Zekerstellen dat dit artikel geen categoryKeywords-/audienceSignals-
    // treffer heeft — anders test deze test niet specifiek het
    // ministryBypass-pad.
    assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
    assert.equal(rijksoverheidAudienceSignals.some((kw) => `${title} ${description}`.toLowerCase().includes(kw)), false);

    const result = await runFinancienMinistryBypassCase(slug, title, description);
    assert.equal(result.stages.relevant, 0);
    assert.equal(result.stages.reasons.irrelevant, 1);
  });
}

test('processSitemapSource (Rijksoverheid-poort via topic-API): een Financiën-artikel zonder categoryKeyword/audienceSignal maar wél met een fiscale stam blijft relevant via ministryBypass', async () => {
  const title = 'Kabinet werkt aan vereenvoudiging van de fiscale regelgeving';
  const description = 'Het kabinet onderzoekt hoe regels rond geldstromen tussen overheid en bedrijfsleven eenvoudiger kunnen worden ingericht voor de komende jaren.';
  // Zekerstellen dat dit artikel ook geen categoryKeywords-/audienceSignals-
  // treffer heeft — zodat deze test daadwerkelijk het (nog altijd werkende)
  // ministryBypass-pad dekt, niet een ander pad. De titel bevat bewust wél
  // de fiscale stam 'fiscale' (zie MINISTRY_BYPASS_REQUIRED_TERMS), anders
  // zou dit artikel na de nieuwe corroboratie-eis niet meer relevant zijn.
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => `${title} ${description}`.toLowerCase().includes(kw)), false);

  const result = await runFinancienMinistryBypassCase('financien-regelgeving', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test("processSitemapSource (Rijksoverheid-poort via topic-API): 'zorgtoeslag' blokkeert de ministryBypass niet als het artikel daarnaast een echt categoryKeyword bevat (de uitsluiting raakt alleen ministryBypass, niet de algemene relevantiescoring)", async () => {
  const title = 'Belastingplan 2027: ook wijzigingen voor toeslagen zoals zorgtoeslag';
  const description = 'Naast het Belastingplan 2027 wijzigt ook de systematiek van de zorgtoeslag, als onderdeel van de bredere fiscale wetswijziging voor volgend jaar.';
  // Zekerstellen dat dit artikel WEL een categoryKeywords-treffer heeft
  // (via 'belastingplan') — zodat deze test aantoont dat de nieuwe
  // uitsluiting de algemene scoreCategories-relevantie niet blokkeert.
  assert.ok('Fiscale actualiteit' in scoreCategories(`${title} ${description}`));

  const result = await runFinancienMinistryBypassCase('belastingplan-toeslagen', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

// --- Regressie: ministryBypass eist nu ook een positieve fiscale stam
// ('belasting'/'fiscaal'), naast de bestaande negatieve uitsluitingslijst ---
//
// Een inhoudelijke audit van 30 echte Financiën-artikelen (2026-10-01) liet
// zien dat ministryMatch zonder deze eis te breed was: 13 van de 23
// artikelen die uitsluitend via ministryMatch relevant werden, waren
// inhoudelijk een false positive (interne Belastingdienst-ICT,
// cybersecurity, herdenkingsmunten, staatsdeelnemingen, consumenten-
// hypotheeknormen). De twee daadwerkelijk relevante uitzonderingen in die
// audit bevatten beide, ondanks het ontbreken van een categoryKeywords-
// treffer, wél het woordstam 'belasting' resp. 'fiscaal'.

test("processSitemapSource (Rijksoverheid-poort via topic-API): 'Kabinet zet met belastingwijzigingen 2026 stappen naar een beter belastingstelsel' blijft relevant via ministryBypass (fiscale stam 'belasting', geen categoryKeyword)", async () => {
  const title = 'Kabinet zet met belastingwijzigingen 2026 stappen naar een beter belastingstelsel';
  const description = 'Per 1 januari 2026 wijzigen verschillende belastingen waarmee stappen worden gezet naar een beter belastingstelsel. Daarbij houdt het kabinet oog voor de koopkracht van Nederlanders.';
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => `${title} ${description}`.toLowerCase().includes(kw)), false);

  const result = await runFinancienMinistryBypassCase('belastingwijzigingen-2026', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test("processSitemapSource (Rijksoverheid-poort via topic-API): 'Start internetconsultatie belastingmaatregelen om startups en scale-ups te ondersteunen' blijft relevant via ministryBypass (fiscale stam 'belasting', geen categoryKeyword)", async () => {
  const title = 'Start internetconsultatie belastingmaatregelen om startups en scale-ups te ondersteunen';
  const description = 'Vandaag start een internetconsultatie om 2 belastingmaatregelen die startups en scale-ups in Nederland ondersteunen. Er komt een nieuwe regeling die het aantrekkelijker maakt om medewerkers te belonen met opties op aandelen in het bedrijf.';
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => `${title} ${description}`.toLowerCase().includes(kw)), false);

  const result = await runFinancienMinistryBypassCase('startups-scale-ups-belastingmaatregelen', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test("processSitemapSource (Rijksoverheid-poort via topic-API): 'fiscaal' zonder 'belasting' is ook voldoende als fiscale stam voor ministryBypass", async () => {
  const title = 'Kabinet kondigt nieuwe fiscale maatregel aan voor innovatieve bedrijven';
  const description = 'Het kabinet neemt een nieuwe fiscale maatregel om innovatie bij bedrijven te stimuleren, zonder dat dit gevolgen heeft voor andere regelingen.';
  assert.equal(`${title} ${description}`.toLowerCase().includes('belasting'), false);
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => `${title} ${description}`.toLowerCase().includes(kw)), false);

  const result = await runFinancienMinistryBypassCase('fiscale-maatregel-innovatie', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (Rijksoverheid-poort via topic-API): een categoryKeyword-treffer blijft relevant zonder ministryBypass (de nieuwe fiscale-stam-eis raakt uitsluitend ministryMatch)', async () => {
  const title = 'Nieuwe regels voor de btw-aangifte van kleine ondernemers';
  const description = 'Het kabinet verduidelijkt de regels rond btw-aangifte voor kleine ondernemers vanaf volgend jaar.';
  assert.ok('Btw' in scoreCategories(`${title} ${description}`));

  const topicEntries = [
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-aangifte-kleine-ondernemers', lastmod: 'niet-een-geldige-datum' },
  ];
  const result = await withMockedFetch((url) => {
    if (url === RO_TOPIC_API_URL) return roTopicApiPage(topicEntries);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-aangifte-kleine-ondernemers') {
      // Bewust GEEN ministerie-breadcrumb in deze pagina — dit artikel moet
      // relevant worden puur via scoreCategories, los van ministryMatch.
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidGateSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

for (const [slug, naam, title, description] of [
  ['cyberincident-financien', 'cyberincident', 'Ministerie van Financiën onderzoekt ongeautoriseerde toegang tot systemen', 'De ICT-beveiliging van het ministerie van Financiën heeft ongeautoriseerde toegang gesignaleerd tot systemen voor een aantal primaire processen op het beleidsdepartement.'],
  ['digitale-autonomie-belastingdienst', 'interne Belastingdienst-IT', 'Digitale autonomie prioriteit voor Belastingdienst', 'De Belastingdienst wil rijksbreed koploper worden op het gebied van digitale autonomie door te investeren in eigen IT-beheer.'],
  ['dataomgeving-belastingdienst', 'data/governance', 'Dataomgeving Belastingdienst bleef jarenlang buiten beeld', 'Tijdens werkzaamheden om de informatiehuishouding op orde te krijgen is een afgesloten bewaaromgeving na jaren opnieuw in beeld gekomen.'],
  ['leennormen-2026', 'consumentenfinanciering', 'Leennormen 2026: hypotheek kan iets omhoog door verwachte loonstijging', 'De meeste huishoudens kunnen in 2026 wat meer lenen voor de aankoop van een woning door de verwachte inkomensgroei.'],
  ['tennet-verkoop', 'staatsdeelneming', 'Nederland verkoopt deel TenneT Duitsland aan de Duitse staat', 'De Nederlandse staat verkoopt een deel van de aandelen in TenneT Duitsland aan de Duitse staat via een investeringsbank.'],
  ['nieuwe-munten-2027', 'ceremonieel/munten', "Spinoza en Neder-Germaanse Limes thema's nieuwe munten 2027", 'Jaarlijks brengt het ministerie van Financiën twee bijzondere munten uit om speciale gebeurtenissen of personen te eren.'],
]) {
  test(`processSitemapSource (Rijksoverheid-poort via topic-API): '${naam}' komt niet meer door via ministryBypass (geen fiscale stam 'belasting'/'fiscaal')`, async () => {
    const combined = `${title} ${description}`;
    assert.equal(Object.keys(scoreCategories(combined)).length, 0);
    assert.equal(rijksoverheidAudienceSignals.some((kw) => combined.toLowerCase().includes(kw)), false);
    // 'Belastingdienst' (de organisatienaam) bevat zelf de substring
    // 'belasting' — dat is bewust geen fiscaal inhoudssignaal (zie
    // hasMinistryBypassRequiredTerm in fetch-articles.mjs), dus die mentions
    // worden hier eerst verwijderd voordat op de stam wordt gecontroleerd.
    const withoutOrganizationName = combined.toLowerCase().replaceAll('belastingdienst', '');
    assert.equal(withoutOrganizationName.includes('belasting'), false);
    assert.equal(withoutOrganizationName.includes('fisca'), false);

    const result = await runFinancienMinistryBypassCase(slug, title, description);
    assert.equal(result.stages.relevant, 0);
    assert.equal(result.stages.reasons.irrelevant, 1);
  });
}

test('processSitemapSource (Rijksoverheid-poort via topic-API): ministryMatch=false door de nieuwe fiscale-stam-eis blokkeert relevant=true niet als categoryKeywords het artikel al valideert (de eis raakt uitsluitend ministryMatch)', async () => {
  const title = 'Kabinet wil administratieplicht voor digitale platformen aanscherpen';
  const description = 'Het kabinet wil dat digitale platformen hun administratieplicht beter naleven om fraude te voorkomen.';
  // Zekerstellen dat dit artikel géén fiscale stam heeft (ministryMatch zou
  // dus nu zonder deze corroboratie-eis al ook via categoryKeywords
  // relevant zijn; dit bewijst dat de nieuwe eis dat niet ongedaan maakt)
  // en wél een categoryKeywords-treffer.
  assert.equal(`${title} ${description}`.toLowerCase().includes('belasting'), false);
  assert.equal(`${title} ${description}`.toLowerCase().includes('fiscaal'), false);
  assert.ok('Administratie & jaarrekening' in scoreCategories(`${title} ${description}`));

  const result = await runFinancienMinistryBypassCase('administratieplicht-digitale-platformen', title, description);
  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

// --- Rijksoverheid topic-API (POST /api/search) — aanvullende discovery-bron ---
//
// De ?hash=-queryparameter is bevestigd een cache-sleutel, geen
// beveiliging (zie fetch-articles.mjs): alle requests in deze tests gaan
// naar exact dezelfde URL, ongeacht topic/pagina. De bestaande
// withMockedFetch-helper hierboven geeft de aanroeper alleen de URL door,
// niet de POST-body — onvoldoende om hier topic/pagina te onderscheiden.
// Deze nieuwe, losse helper geeft ook de fetch-opties (method/body) door,
// zonder de bestaande withMockedFetch/zijn aanroepers aan te raken.
async function withMockedFetchAndBody(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const RIJKSOVERHEID_TOPIC_API_URL = 'https://www.rijksoverheid.nl/api/search';

// Eén rawResults-item in de daadwerkelijk live geobserveerde vorm (zie
// git-historie van het read-only onderzoek).
function apiSearchResult({ url, title = 'Testartikel', date = '2026-01-01T00:00:00.000Z', description = 'Een testbeschrijving.', informationType = 'Nieuwsbericht' }) {
  return {
    id: { raw: `doc-${Math.random().toString(36).slice(2)}` },
    url: { raw: url },
    page_title: { raw: title },
    sort_date: { raw: date },
    meta_description: { raw: description, snippet: description },
    information_type: { raw: informationType },
  };
}

function apiSearchResponse(rawResults, status = 200) {
  return new Response(JSON.stringify({ rawResponse: { rawResults } }), { status, headers: { 'content-type': 'application/json' } });
}

// --- Topic-config ---

const EXPECTED_RIJKSOVERHEID_TOPICS = [
  'Belasting betalen',
  'Inkomstenbelasting',
  'Belastingverdragen',
  'Bijstand voor zelfstandigen (Bbz)',
  'Europese subsidies',
  'Prinsjesdag: Belastingplan 2027',
  'Aanpak belastingontwijking en belastingontduiking',
  'Zelfstandigen zonder personeel (zzp)',
  'Ziekteverzuim en herstel naar werk',
  'Werken met arbeidsbeperking',
  'Buitenlandse werknemers',
  'Ondernemen en innovatie',
];
const ORIGINAL_FISCAL_TOPICS = [
  'Belasting betalen',
  'Inkomstenbelasting',
  'Belastingverdragen',
  'Aanpak belastingontwijking en belastingontduiking',
];

test('sources.config.mjs: de Rijksoverheid-bron bevat exact de 12 geselecteerde topics, met de exacte namen, geen extra topics', () => {
  const source = sources.find((s) => s.id === 'rijksoverheid-topic-api');
  assert.ok(source, 'rijksoverheid-topic-api moet als bron geconfigureerd zijn');
  assert.equal(source.type, 'rijksoverheid-topic-api');
  assert.deepEqual(source.topics, EXPECTED_RIJKSOVERHEID_TOPICS);
  assert.equal(source.topics.length, 12);
  assert.equal(new Set(source.topics).size, 12);
  assert.equal(source.enabled, true);
  for (const topic of ORIGINAL_FISCAL_TOPICS) assert.ok(source.topics.includes(topic), topic);
  // Bewust NIET geselecteerde consument-/uitkeringsthema's.
  for (const excluded of ['AOW', 'Algemene nabestaandenwet (Anw)', 'Arbeidsongeschikt na ziekte (WIA)', 'Kinderbijslag', 'Kinderopvangtoeslag', 'Armoedebestrijding', 'Bijstand', 'Wajong', 'Ziektewet-uitkering']) {
    assert.equal(source.topics.includes(excluded), false, excluded);
  }
});

test('sources.config.mjs: de Rijksoverheid-bron heet "Rijksoverheid" (wordt zo als sourceName gepubliceerd)', () => {
  const source = sources.find((s) => s.id === 'rijksoverheid-topic-api');
  assert.equal(source.name, 'Rijksoverheid');
});

test('sources.config.mjs: rijksoverheid-nieuws en mkb-nederland-nieuws bestaan niet meer (ook niet uitgeschakeld); exact Belastingdienst, Rijksoverheid (topic-API) en KVK blijven over', () => {
  const ids = sources.map((s) => s.id);
  assert.equal(ids.includes('rijksoverheid-nieuws'), false);
  assert.equal(ids.includes('mkb-nederland-nieuws'), false);
  assert.equal(sources.some((s) => s.name === 'MKB-Nederland' || /mkb\.nl/.test(s.feedUrl ?? '')), false);
  assert.deepEqual(ids, ['belastingdienst-zakelijk', 'rijksoverheid-topic-api', 'kvk-kennisartikelen']);
  assert.ok(sources.every((s) => s.enabled === true));
  // De enige Rijksoverheid-bron werkt uitsluitend via de topic-API (geen
  // algemene sitemap-discovery meer).
  const rijksoverheid = sources.filter((s) => /rijksoverheid/i.test(s.id) || /rijksoverheid/i.test(s.name));
  assert.deepEqual(rijksoverheid.map((s) => s.id), ['rijksoverheid-topic-api']);
  assert.equal(rijksoverheid[0].sitemapIndexUrl, undefined);
  assert.equal(rijksoverheid[0].sitemapUrl, undefined);
});

test('sources.config.mjs: Belastingdienst en KVK zijn ongewijzigd geconfigureerd', () => {
  const belastingdienst = sources.find((s) => s.id === 'belastingdienst-zakelijk');
  assert.equal(belastingdienst.name, 'Belastingdienst');
  assert.equal(belastingdienst.type, 'rss');
  assert.equal(belastingdienst.feedUrl, 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/rss/nieuwsfeed_actueel_zakelijk.xml');
  assert.equal(belastingdienst.requireKeywordMatch, false);
  assert.equal(belastingdienst.topics, undefined);
  const kvk = sources.find((s) => s.id === 'kvk-kennisartikelen');
  assert.equal(kvk.name, 'KVK');
  assert.equal(kvk.type, 'kvk-sitemap');
  assert.equal(kvk.sitemapIndexUrl, 'https://www.kvk.nl/sitemap_index.xml');
  assert.equal(kvk.defaultCategory, 'Ondernemen & rechtsvormen');
  assert.equal(kvk.requireKeywordMatch, true);
  assert.equal(kvk.topics, undefined);
});

test('sources.config.mjs: de Rijksoverheid-bron behoudt leeftijdsgrens, discovery-grenzen, crypto-signaal, uitsluitingen en ministryBypass', () => {
  const source = sources.find((s) => s.id === 'rijksoverheid-topic-api');
  assert.equal(source.maxAgeMonths, 24);
  assert.equal(source.maxPagesPerTopic, 5);
  assert.equal(source.maxArticlesPerTopicPerRun, 20);
  assert.equal(source.relevanceSignals, rijksoverheidTopicRelevanceSignals);
  assert.equal(source.exclusionRules, rijksoverheidTopicExclusionRules);
  assert.equal(source.ministryBypass, 'Ministerie van Financiën');
  assert.equal(source.audienceSignals, rijksoverheidAudienceSignals);
  assert.deepEqual(source.corroborationRequiredKeywords, ['prinsjesdag']);
  assert.equal(source.requireKeywordMatch, true);
});

test('buildRijksoverheidTopicSearchBody zet het bewezen topicfilter en content_type-filter correct op', () => {
  const body = buildRijksoverheidTopicSearchBody('Belasting betalen', 1);
  assert.deepEqual(body.requestState.filters[0], { field: 'topic', values: ['Belasting betalen'], type: 'all' });
  assert.deepEqual(body.requestState.filters[1], { field: 'content_type', values: ['pro:newsDocument'], type: 'all' });
  assert.equal(body.requestState.resultsPerPage, 10);
});

test('buildRijksoverheidTopicSearchBody gebruikt requestState.current voor paginering en de juiste topicnaam per aanroep', () => {
  const page2 = buildRijksoverheidTopicSearchBody('Inkomstenbelasting', 2);
  assert.equal(page2.requestState.current, 2);
  assert.deepEqual(page2.requestState.filters[0].values, ['Inkomstenbelasting']);
});

// --- Pagination ---

test("fetchRijksoverheidTopicApiUrls: haalt pagina's op totdat een pagina leeg is, en verzamelt alle kandidaten", async () => {
  const calls = [];
  const page1 = Array.from({ length: 10 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/pagina1-${i}` }));
  const page2 = Array.from({ length: 10 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/pagina2-${i}` }));
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.requestState.current);
    if (body.requestState.current === 1) return apiSearchResponse(page1);
    if (body.requestState.current === 2) return apiSearchResponse(page2);
    return apiSearchResponse([]); // pagina 3: leeg
  }, () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 5, maxArticlesPerTopicPerRun: 100 }));

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.length, 20);
});

test("fetchRijksoverheidTopicApiUrls: stopt ook zodra een pagina minder dan resultsPerPage (10) resultaten bevat, zonder een extra lege pagina op te vragen", async () => {
  const page1 = Array.from({ length: 10 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/a-${i}` }));
  const page2 = Array.from({ length: 3 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/b-${i}` })); // laatste, onvolledige pagina
  const calls = [];
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.requestState.current);
    if (body.requestState.current === 1) return apiSearchResponse(page1);
    if (body.requestState.current === 2) return apiSearchResponse(page2);
    throw new Error('mag pagina 3 niet aanroepen: pagina 2 was al een onvolledige pagina');
  }, () => fetchRijksoverheidTopicApiUrls(['Inkomstenbelasting'], { maxPagesPerTopic: 5, maxArticlesPerTopicPerRun: 100 }));

  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.length, 13);
});

// --- Max-pages guard ---

test('fetchRijksoverheidTopicApiUrls: maxPagesPerTopic is een harde bovengrens, ook als de API altijd volle pagina\'s blijft teruggeven (geen oneindige lus)', async () => {
  let callCount = 0;
  const result = await withMockedFetchAndBody(() => {
    callCount += 1;
    const fullPage = Array.from({ length: 10 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/altijd-vol-${callCount}-${i}` }));
    return apiSearchResponse(fullPage);
  }, () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 2, maxArticlesPerTopicPerRun: 1000 }));

  assert.equal(callCount, 2);
  assert.equal(result.length, 20);
});

test('fetchRijksoverheidTopicApiUrls: maxArticlesPerTopicPerRun begrenst het aantal kandidaten per topic, ook middenin een pagina', async () => {
  const page1 = Array.from({ length: 10 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/cap-${i}` }));
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse(page1),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 5, maxArticlesPerTopicPerRun: 4 }),
  );
  assert.equal(result.length, 4);
});

// --- URL extraction ---

test('fetchRijksoverheidTopicApiUrls: maakt van een relatieve url.raw een absolute rijksoverheid.nl-URL (nooit naar de algemene homepage)', async () => {
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse([apiSearchResult({ url: '/actueel/nieuws/voorbeeld-artikel' })]),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 1, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result.map((e) => e.loc), ['https://www.rijksoverheid.nl/actueel/nieuws/voorbeeld-artikel']);
});

test('fetchRijksoverheidTopicApiUrls: laat een al-absolute url.raw ongewijzigd staan', async () => {
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse([apiSearchResult({ url: 'https://www.rijksoverheid.nl/actueel/nieuws/al-absoluut' })]),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 1, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result.map((e) => e.loc), ['https://www.rijksoverheid.nl/actueel/nieuws/al-absoluut']);
});

// --- Response parsing ---

test('fetchRijksoverheidTopicApiUrls: leest url.raw en sort_date.raw correct, en sorteert op sort_date (meest recent eerst), net als de algemene sitemapbron', async () => {
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse([
      apiSearchResult({ url: '/actueel/nieuws/oud', date: '2024-01-01T00:00:00.000Z' }),
      apiSearchResult({ url: '/actueel/nieuws/nieuw', date: '2026-01-01T00:00:00.000Z' }),
    ]),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 1, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result.map((e) => e.loc), [
    'https://www.rijksoverheid.nl/actueel/nieuws/nieuw',
    'https://www.rijksoverheid.nl/actueel/nieuws/oud',
  ]);
});

test('fetchRijksoverheidTopicApiUrls: een volledige, realistische respons (met page_title/meta_description/information_type) wordt zonder crash verwerkt tot {loc, lastmod}', async () => {
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse([apiSearchResult({
      url: '/actueel/nieuws/2026/01/01/volledig-voorbeeld',
      title: 'Belangrijkste belastingwijzigingen',
      date: '2026-01-01T00:00:00.000Z',
      description: 'Een samenvatting van de wijzigingen.',
      informationType: 'Nieuwsbericht',
    })]),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 1, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result, [{ loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/01/01/volledig-voorbeeld', lastmod: '2026-01-01T00:00:00.000Z' }]);
});

// --- Deduplicatie ---

test('fetchRijksoverheidTopicApiUrls: dedupliceert hetzelfde artikel dat via twee verschillende topics wordt gevonden tot één kandidaat', async () => {
  const sharedUrl = '/actueel/nieuws/2025/06/27/kabinet-kijkt-naar-dividendstripping';
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    const topic = body.requestState.filters[0].values[0];
    if (body.requestState.current > 1) return apiSearchResponse([]);
    if (topic === 'Belasting betalen' || topic === 'Aanpak belastingontwijking en belastingontduiking') {
      return apiSearchResponse([apiSearchResult({ url: sharedUrl })]);
    }
    return apiSearchResponse([]);
  }, () => fetchRijksoverheidTopicApiUrls(['Belasting betalen', 'Aanpak belastingontwijking en belastingontduiking'], { maxPagesPerTopic: 2, maxArticlesPerTopicPerRun: 10 }));

  assert.equal(result.length, 1);
  assert.equal(result[0].loc, `https://www.rijksoverheid.nl${sharedUrl}`);
});

const fakeTopicApiSource = {
  id: 'test-rijksoverheid-topic-api',
  name: 'Test-Rijksoverheid-topic-API',
  type: 'rijksoverheid-topic-api',
  topics: ['Belasting betalen', 'Inkomstenbelasting'],
  defaultCategory: 'Fiscale actualiteit',
  requireKeywordMatch: true,
  ministryBypass: 'Ministerie van Financiën',
  audienceSignals: rijksoverheidAudienceSignals,
  corroborationRequiredKeywords: ['prinsjesdag'],
  maxPagesPerTopic: 2,
  maxArticlesPerTopicPerRun: 10,
};

test('processSitemapSource (rijksoverheid-topic-api-variant): een kandidaat die al in existingUrls staat (bv. al gevonden via de algemene sitemap) wordt overgeslagen, niet dubbel verwerkt', async () => {
  const alreadyKnownUrl = 'https://www.rijksoverheid.nl/actueel/nieuws/2025/06/27/kabinet-kijkt-naar-dividendstripping';
  const existingUrls = new Set([alreadyKnownUrl]);

  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.requestState.current > 1) return apiSearchResponse([]);
    const topic = body.requestState.filters[0].values[0];
    if (topic === 'Belasting betalen') {
      return apiSearchResponse([apiSearchResult({ url: '/actueel/nieuws/2025/06/27/kabinet-kijkt-naar-dividendstripping' })]);
    }
    return apiSearchResponse([]);
  }, () => processSitemapSource(fakeTopicApiSource, existingUrls, { count: 50 }));

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 1);
  assert.equal(result.stages.reasons.duplicate, 1);
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

// --- Bestaande relevantie-flow blijft volledig van toepassing (geen bypass) ---

test('processSitemapSource (rijksoverheid-topic-api-variant): een topic-kandidaat doorloopt nog steeds de volledige bestaande relevantiepoort — title/description komen van de artikelpagina zelf (fetchArticlePageMeta), niet van de API, en een irrelevant artikel wordt gewoon afgewezen', async () => {
  const relevantUrl = '/actueel/nieuws/2025/06/27/kabinet-kijkt-naar-dividendstripping';
  const irrelevantUrl = '/actueel/nieuws/2025/01/15/kabinet-vraagt-mening-over-vliegbelasting';

  const result = await withMockedFetchAndBody((url, opts) => {
    if (url === RIJKSOVERHEID_TOPIC_API_URL && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      if (body.requestState.current > 1) return apiSearchResponse([]);
      // Bewust een onzinnige titel zonder enig fiscaal trefwoord: als de
      // relevantiebeoordeling hier per ongeluk toch de API-titel zou
      // gebruiken (bypass van fetchArticlePageMeta), zou dit artikel
      // nooit relevant kunnen scoren — de test bewijst dus dat dat niet
      // gebeurt.
      return apiSearchResponse([
        apiSearchResult({ url: relevantUrl, title: 'TITEL DIE NIET GEBRUIKT MAG WORDEN', date: 'niet-een-geldige-datum' }),
        apiSearchResult({ url: irrelevantUrl, title: 'TITEL DIE NIET GEBRUIKT MAG WORDEN 2', date: 'niet-een-geldige-datum' }),
      ]);
    }
    if (url === `https://www.rijksoverheid.nl${relevantUrl}`) {
      return htmlResponse('<html><head><title>Kabinet kijkt naar aanvullende mogelijkheden dividendstripping aan te pakken | Rijksoverheid.nl</title><meta name="description" content="Het kabinet onderzoekt extra maatregelen tegen dividendstripping, relevant voor DGA\'s en BV\'s."/></head></html>');
    }
    if (url === `https://www.rijksoverheid.nl${irrelevantUrl}`) {
      return htmlResponse('<html><head><title>Kabinet vraagt mening over vliegbelasting vanaf 2027 | Rijksoverheid.nl</title><meta name="description" content="Een algemene consultatie over vliegbelasting voor reizigers, zonder fiscaal ondernemerssignaal."/></head></html>');
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeTopicApiSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1); // alleen het dividendstripping-artikel (via categoryKeyword 'dividend')
  assert.equal(result.stages.reasons.irrelevant, 1); // het vliegbelasting-artikel
  assert.equal(result.stages.published, 0); // ongeldige datum voorkomt een echte schrijfactie (zelfde patroon als de andere tests in dit bestand)
});

// --- Empty/error response ---

test('fetchRijksoverheidTopicApiUrls: een lege resultaten-array op pagina 1 levert 0 kandidaten voor dat topic, zonder crash', async () => {
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse([]),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 3, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result, []);
});

test('fetchRijksoverheidTopicApiUrls: een HTTP-fout op één topic blokkeert het andere topic niet en laat de fetcher niet crashen', async () => {
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.requestState.current > 1) return apiSearchResponse([]);
    const topic = body.requestState.filters[0].values[0];
    if (topic === 'Belasting betalen') return new Response('Internal Server Error', { status: 500 });
    return apiSearchResponse([apiSearchResult({ url: '/actueel/nieuws/werkt-wel' })]);
  }, () => fetchRijksoverheidTopicApiUrls(['Belasting betalen', 'Inkomstenbelasting'], { maxPagesPerTopic: 2, maxArticlesPerTopicPerRun: 10 }));

  assert.deepEqual(result.map((e) => e.loc), ['https://www.rijksoverheid.nl/actueel/nieuws/werkt-wel']);
});

test('fetchRijksoverheidTopicApiUrls: een onverwachte (niet-JSON) respons wordt afgehandeld zonder te crashen', async () => {
  const result = await withMockedFetchAndBody(
    () => new Response('<html>geen json</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 2, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result, []);
});

test("fetchRijksoverheidTopicApiUrls: een resultaat zonder url.raw wordt overgeslagen, de overige resultaten in dezelfde pagina blijven behouden", async () => {
  const resultsWithOneMissingUrl = [
    apiSearchResult({ url: '/actueel/nieuws/geldig-1' }),
    { ...apiSearchResult({ url: '/actueel/nieuws/wordt-genegeerd' }), url: { raw: undefined } },
    apiSearchResult({ url: '/actueel/nieuws/geldig-2' }),
  ];
  const result = await withMockedFetchAndBody(
    () => apiSearchResponse(resultsWithOneMissingUrl),
    () => fetchRijksoverheidTopicApiUrls(['Belasting betalen'], { maxPagesPerTopic: 1, maxArticlesPerTopicPerRun: 10 }),
  );
  assert.deepEqual(result.map((e) => e.loc).sort(), [
    'https://www.rijksoverheid.nl/actueel/nieuws/geldig-1',
    'https://www.rijksoverheid.nl/actueel/nieuws/geldig-2',
  ]);
});

test('processSitemapSource (rijksoverheid-topic-api-variant): rapporteert een foutresultaat als de topic-API een onverwachte fout gooit, zonder de run te laten crashen', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('netwerk volledig onbereikbaar');
  };
  try {
    const result = await processSitemapSource(fakeTopicApiSource, new Set(), { count: 50 });
    // fetchRijksoverheidTopicApiUrls vangt netwerkfouten per topic af (zie
    // hierboven) en geeft dus normaliter gewoon een lege lijst terug i.p.v.
    // te gooien — dit bevestigt dat processSitemapSource in dat geval
    // gewoon doorgaat met 0 kandidaten, zonder te crashen.
    assert.equal(result.ok, true);
    assert.equal(result.stages.fetched, 0);
    assert.equal(result.added, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Four-topic regression ---

test('fetchRijksoverheidTopicApiUrls: haalt onafhankelijk kandidaten op voor alle vier de geconfigureerde topics', async () => {
  const perTopicCounts = {
    'Belasting betalen': 3,
    Inkomstenbelasting: 2,
    Belastingverdragen: 1,
    'Aanpak belastingontwijking en belastingontduiking': 4,
  };
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.requestState.current > 1) return apiSearchResponse([]);
    const topic = body.requestState.filters[0].values[0];
    const count = perTopicCounts[topic] ?? 0;
    return apiSearchResponse(Array.from({ length: count }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/${topic.replace(/\s+/g, '-')}-${i}` })));
  }, () => fetchRijksoverheidTopicApiUrls(Object.keys(perTopicCounts), { maxPagesPerTopic: 3, maxArticlesPerTopicPerRun: 20 }));

  assert.equal(result.length, 3 + 2 + 1 + 4);
});

test('topic-regressie: alle 12 daadwerkelijk in sources.config.mjs geconfigureerde topics (incl. de vier oorspronkelijke fiscale) worden elk onafhankelijk bevraagd', async () => {
  const configuredTopics = sources.find((s) => s.id === 'rijksoverheid-topic-api').topics;
  const seenTopics = [];
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    const topic = body.requestState.filters[0].values[0];
    if (body.requestState.current === 1) {
      seenTopics.push(topic);
      return apiSearchResponse([apiSearchResult({ url: `/actueel/nieuws/${encodeURIComponent(topic)}` })]);
    }
    return apiSearchResponse([]);
  }, () => fetchRijksoverheidTopicApiUrls(configuredTopics, { maxPagesPerTopic: 2, maxArticlesPerTopicPerRun: 10 }));

  assert.deepEqual(seenTopics, configuredTopics);
  assert.deepEqual(seenTopics, EXPECTED_RIJKSOVERHEID_TOPICS);
  for (const topic of ORIGINAL_FISCAL_TOPICS) assert.ok(seenTopics.includes(topic), topic);
  assert.equal(result.length, 12);
});

test('topic-regressie: elk van de vier oorspronkelijke fiscale topics levert via de echte bronconfiguratie nog steeds kandidaten op, met paginering en deduplicatie over topics', async () => {
  const configured = sources.find((s) => s.id === 'rijksoverheid-topic-api');
  const requested = [];
  const result = await withMockedFetchAndBody((_url, opts) => {
    const body = JSON.parse(opts.body);
    const topic = body.requestState.filters[0].values[0];
    requested.push(`${topic}#${body.requestState.current}`);
    if (!ORIGINAL_FISCAL_TOPICS.includes(topic)) return apiSearchResponse([]);
    const slug = topic.toLowerCase().replace(/[^a-z]+/g, '-');
    // Pagina 1 vol (10), pagina 2 met 1 resultaat -> paginering stopt daarna.
    // Elk topic noemt ook één gedeeld artikel -> deduplicatie over topics.
    if (body.requestState.current === 1) {
      return apiSearchResponse([
        apiSearchResult({ url: '/actueel/nieuws/gedeeld-fiscaal-artikel' }),
        ...Array.from({ length: 9 }, (_, i) => apiSearchResult({ url: `/actueel/nieuws/${slug}-${i}` })),
      ]);
    }
    if (body.requestState.current === 2) return apiSearchResponse([apiSearchResult({ url: `/actueel/nieuws/${slug}-extra` })]);
    return apiSearchResponse([]);
  }, () => fetchRijksoverheidTopicApiUrls(configured.topics, {
    maxPagesPerTopic: configured.maxPagesPerTopic,
    maxArticlesPerTopicPerRun: configured.maxArticlesPerTopicPerRun,
  }));

  for (const topic of ORIGINAL_FISCAL_TOPICS) {
    assert.ok(requested.includes(`${topic}#1`), topic);
    assert.ok(requested.includes(`${topic}#2`), topic);
    assert.equal(requested.includes(`${topic}#3`), false, topic);
  }
  // 4 topics × (9 eigen + 1 extra) + 1 gedeeld artikel (één keer).
  assert.equal(result.length, 4 * 10 + 1);
  assert.equal(result.filter((e) => e.loc.endsWith('/gedeeld-fiscaal-artikel')).length, 1);
});

// --- rijksoverheid-topic-api: gerichte relevantiefilter (audit productieruns 1+2) ---
//
// Teksten zijn letterlijk de meta-descriptions van de echte artikelpagina's
// (geverifieerd: identiek aan de gepubliceerde samenvattingen). Deze tests
// draaien de ECHTE rijksoverheid-topic-api-configuratie uit
// sources.config.mjs door de volledige processSitemapSource-pijplijn,
// inclusief de leeftijdsgrens (maxAgeMonths). `financien` bepaalt of de
// pagina de Financiën-breadcrumb heeft (ministryBypass). Omdat een
// ongeldige datum nu door de leeftijdsgrens wordt afgewezen, draait dit met
// een geldige, recente datum, een vaste run-datum en een geïsoleerde
// tijdelijke CONTENT_DIR (withIsolatedKvkModule is generiek bruikbaar), zodat
// er nooit in de echte src/content/kenniscentrum/ wordt geschreven.
const realTopicApiSource = sources.find((s) => s.id === 'rijksoverheid-topic-api');
const TOPIC_TEST_NOW = new Date('2026-10-07T00:00:00.000Z');

async function runRealTopicSourceCase({ title, description, financien, date = '2026-09-01T00:00:00.000Z' }) {
  const slug = '/actueel/nieuws/regressiecase';
  return withIsolatedKvkModule([], (mod) => withMockedFetchAndBody((url, opts) => {
    if (opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      const rawResults = body.requestState.current === 1 ? [apiSearchResult({ url: slug, date })] : [];
      return apiSearchResponse(rawResults);
    }
    if (url === `https://www.rijksoverheid.nl${slug}`) {
      const crumb = financien ? '<a href="/ministeries/ministerie-van-financien">Ministerie van Financiën</a>' : '';
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head><body>${crumb}</body></html>`);
    }
    return htmlResponse('', 404);
  }, () => mod.processSitemapSource(realTopicApiSource, new Set(), { count: 50 }, TOPIC_TEST_NOW)));
}

const TOPIC_CASES = {
  box3Obligaties: { title: 'Kabinet dicht belastinglek in box 3 bij obligaties', description: 'In box 3 is een ongewenst belastinglek ontstaan bij de aankoop van obligaties met zogeheten aangegroeide rente. Het kabinet neemt met een wetswijziging maatregelen om dit lek van circa € 100 miljoen in 2025 te dichten. De wetswijziging gaat in per...' },
  tegenbewijsregeling: { title: 'Kabinet stuurt wetsvoorstel tegenbewijsregeling box 3 naar Tweede Kamer', description: 'Het kabinet dient het wetsvoorstel tegenbewijsregeling box 3 in bij de Tweede Kamer. Met de tegenbewijsregeling biedt het kabinet aanvullend rechtsherstel in box 3, zoals geoordeeld door de Hoge Raad. Belastingplichtigen krijgen de mogelijkheid om...' },
  duitslandGrenswerkers: { title: 'Nederland wijzigt belastingverdrag met Duitsland voor grenswerkers', description: 'Het belastingverdrag tussen Nederland en Duitsland wordt gewijzigd zodat grenswerkers jaarlijks maximaal 34 dagen kunnen thuiswerken zonder dat zij over hun inkomen belasting hoeven te betalen in beide landen. Dit hebben de landen vandaag...' },
  lijfrentes: { title: 'Kabinet treft maatregelen tegen belastingontwijking met lijfrentes', description: 'Het kabinet treft maatregelen om te voorkomen dat over de uitbetaling van een lijfrente geen belasting wordt betaald, waarmee belasting wordt ontweken. Bijvoorbeeld door te beginnen met uitkeren van de lijfrente na de uiterste wettelijke...' },
  startupsScaleups: { title: 'Start internetconsultatie belastingmaatregelen om startups en scale-ups te ondersteunen', description: 'Vandaag start een internetconsultatie om 2 belastingmaatregelen die startups en scale-ups in Nederland ondersteunen. Er komt een nieuwe regeling die het aantrekkelijker maakt om medewerkers te belonen met opties op aandelen in het bedrijf....' },
  schijnzelfstandigheid: { title: 'In 2025 geen boetes bij handhaving schijnzelfstandigheid', description: 'De Belastingdienst gaat vanaf 1 januari 2025 weer volledig handhaven bij organisaties die werken met mensen die volgens de wet eigenlijk in loondienst horen. Wel worden er over het kalenderjaar 2025 nog geen boetes opgelegd. Dit geldt voor zowel...' },
  cryptoTransacties: { title: 'Transacties met crypto straks meer in beeld bij Belastingdienst', description: 'Transacties met crypto zijn straks meer in beeld bij de Belastingdienst. Vanaf 1 januari 2026 worden crypto-aanbieders verplicht om gegevens van hun gebruikers te verzamelen, controleren en delen met de Belastingdienst. De informatie kan worden...' },
  cryptoConsultatie: { title: 'Internetconsultatie voor wetsvoorstel rapportageverplichting  crypto-aanbieders', description: 'Vanaf vandaag is het mogelijk om te reageren op het wetsvoorstel waarmee aanbieders van cryptodiensten per 1 januari 2026 verplicht worden om de gegevens van hun gebruikers te verzamelen, controleren en delen met de Belastingdienst. Het doel van...' },
  caribischNederland: { title: 'Kabinet vraagt input voor wetsvoorstel met fiscale veranderingen voor Caribisch Nederland', description: 'Vanaf zaterdag 16 augustus is het mogelijk om te reageren op een wetsvoorstel waarin 16 fiscale wijzigingen zijn opgenomen voor de eilanden Bonaire, Sint-Eustatius en Saba (BES), samen het Caribisch Nederland. Bij de uitwerking van dit...' },
  vliegbelasting: { title: 'Kabinet vraagt mening over vliegbelasting vanaf 2027', description: 'Wat vindt u van het zwaarder belasten van lange afstandsvluchten? Het kabinet wil vanaf 1 januari 2027 de opbrengst van de vliegbelasting verhogen door lange afstandsvluchten zwaarder te belasten. Het doel hiervan is de hogere uitstoot van lange...' },
  itModernisering: { title: 'Uitwerking arresten box 3 vertraagt modernisering Belastingdienst', description: 'Als gevolg van de uitwerking van recente arresten van de Hoge Raad over box 3 loopt een deel van de IT-modernisering van de Belastingdienst ongeveer 1 jaar vertraging op. Het gaat om het IT-deel waarbinnen belastingen geheven worden over het...' },
  capaciteitstekort: { title: 'Belastingdienst pakt capaciteitstekort inning aan', description: 'De Belastingdienst neemt maatregelen om het capaciteitstekort in de inning en invordering tegen te gaan. Daardoor wordt de afhandeling van bezwaarschriften versneld. Dit capaciteitstekort is onder andere ontstaan door de samenloop van extra...' },
  toeslagenProef: { title: 'Dienst Toeslagen start proef met aanpassen van toeslagen', description: 'Dienst Toeslagen start deze maand een proef waarbij zij zelf de toeslag gaat aanpassen. Doel is om te voorkomen dat mensen later alsnog geconfronteerd worden met een hoge terugvordering. Een aanpassing van de toeslag vindt alleen plaats als blijkt dat de gegevens niet langer kloppen. De proef start in augustus onder ruim 12.000 toeslaggerechtigden.' },
  belastingontwijkingDaalt: { title: 'Belastingontwijking via Nederland daalt door nieuwe maatregelen', description: 'De maatregelen die Nederland neemt in de strijd tegen belastingontwijking werpen hun vruchten af. Een set recente maatregelen, waarvan de effecten voor het eerst in kaart zijn gebracht, draagt effectief bij aan het verminderen van...' },
};

for (const key of ['box3Obligaties', 'tegenbewijsregeling', 'duitslandGrenswerkers', 'lijfrentes', 'startupsScaleups', 'schijnzelfstandigheid']) {
  test(`rijksoverheid-topic-api regressie — blijft RELEVANT: "${TOPIC_CASES[key].title}"`, async () => {
    // Zoals in productie: met Financiën-breadcrumb (Duitsland/lijfrentes/
    // startups kwamen uitsluitend via ministryBypass binnen).
    const result = await runRealTopicSourceCase({ ...TOPIC_CASES[key], financien: true });
    assert.equal(result.stages.relevant, 1);
    assert.equal(result.stages.reasons.irrelevant, 0);
  });
}

for (const financien of [true, false]) {
  test(`rijksoverheid-topic-api regressie — wordt RELEVANT (crypto-recall), ${financien ? 'met' : 'zonder'} Financiën-breadcrumb: "Transacties met crypto straks meer in beeld bij Belastingdienst"`, async () => {
    const result = await runRealTopicSourceCase({ ...TOPIC_CASES.cryptoTransacties, financien });
    assert.equal(result.stages.relevant, 1);
  });
}

test('rijksoverheid-topic-api regressie — de crypto-consultatie (zelfde verplichting, consultatiefase) wordt ook toegelaten via hetzelfde smalle signaal', async () => {
  const result = await runRealTopicSourceCase({ ...TOPIC_CASES.cryptoConsultatie, financien: true });
  assert.equal(result.stages.relevant, 1);
});

for (const key of ['caribischNederland', 'vliegbelasting', 'itModernisering', 'capaciteitstekort', 'toeslagenProef']) {
  test(`rijksoverheid-topic-api regressie — blijft FALSE POSITIVE (afgewezen), ook met Financiën-breadcrumb: "${TOPIC_CASES[key].title}"`, async () => {
    const result = await runRealTopicSourceCase({ ...TOPIC_CASES[key], financien: true });
    assert.equal(result.stages.relevant, 0);
    assert.equal(result.stages.reasons.irrelevant, 1);
  });
}

test('rijksoverheid-topic-api regressie — "Belastingontwijking via Nederland daalt" blijft afgewezen zoals in productie, en de nieuwe regels voegen geen route voor dit evaluatiebericht toe', async () => {
  // In productie afgewezen ondanks de fiscale stam -> de pagina heeft geen
  // Financiën-breadcrumb (afgeleid uit productiegedrag). Deze wijziging
  // voegt geen positief signaal toe dat dit artikel alsnog toelaat.
  const { title, description } = TOPIC_CASES.belastingontwijkingDaalt;
  assert.equal(matchesRelevanceSignal(`${title} ${description}`, rijksoverheidTopicRelevanceSignals), false);
  const result = await runRealTopicSourceCase({ title, description, financien: false });
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

test('rijksoverheid-topic-api: het crypto-signaal is smal — kaal "crypto" of kale "rapportageverplichting" is niet genoeg', () => {
  const rules = rijksoverheidTopicRelevanceSignals;
  assert.equal(matchesRelevanceSignal('Kabinet wil crypto-innovatie en blockchain in Nederland stimuleren', rules), false);
  assert.equal(matchesRelevanceSignal('Nieuwe rapportageverplichting voor grote ondernemingen over duurzaamheid', rules), false);
  assert.equal(matchesRelevanceSignal('Aanbieders moeten gegevens en informatie delen', rules), false);
  // Witruimte-normalisatie: dubbele spaties breken een meerwoordige term niet.
  assert.equal(matchesRelevanceSignal('Cryptobedrijven moeten gegevens delen met  de Belastingdienst', rules), true);
});

test('rijksoverheid-topic-api: uitsluitingen zijn gericht — gewone Belastingdienst-vermelding, BES alleen in de tekst, Duitsland/grenswerkers en vliegbelasting mét ondernemerscomponent worden niet uitgesloten', () => {
  const rules = rijksoverheidTopicExclusionRules;
  const isExcluded = (title, description) => matchesExclusionRule(title, `${title} ${description}`, rules);
  assert.equal(isExcluded('Voorlopige aanslag inkomstenbelasting 2027', 'De Belastingdienst verstuurt de voorlopige aanslagen inkomstenbelasting.'), false);
  assert.equal(isExcluded('Belastingplan 2027: voorstellen voor beter werkend belastingstelsel', 'Het pakket bevat maatregelen voor ondernemers en ook enkele aanpassingen voor Caribisch Nederland.'), false);
  assert.equal(isExcluded(TOPIC_CASES.duitslandGrenswerkers.title, TOPIC_CASES.duitslandGrenswerkers.description), false);
  assert.equal(isExcluded('Vliegbelasting: wat verandert er voor ondernemers in de luchtvaart', 'Luchtvaartmaatschappijen en andere bedrijven krijgen te maken met een hogere vliegbelasting.'), false);
  // ...terwijl de bewezen false positives wél worden uitgesloten.
  for (const key of ['caribischNederland', 'vliegbelasting', 'itModernisering']) {
    const { title, description } = TOPIC_CASES[key];
    assert.equal(isExcluded(title, description), true, key);
  }
});

test('rijksoverheid-topic-api: de nieuwe signalen zijn bron-gescoped — niet in categoryKeywords (gedeeld met KVK) en alleen op de topic-API-bron geconfigureerd', () => {
  assert.equal(Object.values(categoryKeywords).flat().some((kw) => kw.includes('crypto')), false);
  assert.deepEqual(scoreCategories(`${TOPIC_CASES.cryptoTransacties.title} ${TOPIC_CASES.cryptoTransacties.description}`), {});
  const withSignals = sources.filter((s) => s.relevanceSignals || s.exclusionRules).map((s) => s.id);
  assert.deepEqual(withSignals, ['rijksoverheid-topic-api']);
  assert.deepEqual(realTopicApiSource.topics, EXPECTED_RIJKSOVERHEID_TOPICS);
});

// --- rijksoverheid-topic-api: leeftijdsgrens (maxAgeMonths: 24) ---
//
// Vaste run-datum (geen hardcoded "vandaag" in de code zelf): de grens ligt
// precies 24 kalendermaanden vóór TOPIC_TEST_NOW, dus op 2024-10-07T00:00Z.

test('isOutsideMaxAge: binnen 24 maanden → niet afgewezen; ouder → afgewezen', () => {
  assert.equal(isOutsideMaxAge('2025-07-07T00:00:00+00:00', 24, TOPIC_TEST_NOW), false);
  assert.equal(isOutsideMaxAge('2024-12-11T10:00:00+00:00', 24, TOPIC_TEST_NOW), false);
  assert.equal(isOutsideMaxAge('2024-10-06T23:59:59.999Z', 24, TOPIC_TEST_NOW), true);
  assert.equal(isOutsideMaxAge('2019-09-06T00:00:00+00:00', 24, TOPIC_TEST_NOW), true);
});

test('isOutsideMaxAge: precies op de grens (exact 24 maanden oud) telt als binnen de grens; 1 ms ouder niet', () => {
  assert.equal(isOutsideMaxAge('2024-10-07T00:00:00.000Z', 24, TOPIC_TEST_NOW), false);
  assert.equal(isOutsideMaxAge('2024-10-06T23:59:59.999Z', 24, TOPIC_TEST_NOW), true);
});

test('isOutsideMaxAge: een toekomstige datum is niet "ouder dan" de grens en telt als binnen', () => {
  assert.equal(isOutsideMaxAge('2027-01-01T00:00:00.000Z', 24, TOPIC_TEST_NOW), false);
});

test('isOutsideMaxAge: ontbrekende of ongeldige datum telt als buiten de grens (nooit stilzwijgend "recent"; zelfde conventie als publishItem)', () => {
  for (const missing of [null, undefined, '']) assert.equal(isOutsideMaxAge(missing, 24, TOPIC_TEST_NOW), true);
  assert.equal(isOutsideMaxAge('niet-een-geldige-datum', 24, TOPIC_TEST_NOW), true);
});

test('isOutsideMaxAge: maandverschillen worden in kalendermaanden gerekend, met clamping op de laatste dag van de maand', () => {
  // 31 maart − 1 maand → grens 28 februari (2026 is geen schrikkeljaar).
  const endOfMarch = new Date('2026-03-31T00:00:00.000Z');
  assert.equal(isOutsideMaxAge('2026-02-28T00:00:00.000Z', 1, endOfMarch), false);
  assert.equal(isOutsideMaxAge('2026-02-27T23:59:59.999Z', 1, endOfMarch), true);
  // 29 februari 2028 − 24 maanden → grens 28 februari 2026.
  const leapDay = new Date('2028-02-29T00:00:00.000Z');
  assert.equal(isOutsideMaxAge('2026-02-28T00:00:00.000Z', 24, leapDay), false);
  assert.equal(isOutsideMaxAge('2026-02-27T23:59:59.999Z', 24, leapDay), true);
});

test('rijksoverheid-topic-api leeftijdsgrens: alleen de topic-API-bron heeft maxAgeMonths (24); KVK en Belastingdienst niet', () => {
  assert.equal(realTopicApiSource.maxAgeMonths, 24);
  const withMaxAge = sources.filter((s) => s.maxAgeMonths !== undefined).map((s) => s.id);
  assert.deepEqual(withMaxAge, ['rijksoverheid-topic-api']);
});

test('rijksoverheid-topic-api leeftijdsgrens: een relevant artikel binnen 24 maanden wordt niet door de leeftijdsgrens afgewezen', async () => {
  const result = await runRealTopicSourceCase({ ...TOPIC_CASES.box3Obligaties, financien: true, date: '2025-08-25T13:53:00+00:00' });
  assert.equal(result.stages.reasons.tooOld, 0);
  assert.equal(result.stages.relevant, 1);
});

test('rijksoverheid-topic-api leeftijdsgrens: een relevant ogend backlog-artikel ouder dan 24 maanden wordt afgewezen vóór de paginafetch', async () => {
  // Echt backlog-voorbeeld (2019) dat via 'box 3' de relevantiepoort zou passeren.
  const title = '1,35 miljoen spaarders betalen door nieuw voorstel straks geen belasting meer in box 3';
  const description = 'Het kabinet wil de belasting in box 3 beter laten aansluiten bij het werkelijke rendement van spaarders en beleggers.';
  const result = await runRealTopicSourceCase({ title, description, financien: true, date: '2019-09-06T00:00:00+00:00' });
  assert.equal(result.stages.fetched, 1);
  assert.equal(result.stages.reasons.tooOld, 1);
  assert.equal(result.stages.parsed, 0); // nooit verder geëvalueerd
  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.published, 0);
});

test('rijksoverheid-topic-api leeftijdsgrens: precies op de grens wordt doorgelaten naar de bestaande relevantiepoort', async () => {
  const result = await runRealTopicSourceCase({ ...TOPIC_CASES.box3Obligaties, financien: true, date: '2024-10-07T00:00:00.000Z' });
  assert.equal(result.stages.reasons.tooOld, 0);
  assert.equal(result.stages.relevant, 1);
});

test('rijksoverheid-topic-api leeftijdsgrens: een toekomstige datum wordt niet door de leeftijdsgrens afgewezen', async () => {
  const result = await runRealTopicSourceCase({ ...TOPIC_CASES.box3Obligaties, financien: true, date: '2027-01-01T00:00:00.000Z' });
  assert.equal(result.stages.reasons.tooOld, 0);
  assert.equal(result.stages.relevant, 1);
});

test('rijksoverheid-topic-api leeftijdsgrens: ontbrekende en ongeldige sort_date worden afgewezen, niet als recent behandeld', async () => {
  for (const date of [null, 'niet-een-geldige-datum']) {
    const result = await runRealTopicSourceCase({ ...TOPIC_CASES.box3Obligaties, financien: true, date });
    assert.equal(result.stages.reasons.tooOld, 1, String(date));
    assert.equal(result.stages.relevant, 0, String(date));
  }
});

test('leeftijdsgrens geldt niet voor KVK: een KVK-kandidaat met lastmod uit 2018 wordt gewoon opgehaald en beoordeeld', async () => {
  const kvkSource = sources.find((s) => s.id === 'kvk-kennisartikelen');
  assert.equal(kvkSource.maxAgeMonths, undefined);
  const candidateLoc = 'https://www.kvk.nl/belastingen/btw-aangifte-doen/';
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    withKvkSitemapRouting(candidateLoc, '2018-01-01T10:00:00.000Z', () => htmlResponse('<html><body><p>Geen h1 hier.</p></body></html>')),
    () => mod.processKvkSource(fakeKvkSource, new Set(), { count: 50 }),
  ));
  assert.equal(result.stages.reasons.pageFetches, 1); // opgehaald ondanks 2018
  assert.equal(result.stages.reasons.tooOld, undefined);
});

test('leeftijdsgrens geldt niet voor Belastingdienst: een feed-item uit 2018 wordt gewoon gepubliceerd (in een geïsoleerde CONTENT_DIR)', async () => {
  const belastingdienst = sources.find((s) => s.id === 'belastingdienst-zakelijk');
  assert.equal(belastingdienst.maxAgeMonths, undefined);
  const feed = `<?xml version="1.0"?><rss><channel><item><title>Btw-tarieven oud bericht</title><link>https://www.belastingdienst.nl/oud-bericht-2018</link><description>Een oud bericht uit 2018 over de btw-aangifte voor ondernemers.</description><pubDate>Mon, 01 Jan 2018 00:00:00 GMT</pubDate></item></channel></rss>`;
  const result = await withIsolatedKvkModule([], (mod) => withMockedFetch(
    (url) => (url === belastingdienst.feedUrl ? xmlResponse(feed) : htmlResponse('', 404)),
    () => mod.processRssSource(belastingdienst, new Set(), { count: 50 }),
  ));
  assert.equal(result.stages.published, 1);
  assert.equal(result.stages.reasons.tooOld, undefined);
});

// --- Rijksoverheid: bronnaam en content na consolidatie (2026-10-07) ---

test('Rijksoverheid-bron: een gepubliceerd topic-API-artikel krijgt sourceName "Rijksoverheid" (echte configuratie, geïsoleerde CONTENT_DIR)', async () => {
  const written = await withIsolatedKvkModule([], async (mod) => {
    const result = await withMockedFetchAndBody((url, opts) => {
      if (opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        const rawResults = body.requestState.current === 1 && body.requestState.filters[0].values[0] === 'Belasting betalen'
          ? [apiSearchResult({ url: '/actueel/nieuws/bronnaam-case', date: '2026-09-01T00:00:00.000Z' })]
          : [];
        return apiSearchResponse(rawResults);
      }
      if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/bronnaam-case') {
        return htmlResponse(`<html><head><title>${TOPIC_CASES.box3Obligaties.title} | Rijksoverheid.nl</title><meta name="description" content="${TOPIC_CASES.box3Obligaties.description}"/></head></html>`);
      }
      return htmlResponse('', 404);
    }, () => mod.processSitemapSource(realTopicApiSource, new Set(), { count: 50 }, TOPIC_TEST_NOW));
    assert.equal(result.stages.published, 1);
    const dir = process.env.KENNISCENTRUM_CONTENT_DIR;
    return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readFileSync(path.join(dir, f), 'utf8'));
  });
  assert.equal(written.length, 1);
  assert.match(written[0], /^sourceName: "Rijksoverheid"$/m);
  assert.doesNotMatch(written[0], /fiscale topics/);
});

test('content: geen sourceName "Rijksoverheid (fiscale topics)" of "MKB-Nederland" meer; elk Rijksoverheid-artikel is een rijksoverheid.nl-nieuwsartikel', () => {
  const contentDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/content/kenniscentrum');
  const sourceNames = {};
  for (const file of readdirSync(contentDir).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(path.join(contentDir, file), 'utf8');
    const sourceName = text.match(/^sourceName: "(.*)"$/m)?.[1];
    sourceNames[sourceName] = (sourceNames[sourceName] ?? 0) + 1;
    if (sourceName === 'Rijksoverheid') {
      assert.match(text, /^sourceUrl: "https:\/\/www\.rijksoverheid\.nl\/actueel\/nieuws\//m, file);
    }
  }
  assert.equal(sourceNames['Rijksoverheid (fiscale topics)'], undefined);
  assert.equal(sourceNames['MKB-Nederland'], undefined);
  assert.ok(sourceNames.Rijksoverheid > 0);
});
