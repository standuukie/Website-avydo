#!/usr/bin/env node
/**
 * Fase 1-dry-run voor de KVK-source (sources.config.mjs, id
 * "kvk-kennisartikelen"). Voert dezelfde discovery-, redactionele filter-,
 * ranking- en overlapcontrolepijplijn uit als de productie-run
 * (processKvkSource in fetch-articles.mjs), maar schrijft NOOIT content weg,
 * wijzigt geen bestaande artikelen en commit niets. Bedoeld om de
 * daadwerkelijk geselecteerde kandidaten te kunnen beoordelen vóórdat de
 * bron in sources.config.mjs op enabled:true gezet wordt.
 *
 * Gebruik: node scripts/kenniscentrum/dry-run-kvk.mjs
 */
import {
  fetchKvkDocumentUrls,
  selectKvkCandidates,
  fetchKvkArticleMeta,
  pickCategory,
  isKvkProcedurePage,
  isKvkServiceOrProductPage,
  classifyKvkRelevance,
  downgradeIfTitleHasNoSignal,
  loadExistingArticlesMeta,
  findOverlappingArticle,
  kvkFirstPathSegment,
  KVK_MAX_PAGE_FETCHES_PER_RUN,
} from './fetch-articles.mjs';

// Secties waarvan we expliciet willen zien hoeveel kandidaten erin
// voorkomen en hoeveel daarvan alsnog geselecteerd worden (zie Resultaat).
const KVK_WATCHED_PATH_SEGMENTS = ['deponeren', 'producten-bestellen', 'pers'];
import { sources } from './sources.config.mjs';

const kvkSource = sources.find((s) => s.id === 'kvk-kennisartikelen');

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function main() {
  console.log(`KVK dry-run (Fase 1, redactionele laag) — ${new Date().toISOString()}`);
  console.log('Dit script wijzigt niets, voegt geen content toe en commit niets.\n');

  if (!kvkSource) {
    console.error('Geen bron met id "kvk-kennisartikelen" gevonden in sources.config.mjs.');
    process.exit(1);
  }

  section('1. Discovery — sitemap_index.xml -> documents-*.xml');
  let entries;
  try {
    entries = await fetchKvkDocumentUrls(kvkSource.sitemapIndexUrl);
  } catch (err) {
    console.error(`FOUT: kon KVK-sitemaps niet ophalen (${err.message}).`);
    process.exit(1);
  }
  console.log(`Totaal sitemap-URL's (vóór dedupliceren, over alle documents-*.xml): ${entries.length}`);

  const { deduped, afterUrlFilter, afterRelevanceFilter, ranked } = selectKvkCandidates(entries, new Set());
  console.log(`Unieke URL's (na dedupliceren): ${deduped.length}`);
  console.log(`Na URL-/hub-vormfilter (2 padsegmenten, geen /onderwerp/...): ${afterUrlFilter.length}`);
  console.log(`Na redactionele/relevantiefilter (URL-slug, incl. procedure- en algemeen-onderwerp-uitsluiting): ${afterRelevanceFilter.length}`);
  console.log(`Kandidaten vóór ranking: ${afterRelevanceFilter.length}`);
  console.log(`Na rangschikken op tier (hoog voor twijfel) + lastmod: ${ranked.length} kandidaten`);

  section('2. Artikelpagina\'s ophalen en redactioneel beoordelen (incl. overlapcontrole)');
  // Zelfde veiligheidsgrens als de productie-run. De kandidaten zijn al
  // gerangschikt (hoogste tier + meest recente lastmod eerst), dus de
  // 50 opgehaalde pagina's zijn nu de meest kansrijke, niet simpelweg de
  // 50 meest recente.
  const toCheck = ranked.slice(0, KVK_MAX_PAGE_FETCHES_PER_RUN);
  console.log(`Pagina's die voor deze dry-run daadwerkelijk worden opgehaald: ${toCheck.length} (hoogste tier + meest recente lastmod eerst)`);

  const existingArticlesMeta = loadExistingArticlesMeta();
  console.log(`Bestaande Kenniscentrum-artikelen gebruikt voor overlapcontrole: ${existingArticlesMeta.length}`);

  const selected = [];
  const rejected = [];
  const overlaps = [];
  let pagesFetched = 0;

  for (const candidate of toCheck) {
    pagesFetched += 1;
    const meta = await fetchKvkArticleMeta(candidate.loc);
    if (!meta) {
      rejected.push({
        url: candidate.loc,
        bucket: 'geen-velden',
        reason: 'geen betrouwbare titel/samenvatting op de pagina (geen bruikbare <h1> of geen samenvattingstekst)',
      });
      continue;
    }
    const combinedText = `${meta.title} ${meta.description}`;

    if (isKvkProcedurePage(combinedText)) {
      rejected.push({
        url: candidate.loc,
        title: meta.title,
        bucket: 'procedure-servicepagina',
        reason: 'formulier-/product-/procedure-/servicepagina, geen kennisartikel',
      });
      continue;
    }
    if (isKvkServiceOrProductPage(candidate.loc, combinedText)) {
      rejected.push({
        url: candidate.loc,
        title: meta.title,
        bucket: 'kvk-dienst-productpagina',
        reason: 'KVK-dienst-/productpagina (deponeren-procedure, productbestelling of persmateriaal), geen accountancy-inhoud',
      });
      continue;
    }

    let classification = classifyKvkRelevance(combinedText);
    classification = downgradeIfTitleHasNoSignal(meta.title, classification);
    if (classification.tier === 'afgewezen') {
      rejected.push({
        url: candidate.loc,
        title: meta.title,
        bucket: 'redactioneel-afgewezen',
        reason: classification.reason,
      });
      continue;
    }

    const category = pickCategory(combinedText, kvkSource.defaultCategory);
    const overlap = findOverlappingArticle(meta.title, category, existingArticlesMeta);
    if (overlap) {
      overlaps.push({
        url: candidate.loc,
        title: meta.title,
        existingTitle: overlap.title,
        existingFile: overlap.file,
        jaccard: overlap.jaccard,
      });
      continue;
    }

    selected.push({
      title: meta.title,
      url: candidate.loc,
      lastmod: candidate.lastmod,
      category,
      tier: classification.tier,
      reason: classification.reason,
    });
  }

  const hoog = selected.filter((s) => s.tier === 'hoog');
  const twijfel = selected.filter((s) => s.tier === 'twijfel');

  // Per-sectie telling: hoeveel van de opgehaalde kandidaten kwamen uit
  // /deponeren/, /producten-bestellen/, /pers/, en hoeveel daarvan zijn
  // uiteindelijk geselecteerd (verwacht: 0 voor producten-bestellen/pers,
  // een beperkt aantal voor deponeren — alleen de inhoudelijke artikelen).
  const selectedUrls = new Set(selected.map((s) => s.url));
  const sectionCounts = Object.fromEntries(KVK_WATCHED_PATH_SEGMENTS.map((seg) => [seg, { fetched: 0, selected: 0 }]));
  for (const candidate of toCheck) {
    const segment = kvkFirstPathSegment(candidate.loc);
    if (!(segment in sectionCounts)) continue;
    sectionCounts[segment].fetched += 1;
    if (selectedUrls.has(candidate.loc)) sectionCounts[segment].selected += 1;
  }

  section('3. Resultaat');
  console.log(`Totaal sitemap-URL's: ${entries.length}`);
  console.log(`Unieke URL's: ${deduped.length}`);
  console.log(`Na URL-filter: ${afterUrlFilter.length}`);
  console.log(`Na redactionele/relevance-filter: ${afterRelevanceFilter.length}`);
  console.log(`Kandidaten vóór ranking: ${afterRelevanceFilter.length}`);
  console.log(`Daadwerkelijk opgehaalde pagina's: ${pagesFetched}`);
  console.log(`Bruikbare kandidaten (geselecteerd): ${selected.length}`);
  console.log(`  waarvan tier 'hoog': ${hoog.length}`);
  console.log(`  waarvan tier 'twijfel': ${twijfel.length}`);
  console.log(`Afgewezen kandidaten: ${rejected.length}`);
  console.log(`  waarvan geen bruikbare velden: ${rejected.filter((r) => r.bucket === 'geen-velden').length}`);
  console.log(`  waarvan procedure-/servicepagina: ${rejected.filter((r) => r.bucket === 'procedure-servicepagina').length}`);
  console.log(`  waarvan redactioneel afgewezen (algemeen onderwerp/definitie/trendrapport/rechtsvorm-basic): ${rejected.filter((r) => r.bucket === 'redactioneel-afgewezen').length}`);
  console.log(`  waarvan KVK-dienst-/productpagina (deponeren/producten-bestellen/pers): ${rejected.filter((r) => r.bucket === 'kvk-dienst-productpagina').length}`);
  console.log(`Overlapgevallen (inhoudelijk al gedekt door bestaand Avydo-artikel): ${overlaps.length}`);

  section('3b. Per sectie: /deponeren/, /producten-bestellen/, /pers/');
  for (const segment of KVK_WATCHED_PATH_SEGMENTS) {
    const { fetched, selected: selectedCount } = sectionCounts[segment];
    console.log(`/${segment}/: ${fetched} opgehaald, ${selectedCount} geselecteerd`);
  }

  section(`4. Hoog relevante kandidaten (${hoog.length})`);
  if (hoog.length === 0) {
    console.log('(geen)');
  } else {
    hoog.forEach((s, i) => {
      console.log(`[${i + 1}] ${s.title}`);
      console.log(`    URL: ${s.url}`);
      console.log(`    lastmod: ${s.lastmod ?? '(geen lastmod)'}`);
      console.log(`    categorie: ${s.category}`);
      console.log(`    reden: ${s.reason}`);
    });
  }

  section(`5. Twijfelgevallen (${twijfel.length})`);
  if (twijfel.length === 0) {
    console.log('(geen)');
  } else {
    twijfel.forEach((s, i) => {
      console.log(`[${i + 1}] ${s.title}`);
      console.log(`    URL: ${s.url}`);
      console.log(`    lastmod: ${s.lastmod ?? '(geen lastmod)'}`);
      console.log(`    categorie: ${s.category}`);
      console.log(`    reden: ${s.reason}`);
    });
  }

  section(`6. Overlapgevallen (${overlaps.length})`);
  if (overlaps.length === 0) {
    console.log('(geen)');
  } else {
    overlaps.forEach((o, i) => {
      console.log(`[${i + 1}] KVK-kandidaat: ${o.title}`);
      console.log(`    URL: ${o.url}`);
      console.log(`    overlapt met bestaand artikel: "${o.existingTitle}" (${o.existingFile}, overlapscore ${o.jaccard.toFixed(2)})`);
    });
  }

  section(`7. Afgewezen kandidaten (${rejected.length}, met reden)`);
  if (rejected.length === 0) {
    console.log('(geen)');
  } else {
    rejected.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title ?? '(geen titel kunnen bepalen)'}`);
      console.log(`    URL: ${r.url}`);
      console.log(`    reden: ${r.reason}`);
    });
  }

  if (selected.length < 15) {
    console.log(
      `\nLet op: slechts ${selected.length} kandid${selected.length === 1 ? 'aat' : 'aten'} geselecteerd binnen de ${toCheck.length} opgehaalde pagina's (gevraagd: minimaal 15 ter beoordeling). ` +
      'Dit kan betekenen dat de redactionele filter streng genoeg is om weinig door te laten, of dat er op dit moment simpelweg niet meer duidelijk fiscaal/accountancy-relevante KVK-artikelen in de sitemap staan. ' +
      'Verhoog zo nodig KVK_MAX_PAGE_FETCHES_PER_RUN in fetch-articles.mjs om meer kandidaten te beoordelen (let op: dit wijzigt ook de productie-veiligheidsgrens).',
    );
  }

  section('Einde dry-run — geen content gewijzigd of toegevoegd, niets gecommit');
}

main().catch((err) => {
  console.error('Onverwachte fout in de KVK dry-run:', err);
  process.exit(1);
});
