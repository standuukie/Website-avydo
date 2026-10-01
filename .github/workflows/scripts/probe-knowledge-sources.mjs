#!/usr/bin/env node
/**
 * TIJDELIJK diagnose-script, hoort bij .github/workflows/test-knowledge-sources.yml.
 * Geen onderdeel van de productie-Kenniscentrum-pipeline (scripts/kenniscentrum/).
 *
 * Ronde 4 (KVK-only): rondes 1-3 sloten __NEXT_DATA__ en de Next.js
 * data-route uit als bruikbare bron (alleen navigatie, resp. 404). Deze
 * ronde onderzoekt gericht of sitemap_index.xml → documents-*.xml een
 * betrouwbare artikelindex is: per sitemap tellen, <lastmod> controleren,
 * en specifiek zoeken naar drie bekende, nu-zichtbare artikel-slugs. Als
 * fallback (mocht de sitemap geen bruikbare index blijken) wordt ook de
 * publieke HTML van diezelfde drie artikelpagina's geïnspecteerd op
 * <title>, meta description, canonical, zichtbare datum en JSON-LD.
 *
 * Alleen publieke URL's, geen private/undocumented endpoints, geen
 * omzeiling van toegangsbeperkingen. Schrijft niets weg, wijzigt niets,
 * commit niets.
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SITEMAP_INDEX_URL = 'https://www.kvk.nl/sitemap_index.xml';

// Drie artikelen die nu daadwerkelijk zichtbaar zijn op /overzicht/ — als
// referentiepunt om te bepalen of de sitemaps hiermee overeenkomen.
const KNOWN_ARTICLE_SLUGS = [
  'runnen-en-groeien/oorlog-in-iran-dit-zijn-de-gevolgen-voor-ondernemers',
  'wetten-en-regels/de-verplichte-aov-voor-ondernemers-uitgelegd',
  'geldzaken/financiering-vinden-voor-de-start-van-je-bedrijf',
];

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Parseert <url>...<loc>..</loc>...<lastmod>..</lastmod>...</url>-blokken
// zodat loc en lastmod gegarandeerd bij elkaar horen (i.t.t. losse globale
// regex-lijsten, die door elkaar kunnen lopen als lastmod ontbreekt bij
// sommige entries).
function parseUrlEntries(xml) {
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  return blocks.map((block) => {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? null;
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null;
    return { loc, lastmod };
  }).filter((e) => e.loc);
}

async function main() {
  console.log(`Kenniscentrum-bronnenproef ronde 4 (tijdelijk, alleen KVK) — ${new Date().toISOString()}`);
  console.log('Dit script wijzigt niets, voegt geen content toe en commit niets.');
  console.log('Alleen publieke URL\'s, geen private/undocumented endpoints.');

  section(`sitemap_index.xml — ${SITEMAP_INDEX_URL}`);
  let indexRes;
  try {
    indexRes = await fetchWithTimeout(SITEMAP_INDEX_URL);
  } catch (err) {
    console.log(`FOUT bij ophalen: ${err.message}`);
    return;
  }
  console.log(`HTTP status: ${indexRes.status}`);
  if (!indexRes.ok) {
    console.log('Niet OK — stoppen.');
    return;
  }
  const indexXml = await indexRes.text();
  const allSubSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`Totaal sub-sitemaps in de index: ${allSubSitemaps.length}`);

  const documentSitemaps = allSubSitemaps.filter((u) => /\/documents-\d+\.xml$/i.test(u));
  const pageSitemaps = allSubSitemaps.filter((u) => !/\/documents-\d+\.xml$/i.test(u));
  console.log(`"documents-*.xml"-sitemaps: ${documentSitemaps.length}`);
  documentSitemaps.forEach((u) => console.log(`  ${u}`));
  console.log(`Overige sitemaps: ${pageSitemaps.length}`);
  pageSitemaps.forEach((u) => console.log(`  ${u}`));

  // --- Elke documents-*.xml ophalen en analyseren ---
  section('documents-*.xml — per sitemap analyse');
  const allEntries = []; // { loc, lastmod, sourceSitemap }
  for (const sitemapUrl of documentSitemaps) {
    console.log(`\n--- ${sitemapUrl} ---`);
    let res;
    try {
      res = await fetchWithTimeout(sitemapUrl, 20000);
    } catch (err) {
      console.log(`FOUT bij ophalen: ${err.message}`);
      continue;
    }
    console.log(`HTTP status: ${res.status}`);
    if (!res.ok) continue;
    const xml = await res.text();
    console.log(`Response-grootte: ${xml.length} tekens`);
    const entries = parseUrlEntries(xml);
    const withLastmod = entries.filter((e) => e.lastmod);
    console.log(`Aantal <url>-entries: ${entries.length}`);
    console.log(`Daarvan met <lastmod>: ${withLastmod.length}`);
    entries.slice(0, 3).forEach((e) => console.log(`  voorbeeld: ${e.loc}${e.lastmod ? ` (lastmod: ${e.lastmod})` : ' (geen lastmod)'}`));
    entries.forEach((e) => allEntries.push({ ...e, sourceSitemap: sitemapUrl }));
  }

  console.log(`\nTotaal verzamelde <url>-entries over alle documents-sitemaps: ${allEntries.length}`);

  // --- Zoeken naar de drie bekende artikel-slugs ---
  section('Zoeken naar de drie bekende, nu-zichtbare artikel-slugs');
  for (const slug of KNOWN_ARTICLE_SLUGS) {
    const match = allEntries.find((e) => e.loc.includes(slug));
    if (match) {
      console.log(`GEVONDEN: .../${slug}`);
      console.log(`  volledige URL: ${match.loc}`);
      console.log(`  lastmod: ${match.lastmod ?? '(geen lastmod aanwezig)'}`);
      console.log(`  uit sitemap: ${match.sourceSitemap}`);
    } else {
      console.log(`NIET gevonden in documents-sitemaps: .../${slug}`);
    }
  }

  // --- Meest recente entries (op lastmod) tonen, als die er zijn ---
  const withDates = allEntries.filter((e) => e.lastmod && !Number.isNaN(Date.parse(e.lastmod)));
  section(`Meest recente entries op basis van <lastmod> (${withDates.length} van ${allEntries.length} entries hebben een geldige datum)`);
  if (withDates.length > 0) {
    withDates.sort((a, b) => Date.parse(b.lastmod) - Date.parse(a.lastmod));
    withDates.slice(0, 10).forEach((e, i) => console.log(`[${i + 1}] ${e.lastmod} — ${e.loc}`));
  } else {
    console.log('Geen enkele entry met een geldige <lastmod> gevonden over alle documents-sitemaps.');
  }

  // --- Steekproef: lijken de URL's inhoudelijk op artikelen? ---
  section('Steekproef van 15 willekeurige URL\'s uit de documents-sitemaps (zijn dit artikelen?)');
  const sampleStep = Math.max(1, Math.floor(allEntries.length / 15));
  for (let i = 0; i < allEntries.length; i += sampleStep) {
    console.log(`  ${allEntries[i].loc}`);
  }

  // --- Fallback/cross-check: individuele artikelpagina's direct inspecteren ---
  section('Cross-check: individuele artikelpagina-HTML inspecteren (ongeacht sitemap-resultaat)');
  for (const slug of KNOWN_ARTICLE_SLUGS) {
    const url = `https://www.kvk.nl/${slug}/`;
    console.log(`\n--- ${url} ---`);
    let res;
    try {
      res = await fetchWithTimeout(url, 15000);
    } catch (err) {
      console.log(`FOUT bij ophalen: ${err.message}`);
      continue;
    }
    console.log(`HTTP status: ${res.status}`);
    if (!res.ok) {
      console.log('Niet OK, overslaan.');
      continue;
    }
    const html = await res.text();

    const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '(geen <title>)';
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]
      ?? '(geen meta description)';
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1] ?? '(geen canonical)';

    console.log(`<title>: ${title}`);
    console.log(`meta description: ${metaDesc}`);
    console.log(`canonical: ${canonical}`);

    // JSON-LD blokken
    const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    console.log(`JSON-LD blocks gevonden: ${jsonLdBlocks.length}`);
    jsonLdBlocks.forEach((m, i) => {
      try {
        const parsed = JSON.parse(m[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((item) => {
          const relevant = {
            '@type': item['@type'],
            headline: item.headline,
            description: item.description,
            datePublished: item.datePublished,
            dateModified: item.dateModified,
          };
          console.log(`  JSON-LD[${i + 1}]:`, JSON.stringify(relevant));
        });
      } catch {
        console.log(`  JSON-LD[${i + 1}]: (kon niet geparsed worden, eerste 200 tekens): ${m[1].slice(0, 200)}`);
      }
    });

    // Zichtbare publicatiedatum (heuristisch: <time>-tags of datum-achtige tekst vlak na de titel)
    const timeTags = [...html.matchAll(/<time[^>]*datetime=["']([^"']*)["'][^>]*>([^<]*)<\/time>/gi)];
    console.log(`<time>-tags gevonden: ${timeTags.length}`);
    timeTags.slice(0, 3).forEach((m) => console.log(`  datetime="${m[1]}" tekst="${m[2].trim()}"`));

    // Eerste inhoudelijke alinea (heuristisch): eerste <p> met voldoende tekst
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 60);
    console.log(`Eerste inhoudelijke alinea (${paragraphs[0]?.length ?? 0} tekens): ${(paragraphs[0] ?? '(geen gevonden)').slice(0, 300)}`);
  }

  section('Einde proef');
}

main().catch((err) => {
  console.error('Onverwachte fout in de testproef:', err);
  process.exit(1);
});
