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
} from './fetch-articles.mjs';

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

test('classifyKvkRelevance + isKvkServiceOrProductPage samen: dry-run 3-ruis wordt nu afgewezen, sterke artikelen blijven hoog', () => {
  // De volledige selectiepijplijn zoals processKvkSource/dry-run-kvk.mjs die
  // toepast: eerst het service/product-signaal, dan pas classifyKvkRelevance.
  function finalTier(url, title, description) {
    const combined = `${title} ${description}`;
    if (isKvkProcedurePage(combined)) return 'afgewezen';
    if (isKvkServiceOrProductPage(url, combined)) return 'afgewezen';
    return downgradeIfTitleHasNoSignal(title, classifyKvkRelevance(combined)).tier;
  }

  assert.equal(finalTier('https://www.kvk.nl/producten-bestellen/kvk-dataservice-jaarrekeningen/', 'KVK Dataservice Jaarrekeningen', 'Bestel hier de officiële dataservice met jaarrekeningen uit het Handelsregister.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/pers/presskit-kvk-beeldbank/', 'Presskit KVK - Beeldbank', 'Download hier het persmateriaal en de beeldbank van KVK.'), 'afgewezen');
  assert.equal(finalTier('https://www.kvk.nl/deponeren/jaarrekening-deponeren-bedrijfsklasse-groot/', 'Jaarrekening deponeren bedrijfsklasse groot', 'Bedrijven in bedrijfsklasse groot moeten hun jaarrekening binnen de wettelijke termijn deponeren.'), 'afgewezen');

  assert.equal(finalTier('https://www.kvk.nl/deponeren/jaarrekening-wel-of-niet-deponeren/', 'Jaarrekening wel of niet deponeren?', 'Niet elke onderneming is verplicht een jaarrekening te deponeren. Lees hier wanneer dit wel en niet moet.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/internationaal/wat-is-de-eu-kor/', 'Wat is de EU-KOR?', 'De EU-KOR is een btw-vrijstellingsregeling voor kleine ondernemers die internationaal zakendoen.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/wetten-en-regels/wet-dba-voorkom-schijnzelfstandigheid/', 'Wet DBA: voorkom schijnzelfstandigheid', 'De Wet DBA regelt wanneer sprake is van schijnzelfstandigheid bij het inhuren van zzp\'ers.'), 'hoog');
  assert.equal(finalTier('https://www.kvk.nl/geldzaken/de-dga-en-werknemersverzekeringen/', 'De dga en werknemersverzekeringen', 'Als dga van uw bv gelden andere regels voor werknemersverzekeringen dan voor gewoon personeel.'), 'hoog');
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
