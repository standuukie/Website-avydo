// TIJDELIJK, READ-ONLY diagnosescript — geschreven op verzoek van de
// gebruiker om de ministryBypass-uitsluitingslijst (commit c82c8d3) te
// valideren tegen echte Rijksoverheid-kandidaten, verder dan de eerste 100
// (de normale per-run cap). Dit script schrijft NOOIT naar
// src/content/kenniscentrum, roept writeArticle/publishItem nooit aan met
// een geldige datum, en commit niets. Wordt na gebruik weer verwijderd
// samen met het bijbehorende workflow-bestand.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde functies uit
// fetch-articles.mjs / sources.config.mjs — geen eigen vereenvoudigde
// herimplementatie van de relevantielogica.

import {
  fetchRijksoverheidGeneralSitemapUrls,
  extractMinistryTag,
  extractMetaDescription,
  extractPageTitle,
  scoreCategories,
  processSitemapSource,
} from './fetch-articles.mjs';
import { sources, rijksoverheidAudienceSignals } from './sources.config.mjs';

const rijksoverheidSource = sources.find((s) => s.id === 'rijksoverheid-nieuws');

// Letterlijke kopie van MINISTRY_BYPASS_EXCLUDED_TERMS in fetch-articles.mjs
// — uitsluitend voor RAPPORTAGE (welke term is aanwezig, als die er is).
// De daadwerkelijke relevant/irrelevant-UITKOMST komt altijd uit een echte
// aanroep van processSitemapSource/scoreCategories hieronder, nooit uit
// deze lijst zelf.
const REPORT_ONLY_EXCLUDED_TERMS_MIRROR = [
  'zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget',
];

const FETCH_TIMEOUT_MS = 8000;

async function fetchPageMeta(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return {
      title: extractPageTitle(html),
      description: extractMetaDescription(html),
      ministry: extractMinistryTag(html),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function xmlResponse(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });
}

// Draait de echte, ongewijzigde processSitemapSource (c82c8d3) end-to-end
// voor één specifieke, al bekende echte URL, door alleen de sitemap-
// discovery-laag te mocken (index + 1 sub-sitemap met exact deze URL) —
// zelfde methode als de bestaande testsuite (withMockedFetch). De
// daadwerkelijke artikelpagina wordt WEL echt (live) opgehaald, dus dit is
// de echte, huidige relevantiebeslissing voor dit artikel, niet een
// nabootsing. Ongeldige lastmod -> publishItem schrijft nooit een bestand
// (zelfde veiligheidspatroon als de testsuite).
async function runRealProcessSitemapSourceForUrl(url) {
  const indexUrl = rijksoverheidSource.sitemapIndexUrl;
  // Moet matchen op /\/sitemap\/\d+\.xml$/i (zie
  // fetchRijksoverheidGeneralSitemapUrls) — anders wordt deze sub-sitemap
  // genegeerd en gooit de functie "geen genummerde algemene sub-sitemaps
  // gevonden".
  const subUrl = 'https://www.rijksoverheid.nl/sitemap/999999.xml';
  const indexXml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${subUrl}</loc></sitemap></sitemapindex>`;
  const subXml = `<?xml version="1.0"?><urlset><url><loc>${url}</loc><lastmod>niet-een-geldige-datum</lastmod></url></urlset>`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (reqUrl, opts) => {
    const u = typeof reqUrl === 'string' ? reqUrl : reqUrl.url;
    if (u === indexUrl) return xmlResponse(indexXml);
    if (u === subUrl) return xmlResponse(subXml);
    return realFetch(reqUrl, opts);
  };
  try {
    return await processSitemapSource(rijksoverheidSource, new Set(), { count: 50 });
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function main() {
  console.log('=== Stap 1: echte sitemap-discovery (fetchRijksoverheidGeneralSitemapUrls) ===');
  const candidates = await fetchRijksoverheidGeneralSitemapUrls(
    rijksoverheidSource.sitemapIndexUrl,
    rijksoverheidSource.articleUrlPattern,
  );
  console.log(`TOTAAL_KANDIDATEN: ${candidates.length}`);

  const MAX_SCAN = Number(process.env.DIAGNOSE_MAX_SCAN ?? 2500);
  const MAX_FINANCIEN_HITS = Number(process.env.DIAGNOSE_MAX_HITS ?? 30);

  console.log(`\n=== Stap 2: scan kandidaten op Financien-breadcrumb (max ${MAX_SCAN} kandidaten, max ${MAX_FINANCIEN_HITS} hits) ===`);
  const financienHits = [];
  let scanned = 0;
  for (const c of candidates) {
    if (scanned >= MAX_SCAN || financienHits.length >= MAX_FINANCIEN_HITS) break;
    scanned += 1;
    const meta = await fetchPageMeta(c.loc);
    if (scanned % 200 === 0) console.log(`  ...gescand: ${scanned}/${Math.min(MAX_SCAN, candidates.length)}, hits tot nu toe: ${financienHits.length}`);
    if (!meta || !meta.title || !meta.description) continue;
    if (meta.ministry === rijksoverheidSource.ministryBypass) {
      financienHits.push({ loc: c.loc, lastmod: c.lastmod, index: scanned, ...meta });
      console.log(`  FIN-HIT #${financienHits.length} (kandidaat ${scanned}): "${meta.title}"`);
    }
  }
  console.log(`GESCAND: ${scanned}`);
  console.log(`FINANCIEN_HITS: ${financienHits.length}`);

  console.log('\n=== Stap 3: echte relevantielogica per Financien-artikel (scoreCategories + processSitemapSource) ===');
  const rows = [];
  for (const hit of financienHits) {
    const combinedText = `${hit.title} ${hit.description}`;
    const lower = combinedText.toLowerCase();
    const scores = scoreCategories(combinedText);
    const audienceMatch = rijksoverheidSource.audienceSignals?.some((kw) => lower.includes(kw)) ?? false;
    const excludedTermsPresent = REPORT_ONLY_EXCLUDED_TERMS_MIRROR.filter((t) => lower.includes(t));

    const result = await runRealProcessSitemapSourceForUrl(hit.loc);

    const row = {
      title: hit.title,
      url: hit.loc,
      lastmod: hit.lastmod,
      ministry: hit.ministry,
      categoryScores: scores,
      audienceMatch,
      excludedTermsPresent,
      ministryMatchBeforeFix: true, // per constructie: ministry === ministryBypass
      processSitemapSourceResult: {
        ok: result.ok,
        relevant: result.stages?.relevant ?? null,
        irrelevant: result.stages?.reasons?.irrelevant ?? null,
      },
    };
    rows.push(row);
    console.log(`ROW_JSON: ${JSON.stringify(row)}`);
  }

  console.log('\n=== KLAAR ===');
  console.log(`ALL_ROWS_JSON: ${JSON.stringify(rows)}`);
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
