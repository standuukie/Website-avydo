// TIJDELIJK, READ-ONLY diagnosescript — op verzoek van de gebruiker,
// geschreven om de NIEUWE ministryBypass-logica (commit 3859281:
// MINISTRY_BYPASS_REQUIRED_TERMS) te valideren tegen echte Rijksoverheid-
// kandidaten VERDER in de sitemap dan de normale 100-cap bereikt, en verder
// dan de kandidaten die de vorige audit al scande (die vond 30 hits
// binnen de eerste ~1187 kandidaten). Schrijft NOOIT naar
// src/content/kenniscentrum, roept writeArticle nooit aan met een geldige
// datum, en commit niets. Wordt na gebruik weer verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde functies uit
// fetch-articles.mjs / sources.config.mjs — geen eigen herimplementatie
// van de relevantielogica. De enige "mirror"-logica hieronder is voor
// RAPPORTAGE van de inmiddels VERWIJDERDE oude ministryMatch-gate (die
// logica bestaat niet meer in de codebase om aan te roepen), duidelijk
// als zodanig gelabeld; de daadwerkelijke NIEUWE uitkomst komt altijd uit
// een echte aanroep van processSitemapSource.

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
// — uitsluitend voor rapportage van de (nu verwijderde) OUDE gate-logica.
const EXCLUDED_TERMS_MIRROR = ['zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget'];
// Letterlijke kopie van MINISTRY_BYPASS_REQUIRED_TERMS + de
// 'belastingdienst'-correctie uit fetch-articles.mjs (commit 3859281) —
// uitsluitend voor rapportage; de echte NIEUWE uitkomst komt altijd uit
// processSitemapSource zelf (zie runRealProcessSitemapSourceForUrl).
const REQUIRED_TERMS_MIRROR = ['belasting', 'fisca'];

function hasExcludedTermMirror(lowerText) {
  return EXCLUDED_TERMS_MIRROR.some((t) => lowerText.includes(t));
}
function hasRequiredTermMirror(lowerText) {
  const withoutOrgName = lowerText.replaceAll('belastingdienst', '');
  return REQUIRED_TERMS_MIRROR.some((t) => withoutOrgName.includes(t));
}

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

// Draait de echte, huidige (commit 3859281) processSitemapSource end-to-end
// voor één specifieke, al bekende echte URL — zelfde methode als de
// bestaande testsuite (withMockedFetch): alleen de sitemap-discovery-laag
// wordt gemockt, de artikelpagina zelf wordt WEL echt (live) opgehaald.
async function runRealProcessSitemapSourceForUrl(url) {
  const indexUrl = rijksoverheidSource.sitemapIndexUrl;
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

  // Start NA de vorige audit (die 30 hits vond binnen candidate-index 1-1187)
  // en na de normale 100-cap, zodat dit daadwerkelijk NIEUWE, nog niet
  // eerder geauditeerde kandidaten zijn.
  const START_INDEX = Number(process.env.DIAGNOSE_START_INDEX ?? 1187);
  const MAX_SCAN = Number(process.env.DIAGNOSE_MAX_SCAN ?? 3500);
  const MAX_FINANCIEN_HITS = Number(process.env.DIAGNOSE_MAX_HITS ?? 30);

  console.log(`\n=== Stap 2: scan kandidaten vanaf index ${START_INDEX} op Financien-breadcrumb (max ${MAX_SCAN} extra kandidaten, max ${MAX_FINANCIEN_HITS} hits) ===`);
  const financienHits = [];
  let scanned = 0;
  for (let i = START_INDEX; i < candidates.length && scanned < MAX_SCAN && financienHits.length < MAX_FINANCIEN_HITS; i++) {
    const c = candidates[i];
    scanned += 1;
    const meta = await fetchPageMeta(c.loc);
    if (scanned % 200 === 0) console.log(`  ...gescand: ${scanned} (kandidaat-index ${i}), hits tot nu toe: ${financienHits.length}`);
    if (!meta || !meta.title || !meta.description) continue;
    if (meta.ministry === rijksoverheidSource.ministryBypass) {
      financienHits.push({ loc: c.loc, lastmod: c.lastmod, index: i, ...meta });
      console.log(`  FIN-HIT #${financienHits.length} (kandidaat-index ${i}): "${meta.title}"`);
    }
  }
  console.log(`GESCAND_VANAF_INDEX: ${START_INDEX}`);
  console.log(`GESCAND: ${scanned}`);
  console.log(`LAATSTE_INDEX: ${START_INDEX + scanned - 1}`);
  console.log(`FINANCIEN_HITS: ${financienHits.length}`);

  console.log('\n=== Stap 3: echte relevantielogica per Financien-artikel ===');
  const rows = [];
  for (const hit of financienHits) {
    const combinedText = `${hit.title} ${hit.description}`;
    const lower = combinedText.toLowerCase();
    const scores = scoreCategories(combinedText);
    const audienceMatch = rijksoverheidSource.audienceSignals?.some((kw) => lower.includes(kw)) ?? false;
    const excludedTermsPresent = EXCLUDED_TERMS_MIRROR.filter((t) => lower.includes(t));
    const hasRequiredTerm = hasRequiredTermMirror(lower);
    const oldMinistryMatchMirror = !hasExcludedTermMirror(lower); // ministry===Financien al gegarandeerd

    const result = await runRealProcessSitemapSourceForUrl(hit.loc);

    const row = {
      title: hit.title,
      url: hit.loc,
      lastmod: hit.lastmod,
      candidateIndex: hit.index,
      ministry: hit.ministry,
      categoryScores: scores,
      audienceMatch,
      excludedTermsPresent,
      hasFiscalStem: hasRequiredTerm,
      oldMinistryBypassMirror: oldMinistryMatchMirror,
      newProcessSitemapSourceResult: {
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
