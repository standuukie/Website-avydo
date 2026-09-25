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

// Dit is de kern van de regressie die opgelost is: dit exacte artikel (titel
// + brontekst) moet nu een categorie scoren, waar het onder de oude,
// smallere trefwoordenlijst (alleen belasting/btw/ondernemer-achtige termen)
// door de mazen zou zijn geglipt en dus als "niet relevant" was weggefilterd.
test('het e-facturatie-testcase-artikel wordt herkend als relevant (Digitalisering)', () => {
  const title = 'Kabinet kiest voor invoering e-facturatie en rapportage voor bedrijven';
  const description = 'Per 1 juli 2030 wil het kabinet e-facturatie en rapportage invoeren voor bedrijven. Deze verplichting gaat gelden voor zowel internationale als nationale transacties tussen bedrijven.';
  const scores = scoreCategories(`${title} ${description}`);
  assert.ok(Object.keys(scores).length > 0, 'artikel moet minstens één categorie scoren en dus niet weggefilterd worden');
  assert.equal(pickCategory(`${title} ${description}`, null), 'Digitalisering');
});

test('een klassiek belastingartikel blijft correct categoriseren (regressie Belastingdienst-bron)', () => {
  const text = 'Vanaf 1 januari 2026 geldt een nieuw btw-tarief voor logies-ondernemers.';
  assert.equal(pickCategory(text, 'Belastingen'), 'Belastingen');
});

test('een artikel zonder enig relevant trefwoord scoort geen categorie (filter blijft werken)', () => {
  const scores = scoreCategories('Koning bezoekt jubileumfeest op Sint Eustatius voor 250 jaar The First Salute.');
  // Mag leeg zijn of alleen zwakke toevalstreffers; belangrijkste is dat dit
  // niet in de kernonderwerpen scoort.
  assert.ok(!('Belastingen' in scores));
  assert.ok(!('Digitalisering' in scores));
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

test('nieuwe trefwoorden uit de bredere relevantiefilter worden herkend', () => {
  assert.ok('Accountancy' in scoreCategories('De audit door de accountant leverde nieuwe inzichten op.'));
  assert.ok('Digitalisering' in scoreCategories('Kunstmatige intelligentie en de EU AI-verordening: wat verandert er?'));
  assert.ok('Ondernemen' in scoreCategories('Een bedrijfsovername vraagt om een goede vergunning en due diligence.'));
});
