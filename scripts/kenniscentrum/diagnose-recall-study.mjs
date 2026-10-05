// TIJDELIJK, READ-ONLY diagnosescript — recall-onderzoek naar de
// Rijksoverheid-relevancefilter (commit 3859281-equivalent). Scant
// gestratificeerd over de volledige sitemap-kandidatenlijst (niet alleen
// de eerste 100 of één aaneengesloten blok) om een gespreide steekproef
// van echte Ministerie van Financiën-artikelen te vinden, en haalt voor
// elk gevonden artikel de VOLLEDIGE paginatekst op (niet alleen titel +
// meta-description) om te kunnen vergelijken met wat de productiepipeline
// daadwerkelijk ziet. Schrijft NOOIT naar src/content/kenniscentrum,
// publiceert niets, commit niets. Wordt na gebruik weer verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde functies uit
// fetch-articles.mjs/sources.config.mjs — geen eigen herimplementatie
// van de relevantielogica (behalve een letterlijke, als zodanig
// gelabelde spiegeling van de twee kleine, inmiddels onderdeel van de
// productiecode zijnde term-lijsten, uitsluitend voor rapportage).

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

// Letterlijke kopie van MINISTRY_BYPASS_EXCLUDED_TERMS /
// MINISTRY_BYPASS_REQUIRED_TERMS uit fetch-articles.mjs — uitsluitend
// voor rapportage; de daadwerkelijke eindrelevantie komt altijd uit een
// echte aanroep van processSitemapSource.
const EXCLUDED_TERMS_MIRROR = ['zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget'];
const REQUIRED_TERMS_MIRROR = ['belasting', 'fisca'];

function hasExcludedTermMirror(lowerText) {
  return EXCLUDED_TERMS_MIRROR.some((t) => lowerText.includes(t));
}
function hasRequiredTermMirror(lowerText) {
  const withoutOrgName = lowerText.replaceAll('belastingdienst', '');
  return REQUIRED_TERMS_MIRROR.some((t) => withoutOrgName.includes(t));
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractFullText(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const rawBody = bodyMatch ? bodyMatch[1] : html;
  return rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countParagraphs(html) {
  const matches = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  return matches.filter((p) => extractFullText(p).length > 20).length;
}

function extractPublishedDateFromText(fullText) {
  const m = fullText.match(/Nieuwsbericht\s+(\d{2}-\d{2}-\d{4})/);
  return m ? m[1] : null;
}

function xmlResponse(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });
}

// Draait de echte, huidige processSitemapSource end-to-end voor één
// specifieke, al bekende echte URL — zelfde methode als de bestaande
// testsuite en de vorige audits (withMockedFetch): alleen de sitemap-
// discovery-laag wordt gemockt, de artikelpagina zelf wordt WEL echt
// (live) opgehaald.
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
  console.log('=== Stap 1: echte sitemap-discovery ===');
  const candidates = await fetchRijksoverheidGeneralSitemapUrls(
    rijksoverheidSource.sitemapIndexUrl,
    rijksoverheidSource.articleUrlPattern,
  );
  console.log(`TOTAAL_KANDIDATEN: ${candidates.length}`);

  const NUM_SEGMENTS = Number(process.env.DIAGNOSE_NUM_SEGMENTS ?? 8);
  const HITS_PER_SEGMENT = Number(process.env.DIAGNOSE_HITS_PER_SEGMENT ?? 7);
  const MAX_SCAN_PER_SEGMENT = Number(process.env.DIAGNOSE_MAX_SCAN_PER_SEGMENT ?? 350);
  const segmentSize = Math.floor(candidates.length / NUM_SEGMENTS);

  console.log(`\n=== Stap 2: gestratificeerde scan over ${NUM_SEGMENTS} segmenten (elk max ${MAX_SCAN_PER_SEGMENT} kandidaten, doel ${HITS_PER_SEGMENT} hits/segment) ===`);

  const financienHits = [];
  for (let seg = 0; seg < NUM_SEGMENTS; seg++) {
    const segStart = seg * segmentSize;
    const segEnd = Math.min(segStart + segmentSize, candidates.length);
    let scannedInSegment = 0;
    let hitsInSegment = 0;
    console.log(`  -- segment ${seg + 1}/${NUM_SEGMENTS}: kandidaat-index ${segStart}..${segEnd} --`);
    for (let i = segStart; i < segEnd && scannedInSegment < MAX_SCAN_PER_SEGMENT && hitsInSegment < HITS_PER_SEGMENT; i++) {
      const c = candidates[i];
      scannedInSegment += 1;
      const html = await fetchPage(c.loc);
      if (!html) continue;
      const ministry = extractMinistryTag(html);
      if (ministry !== rijksoverheidSource.ministryBypass) continue;
      const title = extractPageTitle(html);
      const description = extractMetaDescription(html);
      if (!title || !description) continue;
      const fullText = extractFullText(html);
      const paragraphCount = countParagraphs(html);
      const publishedDate = extractPublishedDateFromText(fullText) ?? c.lastmod;
      financienHits.push({
        loc: c.loc,
        lastmod: c.lastmod,
        candidateIndex: i,
        segment: seg + 1,
        title,
        description,
        ministry,
        fullText,
        fullTextLength: fullText.length,
        paragraphCount,
        publishedDate,
      });
      hitsInSegment += 1;
      console.log(`  FIN-HIT seg${seg + 1} #${hitsInSegment} (kandidaat-index ${i}): "${title}"`);
    }
    console.log(`  segment ${seg + 1}: gescand ${scannedInSegment}, hits ${hitsInSegment}`);
  }
  console.log(`\nTOTAAL_FINANCIEN_HITS: ${financienHits.length}`);

  console.log('\n=== Stap 3: Laag A (huidige pipeline, titel+meta-description) + Laag B-signalen per artikel ===');
  const rows = [];
  for (const hit of financienHits) {
    const combinedText = `${hit.title} ${hit.description}`;
    const lowerCombined = combinedText.toLowerCase();
    const scores = scoreCategories(combinedText);
    const audienceMatch = rijksoverheidSource.audienceSignals?.some((kw) => lowerCombined.includes(kw)) ?? false;
    const excludedTermsPresent = EXCLUDED_TERMS_MIRROR.filter((t) => lowerCombined.includes(t));
    const hasFiscalStemInMeta = hasRequiredTermMirror(lowerCombined);

    const result = await runRealProcessSitemapSourceForUrl(hit.loc);

    const lowerFull = hit.fullText.toLowerCase();
    const fullTextWithoutOrgName = lowerFull.replaceAll('belastingdienst', '');
    const fiscalTermsInFullText = [
      'belasting', 'belastingen', 'belastingplicht', 'inkomstenbelasting', 'vennootschapsbelasting',
      'btw', 'fiscaal', 'fiscaliteit', 'fiscale', 'belastingplan', 'belastingmaatregel', 'aangifte',
      'fiscale regeling', 'fiscale verplichting', 'rapportage', 'gegevensuitwisseling', 'wetswijziging',
      'wetsvoorstel', 'verplicht', 'belastingdienst',
    ].filter((t) => lowerFull.includes(t));
    const hasFiscalStemInFullText = fullTextWithoutOrgName.includes('belasting') || fullTextWithoutOrgName.includes('fisca');
    const onlyBelastingdienstMention = lowerFull.includes('belastingdienst') && !hasFiscalStemInFullText;

    const row = {
      url: hit.loc,
      title: hit.title,
      publishedDate: hit.publishedDate,
      ministry: hit.ministry,
      metaDescription: hit.description,
      fullTextLength: hit.fullTextLength,
      paragraphCount: hit.paragraphCount,
      candidateIndex: hit.candidateIndex,
      segment: hit.segment,
      pipeline: {
        categoryScores: scores,
        audienceMatch,
        excludedTermsPresent,
        hasFiscalStemInMeta,
        relevant: result.stages?.relevant ?? null,
        irrelevant: result.stages?.reasons?.irrelevant ?? null,
      },
      fullTextAnalysis: {
        fiscalTermsFound: fiscalTermsInFullText,
        hasFiscalStemInFullText,
        onlyBelastingdienstMention,
      },
      fullText: hit.fullText,
    };
    rows.push(row);
    console.log(`ROW_JSON: ${JSON.stringify(row)}`);
  }

  console.log('\n=== KLAAR ===');
  console.log(`FINAL_COUNT: ${rows.length}`);
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
