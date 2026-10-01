#!/usr/bin/env node
/**
 * Fase 1-dry-run voor de KVK-source (sources.config.mjs, id
 * "kvk-kennisartikelen"). Voert dezelfde discovery- en filterpijplijn uit
 * als de productie-run (processKvkSource in fetch-articles.mjs), maar
 * schrijft NOOIT content weg, wijzigt geen bestaande artikelen en commit
 * niets. Bedoeld om de daadwerkelijk geselecteerde kandidaten te kunnen
 * beoordelen vóórdat de bron in sources.config.mjs op enabled:true gezet
 * wordt.
 *
 * Gebruik: node scripts/kenniscentrum/dry-run-kvk.mjs
 */
import {
  fetchKvkDocumentUrls,
  selectKvkCandidates,
  fetchKvkArticleMeta,
  scoreCategories,
  pickCategory,
  isKvkProcedurePage,
  KVK_MAX_PAGE_FETCHES_PER_RUN,
} from './fetch-articles.mjs';
import { sources } from './sources.config.mjs';

const kvkSource = sources.find((s) => s.id === 'kvk-kennisartikelen');

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function main() {
  console.log(`KVK dry-run (Fase 1) — ${new Date().toISOString()}`);
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

  const { deduped, afterUrlFilter, afterRelevanceFilter } = selectKvkCandidates(entries, new Set());
  console.log(`Na dedupliceren op URL: ${deduped.length}`);
  console.log(`Na URL-vormfilter (kvk.nl/<categorie>/<slug>/, precies 2 padsegmenten): ${afterUrlFilter.length}`);
  console.log(`Na relevantie-vóórfilter (URL-slug tegen categoryKeywords): ${afterRelevanceFilter.length}`);

  section('2. Artikelpagina\'s ophalen en beoordelen (titel/samenvatting + eindfilter)');
  // Zelfde veiligheidsgrens als de productie-run (KVK_MAX_PAGE_FETCHES_PER_RUN
  // in fetch-articles.mjs), zodat de dry-run een realistisch beeld geeft
  // zonder bij elke run de hele sitemap (~1.800 URL's) op te vragen.
  const toCheck = afterRelevanceFilter.slice(0, KVK_MAX_PAGE_FETCHES_PER_RUN);
  console.log(`Kandidaten na vóórfilters: ${afterRelevanceFilter.length}`);
  console.log(`Pagina's die voor deze dry-run daadwerkelijk worden opgehaald: ${toCheck.length} (meest recente lastmod eerst)`);

  const selected = [];
  const rejected = [];
  let pagesFetched = 0;

  for (const candidate of toCheck) {
    pagesFetched += 1;
    const meta = await fetchKvkArticleMeta(candidate.loc);
    if (!meta) {
      rejected.push({
        url: candidate.loc,
        category: 'geen-velden',
        reason: 'geen betrouwbare titel/samenvatting op de pagina (geen bruikbare <h1> of geen samenvattingstekst)',
      });
      continue;
    }
    const combinedText = `${meta.title} ${meta.description}`;

    if (isKvkProcedurePage(combinedText)) {
      rejected.push({
        url: candidate.loc,
        title: meta.title,
        category: 'procedure-servicepagina',
        reason: 'formulier-/product-/procedure-/servicepagina, geen kennisartikel (eindfilter)',
      });
      continue;
    }

    const scores = scoreCategories(combinedText);
    if (Object.keys(scores).length === 0) {
      rejected.push({
        url: candidate.loc,
        title: meta.title,
        category: 'geen-trefwoord',
        reason: 'titel/samenvatting bevatten geen fiscaal/accountancy-trefwoord (eindfilter)',
      });
      continue;
    }
    selected.push({
      title: meta.title,
      url: candidate.loc,
      lastmod: candidate.lastmod,
      category: pickCategory(combinedText, kvkSource.defaultCategory),
      reason: `trefwoordtreffer(s) in titel/samenvatting: ${Object.keys(scores).join(', ')}`,
    });
  }

  section('3. Resultaat');
  console.log(`Totaal sitemap-URL's: ${entries.length}`);
  console.log(`Unieke URL's (na dedupliceren): ${deduped.length}`);
  console.log(`Kandidaten na URL-filter: ${afterUrlFilter.length}`);
  console.log(`Kandidaten na relevantie-vóórfilter (URL-slug, incl. procedure-uitsluiting): ${afterRelevanceFilter.length}`);
  console.log(`Daadwerkelijk opgehaalde pagina's: ${pagesFetched}`);
  console.log(`Bruikbare artikelen (titel + samenvatting + eindfilter OK): ${selected.length}`);
  console.log(`Afgewezen: ${rejected.length}`);
  console.log(`  waarvan geen bruikbare velden (<h1>/samenvatting): ${rejected.filter((r) => r.category === 'geen-velden').length}`);
  console.log(`  waarvan formulier-/product-/procedure-/servicepagina: ${rejected.filter((r) => r.category === 'procedure-servicepagina').length}`);
  console.log(`  waarvan geen fiscaal/accountancy-trefwoord: ${rejected.filter((r) => r.category === 'geen-trefwoord').length}`);
  console.log(`Procedure-/servicepagina's onder de GESELECTEERDE kandidaten: 0 (uitgesloten door het eindfilter, zie hierboven)`);

  section(`4. Afwijzingen (${rejected.length}, met reden)`);
  if (rejected.length === 0) {
    console.log('(geen)');
  } else {
    rejected.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title ?? '(geen titel kunnen bepalen)'}`);
      console.log(`    URL: ${r.url}`);
      console.log(`    reden: ${r.reason}`);
    });
  }

  section(`5. Geselecteerde kandidaten (${selected.length})`);
  if (selected.length === 0) {
    console.log('(geen kandidaten voldeden aan alle filters)');
  } else {
    selected.forEach((s, i) => {
      console.log(`[${i + 1}] ${s.title}`);
      console.log(`    URL: ${s.url}`);
      console.log(`    lastmod: ${s.lastmod ?? '(geen lastmod)'}`);
      console.log(`    voorgestelde categorie: ${s.category}`);
      console.log(`    reden: ${s.reason}`);
    });
  }

  if (selected.length < 15) {
    console.log(
      `\nLet op: slechts ${selected.length} kandid${selected.length === 1 ? 'aat' : 'aten'} gevonden binnen de ${toCheck.length} opgehaalde pagina's (gevraagd: minimaal 15 ter beoordeling). ` +
      'Dit kan betekenen dat de filters streng genoeg zijn om weinig door te laten, of dat er op dit moment simpelweg niet meer duidelijk fiscaal/accountancy-relevante KVK-artikelen in de sitemap staan. ' +
      'Verhoog zo nodig KVK_MAX_PAGE_FETCHES_PER_RUN in fetch-articles.mjs om meer kandidaten te beoordelen (let op: dit wijzigt ook de productie-veiligheidsgrens).',
    );
  }

  section('Einde dry-run — geen content gewijzigd of toegevoegd, niets gecommit');
}

main().catch((err) => {
  console.error('Onverwachte fout in de KVK dry-run:', err);
  process.exit(1);
});
