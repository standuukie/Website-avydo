// TIJDELIJK, READ-ONLY diagnosescript — volledige waarde-audit van de
// Rijksoverheid-bron (commit 8cb6c2b-equivalent). Scant gestratificeerd
// over de volledige, echte sitemap-kandidatenlijst (fetchRijksoverheidGeneralSitemapUrls)
// om een representatieve steekproef van ~150 artikelen te verzamelen,
// verspreid over het begin/midden/einde van de lijst (dus ook oudere
// publicatiedata, niet alleen de meest recente).
//
// Schrijft NOOIT naar src/content/kenniscentrum, publiceert niets, commit
// niets. Wordt na gebruik weer volledig verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde, EXPORTED functies uit
// fetch-articles.mjs/sources.config.mjs voor de daadwerkelijke
// relevantiesignalen (scoreCategories, extractMinistryTag, extractPageTitle,
// extractMetaDescription, fetchRijksoverheidGeneralSitemapUrls,
// rijksoverheidAudienceSignals). De twee kleine, NIET-geëxporteerde
// ministryBypass-term-lijsten en de bijbehorende matchfunctie worden hier
// letterlijk gespiegeld (als zodanig gelabeld) — uitsluitend voor
// rapportage, geen eigen herinterpretatie van de relevantielogica.

import {
  fetchRijksoverheidGeneralSitemapUrls,
  extractMinistryTag,
  extractPageTitle,
  extractMetaDescription,
  scoreCategories,
} from './fetch-articles.mjs';
import { sources, rijksoverheidAudienceSignals } from './sources.config.mjs';

const rijksoverheidSource = sources.find((s) => s.id === 'rijksoverheid-nieuws');

// --- Letterlijke spiegeling van de twee NIET-geëxporteerde term-lijsten en
// hun matchfunctie uit fetch-articles.mjs (regels ~245-335), uitsluitend
// voor rapportage. De daadwerkelijke productiecode wordt nergens aangepast.
const WORD_BOUNDARY_KEYWORDS_MIRROR = new Set(['nba', 'kor', 'maatschap', 'fusie']);
function escapeRegExpMirror(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function keywordMatchesMirror(lowerText, keyword) {
  if (WORD_BOUNDARY_KEYWORDS_MIRROR.has(keyword)) {
    return new RegExp(`\\b${escapeRegExpMirror(keyword)}\\b`).test(lowerText);
  }
  return lowerText.includes(keyword);
}
const MINISTRY_BYPASS_EXCLUDED_TERMS_MIRROR = ['zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget'];
const MINISTRY_BYPASS_REQUIRED_TERMS_MIRROR = ['belasting', 'fisca'];
function hasExcludedTermMirror(lowerText) {
  return MINISTRY_BYPASS_EXCLUDED_TERMS_MIRROR.filter((t) => keywordMatchesMirror(lowerText, t));
}
function hasRequiredTermMirror(lowerText) {
  const withoutOrgName = lowerText.replaceAll('belastingdienst', '');
  return MINISTRY_BYPASS_REQUIRED_TERMS_MIRROR.some((t) => keywordMatchesMirror(withoutOrgName, t));
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
    return await res.text();
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

// Cap op gelogde volledige-tekstlengte, uitsluitend om de GitHub Actions
// joblog behapbaar te houden bij ~150 artikelen — ruim voldoende om de
// inhoud te kunnen beoordelen (zie ook het losse, ongekapte
// `fullTextLength`-veld dat de werkelijke lengte altijd apart meegeeft).
const FULL_TEXT_LOG_CAP = 2500;

async function main() {
  console.log('=== Stap 1: echte sitemap-discovery ===');
  const candidates = await fetchRijksoverheidGeneralSitemapUrls(
    rijksoverheidSource.sitemapIndexUrl,
    rijksoverheidSource.articleUrlPattern,
  );
  console.log(`TOTAAL_KANDIDATEN: ${candidates.length}`);

  const NUM_SEGMENTS = Number(process.env.DIAGNOSE_NUM_SEGMENTS ?? 10);
  const HITS_PER_SEGMENT = Number(process.env.DIAGNOSE_HITS_PER_SEGMENT ?? 15);
  const MAX_SCAN_PER_SEGMENT = Number(process.env.DIAGNOSE_MAX_SCAN_PER_SEGMENT ?? 45);
  const segmentSize = Math.floor(candidates.length / NUM_SEGMENTS);

  console.log(`\n=== Stap 2: gestratificeerde scan over ${NUM_SEGMENTS} segmenten (elk max ${MAX_SCAN_PER_SEGMENT} kandidaten, doel ${HITS_PER_SEGMENT} hits/segment) ===`);

  const hits = [];
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
      const title = extractPageTitle(html);
      const description = extractMetaDescription(html);
      if (!title || !description || description.length < 20) continue;
      const ministry = extractMinistryTag(html);
      const fullText = extractFullText(html);
      const paragraphCount = countParagraphs(html);
      hits.push({
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
      });
      hitsInSegment += 1;
      console.log(`  HIT seg${seg + 1} #${hitsInSegment} (kandidaat-index ${i}, ${c.lastmod ?? 'geen lastmod'}): "${title}" [${ministry ?? 'geen ministerie-tag'}]`);
    }
    console.log(`  segment ${seg + 1}: gescand ${scannedInSegment}, hits ${hitsInSegment}`);
  }
  console.log(`\nTOTAAL_HITS: ${hits.length}`);

  console.log('\n=== Stap 3: technische signalen per artikel (echte scoreCategories/extractMinistryTag + gespiegelde ministryBypass-logica) ===');
  for (const hit of hits) {
    const combinedText = `${hit.title} ${hit.description}`;
    const lowerCombined = combinedText.toLowerCase();

    const scores = scoreCategories(combinedText);
    const audienceMatch = rijksoverheidSource.audienceSignals?.some((kw) => lowerCombined.includes(kw)) ?? false;
    const excludedTermsPresent = hasExcludedTermMirror(lowerCombined);
    const hasFiscalStemInMeta = hasRequiredTermMirror(lowerCombined);
    const ministryMatch = Boolean(
      rijksoverheidSource.ministryBypass &&
      hit.ministry === rijksoverheidSource.ministryBypass &&
      excludedTermsPresent.length === 0 &&
      hasFiscalStemInMeta,
    );

    let relevant = Object.keys(scores).length > 0 || ministryMatch || audienceMatch;
    let corroborationBlocked = false;
    if (relevant && rijksoverheidSource.corroborationRequiredKeywords?.length) {
      const scoresWithoutCorroboration = scoreCategories(combinedText, new Set(rijksoverheidSource.corroborationRequiredKeywords));
      const hasOtherSignal = Object.keys(scoresWithoutCorroboration).length > 0 || ministryMatch || audienceMatch;
      if (!hasOtherSignal) {
        relevant = false;
        corroborationBlocked = true;
      }
    }

    const row = {
      url: hit.loc,
      title: hit.title,
      lastmod: hit.lastmod,
      ministry: hit.ministry,
      metaDescription: hit.description,
      fullTextLength: hit.fullTextLength,
      paragraphCount: hit.paragraphCount,
      candidateIndex: hit.candidateIndex,
      segment: hit.segment,
      technical: {
        categoryScores: scores,
        audienceMatch,
        excludedTermsPresent,
        hasFiscalStemInMeta,
        ministryMatch,
        corroborationBlocked,
        relevant,
      },
      fullText: hit.fullText.slice(0, FULL_TEXT_LOG_CAP),
      fullTextTruncated: hit.fullText.length > FULL_TEXT_LOG_CAP,
    };
    console.log(`ROW_JSON: ${JSON.stringify(row)}`);
  }

  console.log('\n=== KLAAR ===');
  console.log(`FINAL_COUNT: ${hits.length}`);
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
