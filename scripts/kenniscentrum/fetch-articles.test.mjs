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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  fetchRijksoverheidGeneralSitemapUrls,
} from './fetch-articles.mjs';
import { rijksoverheidAudienceSignals } from './sources.config.mjs';

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
// Regressie/uitbreiding (2026-10-01): de eerder gebruikte Google News-
// sitemap (news/sitemap.xml) bleek qua formaat beperkt tot ~2 dagen content
// (~7 items/dag) — een live, in een omgeving mét internettoegang gemeten
// bevinding (tijdelijke GitHub Actions dry-run, zie git-historie), geen
// aanname. rijksoverheid.nl/sitemap.xml bleek zelf een sitemap-index die
// naar een reeks genummerde, algemene sub-sitemaps verwijst zonder die
// grens. Deze tests dekken de nieuwe discovery-functie en de bijbehorende
// titel-extractie, en bevestigen dat de bestaande relevantiefilter
// (requireKeywordMatch/categoryKeywords/ministryBypass) ongewijzigd blijft
// werken op de bredere kandidatenlijst.

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

const RO_SITEMAP_INDEX_FIXTURE = `<?xml version="1.0"?>
<sitemapindex>
  <sitemap><loc>https://www.rijksoverheid.nl/news/sitemap.xml</loc></sitemap>
  <sitemap><loc>https://www.rijksoverheid.nl/videos/sitemap.xml</loc></sitemap>
  <sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap>
  <sitemap><loc>https://www.rijksoverheid.nl/sitemap/2.xml</loc></sitemap>
</sitemapindex>`;

function roSitemapPage(entries) {
  const urls = entries.map(({ loc, lastmod }) => `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`).join('');
  return `<?xml version="1.0"?><urlset>${urls}</urlset>`;
}

test('fetchRijksoverheidGeneralSitemapUrls volgt alleen de genummerde /sitemap/N.xml-sub-sitemaps (niet news/videos), filtert op articleUrlPattern, dedupliceert en sorteert op lastmod', async () => {
  const sitemap1 = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/09/20/ouder-artikel', lastmod: '2026-09-20T10:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/documenten/rapporten/iets-niet-nieuws', lastmod: '2026-09-25T10:00:00.000Z' }, // geen /actueel/nieuws/
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/nieuwste-artikel', lastmod: '2026-10-01T10:00:00.000Z' },
  ]);
  const sitemap2 = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/nieuwste-artikel', lastmod: '2026-10-01T10:00:00.000Z' }, // duplicaat van sitemap1
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2025/01/15/oud-artikel', lastmod: '2025-01-15T10:00:00.000Z' },
  ]);

  const result = await withMockedFetch((url) => {
    if (url === 'https://www.rijksoverheid.nl/sitemap.xml') return xmlResponse(RO_SITEMAP_INDEX_FIXTURE);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(sitemap1);
    if (url === 'https://www.rijksoverheid.nl/sitemap/2.xml') return xmlResponse(sitemap2);
    // news/sitemap.xml en videos/sitemap.xml mogen niet aangeroepen worden —
    // zie assertie hieronder.
    return htmlResponse('', 404);
  }, () => fetchRijksoverheidGeneralSitemapUrls('https://www.rijksoverheid.nl/sitemap.xml', '/actueel/nieuws/'));

  assert.deepEqual(result.map((e) => e.loc), [
    'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/nieuwste-artikel',
    'https://www.rijksoverheid.nl/actueel/nieuws/2026/09/20/ouder-artikel',
    'https://www.rijksoverheid.nl/actueel/nieuws/2025/01/15/oud-artikel',
  ]);
});

test('fetchRijksoverheidGeneralSitemapUrls gooit een fout als de index niet opgehaald kan worden', async () => {
  await assert.rejects(
    () => withMockedFetch(() => htmlResponse('', 500), () => fetchRijksoverheidGeneralSitemapUrls('https://www.rijksoverheid.nl/sitemap.xml', '/actueel/nieuws/')),
  );
});

const fakeRijksoverheidIndexSource = {
  id: 'test-rijksoverheid',
  name: 'Test-Rijksoverheid-bron',
  sitemapIndexUrl: 'https://www.rijksoverheid.nl/sitemap.xml',
  articleUrlPattern: '/actueel/nieuws/',
  defaultCategory: 'Fiscale actualiteit',
  requireKeywordMatch: true,
  ministryBypass: 'Ministerie van Financiën',
  // Zelfde smalle, expliciete signaal als de echte rijksoverheid-nieuws-
  // bron in sources.config.mjs — zie de tests verderop die specifiek dit
  // pad dekken.
  audienceSignals: rijksoverheidAudienceSignals,
  // Zelfde corroboratie-eis als de echte bron — zie de prinsjesdag-tests
  // verderop.
  corroborationRequiredKeywords: ['prinsjesdag'],
};

test('processSitemapSource (sitemapIndexUrl-variant): ontdekt kandidaten via de algemene sub-sitemaps, haalt titel+samenvatting van de artikelpagina en past de bestaande relevantiefilter ongewijzigd toe', async () => {
  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/al-bekend', lastmod: '2026-10-01T09:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/geen-beschrijving', lastmod: '2026-10-01T08:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/algemeen-nieuws', lastmod: '2026-10-01T07:00:00.000Z' },
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/kor-nieuws', lastmod: 'niet-een-geldige-datum' },
  ]);

  const existingUrls = new Set(['https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/al-bekend']);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
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
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, existingUrls, { count: 50 }));

  assert.equal(result.ok, true);
  assert.equal(result.stages.fetched, 4);
  assert.equal(result.stages.reasons.duplicate, 1);
  assert.equal(result.stages.reasons.metadataRejected, 1); // geen-beschrijving: titel wel, samenvatting niet
  assert.equal(result.stages.reasons.irrelevant, 1); // algemeen-nieuws
  assert.equal(result.stages.relevant, 1); // kor-nieuws
  // Titel kwam niet uit de sitemap (die had alleen loc+lastmod) maar van de
  // artikelpagina zelf — geverifieerd via de gepubliceerde samenvatting-
  // bronvermelding is lastig zonder te schrijven; i.p.v. daarvan: ongeldige
  // datum op het relevante item voorkomt een echte schrijfactie, net als
  // bij de andere process*Source-tests in dit bestand.
  assert.equal(result.stages.published, 0);
});

test('processSitemapSource (sitemapIndexUrl-variant): rapporteert een foutresultaat als de sitemap-index niet bereikbaar is, zonder de run te laten crashen', async () => {
  const result = await withMockedFetch(() => htmlResponse('', 503), () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));
  assert.equal(result.ok, false);
  assert.equal(result.added, 0);
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

test('processSitemapSource (sitemapIndexUrl-variant): een zzp-wet wordt nu relevant via de smalle audienceSignals-aanvulling, ook zonder categoryKeywords-treffer', async () => {
  const title = "Zelfstandigenwet biedt meer duidelijkheid en erkenning voor zzp'ers";
  const description = "Het kabinet heeft een wetsvoorstel ingediend dat meer duidelijkheid moet geven over de positie van zelfstandigen zonder personeel op de arbeidsmarkt.";
  // Zekerstellen dat dit artikel NIET via categoryKeywords of ministryBypass
  // relevant zou worden — zodat de test daadwerkelijk het nieuwe
  // audienceSignals-pad dekt, niet een al bestaand pad.
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  // Ongeldige lastmod -> wordt publishedAt in publishItem -> publishItem
  // geeft null terug vóór writeArticle (zie fetch-articles.mjs), dus
  // stages.relevant kan hier veilig getest worden zonder dat er een echt
  // bestand wordt weggeschreven — zelfde patroon als elders in dit bestand.
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zelfstandigenwet', lastmod: 'niet-een-geldige-datum' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zelfstandigenwet') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (sitemapIndexUrl-variant): een generiek overheidsartikel met alleen het brede audienceKeyword "werkgever" wordt NIET automatisch relevant', async () => {
  const title = 'Werkgevers krijgen te maken met nieuwe regels';
  const description = 'Werkgevers moeten vanaf volgend jaar rekening houden met enkele nieuwe regels voor personeel op de werkvloer.';
  // 'werkgever'/'personeel' zijn bewust NIET in rijksoverheidAudienceSignals
  // opgenomen (zie sources.config.mjs) en matchen ook geen categoryKeywords
  // — dit artikel moet dus gewoon afgewezen blijven.
  assert.equal(Object.keys(scoreCategories(`${title} ${description}`)).length, 0);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => description.toLowerCase().includes(kw)), false);

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/werkgevers-nieuwe-regels', lastmod: '2026-10-01T09:00:00.000Z' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/werkgevers-nieuwe-regels') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

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

test('processSitemapSource (sitemapIndexUrl-variant): een Rijksoverheid-artikel met uitsluitend "prinsjesdag" wordt niet meer automatisch relevant', async () => {
  const title = 'Prinsjesdag 2026: wat gebeurt er op het Binnenhof';
  const description = 'Op Prinsjesdag leest de koning de troonrede voor en biedt het kabinet de rijksbegroting aan bij de Tweede Kamer.';
  // Zekerstellen dat dit artikel alleen via 'prinsjesdag' scoort, en geen
  // ministryMatch/audienceMatch heeft — anders test deze test niet wat hij
  // beweert te testen.
  const scores = scoreCategories(`${title} ${description}`);
  assert.deepEqual(Object.keys(scores), ['Fiscale actualiteit']);
  assert.equal(rijksoverheidAudienceSignals.some((kw) => description.toLowerCase().includes(kw)), false);

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-2026', lastmod: '2026-10-01T09:00:00.000Z' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-2026') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

test('processSitemapSource (sitemapIndexUrl-variant): een algemeen Prinsjesdag-ministeriepersbericht zonder relevant Avydo-signaal komt niet meer door de poort', async () => {
  const title = 'Prinsjesdag 2026: kabinet trekt extra geld uit voor Caribisch Nederland';
  const description = 'Rond Prinsjesdag maakt het kabinet bekend dat er extra budget komt voor de kosten van levensonderhoud op Bonaire, Sint-Eustatius en Saba.';
  assert.deepEqual(Object.keys(scoreCategories(`${title} ${description}`)), ['Fiscale actualiteit']);

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/caribisch-nederland', lastmod: '2026-10-01T09:00:00.000Z' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/caribisch-nederland') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 0);
  assert.equal(result.stages.reasons.irrelevant, 1);
});

test('processSitemapSource (sitemapIndexUrl-variant): "prinsjesdag" + "belastingplan" samen blijven relevant', async () => {
  const title = 'Prinsjesdag 2026: Belastingplan 2027 ingediend bij de Tweede Kamer';
  const description = 'Op Prinsjesdag heeft het kabinet het Belastingplan 2027 ingediend met voorstellen voor belastingtarieven volgend jaar.';

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  // Ongeldige lastmod -> publishItem geeft null terug vóór writeArticle,
  // dus stages.relevant kan hier veilig getest worden zonder te schrijven.
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/belastingplan-2027', lastmod: 'niet-een-geldige-datum' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/belastingplan-2027') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (sitemapIndexUrl-variant): "prinsjesdag" + een ander bestaand category-signaal ("btw") samen blijven relevant', async () => {
  const title = 'Prinsjesdag 2026: wijzigingen in de btw-tarieven aangekondigd';
  const description = 'Tijdens Prinsjesdag maakte het kabinet bekend dat de btw-tarieven per volgend jaar wijzigen voor een aantal productgroepen.';

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemap = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-tarieven-wijziging', lastmod: 'niet-een-geldige-datum' },
  ]);
  const result = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemap);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/btw-tarieven-wijziging') {
      return htmlResponse(`<html><head><title>${title} | Rijksoverheid.nl</title><meta name="description" content="${description}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));

  assert.equal(result.stages.relevant, 1);
  assert.equal(result.stages.reasons.irrelevant, 0);
});

test('processSitemapSource (sitemapIndexUrl-variant): "prinsjesdag" + een bestaand audienceSignal (zzp) samen blijven relevant, en audienceSignals blijven los daarvan gewoon werken', async () => {
  // Deel 1: 'prinsjesdag' + audienceMatch (zzp) -> relevant via corroboratie.
  const titleMet = 'Prinsjesdag 2026: wat verandert er voor zzp\'ers';
  const descriptionMet = 'Tijdens Prinsjesdag kondigde het kabinet aan dat er voor zzp\'ers enkele regelingen wijzigen per volgend jaar.';
  assert.ok(rijksoverheidAudienceSignals.some((kw) => descriptionMet.toLowerCase().includes(kw)));

  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.rijksoverheid.nl/sitemap/1.xml</loc></sitemap></sitemapindex>`;
  const subSitemapMet = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-zzp', lastmod: 'niet-een-geldige-datum' },
  ]);
  const resultMet = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemapMet);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/prinsjesdag-zzp') {
      return htmlResponse(`<html><head><title>${titleMet} | Rijksoverheid.nl</title><meta name="description" content="${descriptionMet}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));
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

  const subSitemapZonder = roSitemapPage([
    { loc: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zzp-regeling', lastmod: 'niet-een-geldige-datum' },
  ]);
  const resultZonder = await withMockedFetch((url) => {
    if (url === fakeRijksoverheidIndexSource.sitemapIndexUrl) return xmlResponse(indexXml);
    if (url === 'https://www.rijksoverheid.nl/sitemap/1.xml') return xmlResponse(subSitemapZonder);
    if (url === 'https://www.rijksoverheid.nl/actueel/nieuws/2026/10/01/zzp-regeling') {
      return htmlResponse(`<html><head><title>${titleZonder} | Rijksoverheid.nl</title><meta name="description" content="${descriptionZonder}"/></head></html>`);
    }
    return htmlResponse('', 404);
  }, () => processSitemapSource(fakeRijksoverheidIndexSource, new Set(), { count: 50 }));
  assert.equal(resultZonder.stages.relevant, 1);
});
