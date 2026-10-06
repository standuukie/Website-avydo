#!/usr/bin/env node
/**
 * TIJDELIJK, READ-ONLY onderzoeksscript. Geen onderdeel van de productie-
 * pijplijn, importeert niets uit fetch-articles.mjs/sources.config.mjs en
 * schrijft niets naar src/content/. Wordt na gebruik volledig verwijderd.
 *
 * Doel: de daadwerkelijke rijksoverheid.nl topic-API
 * (POST /api/search) bevragen voor een reeks kandidaat-onderwerpen,
 * zonder te gokken op topicnamen — exacte namen worden ontdekt via (a) de
 * API's eigen topic-facet en (b) de echte thema-overzichtspagina.
 */

const FETCH_TIMEOUT_MS = 20000;
const UA = 'AvydoKenniscentrumOnderzoek/1.0 (+https://www.avydo.nl) Mozilla/5.0';

function log(...args) {
  console.log(...args);
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

const RESULT_FIELDS = {
  page_title: { raw: {} },
  url: { raw: {} },
  sort_date: { raw: {} },
  meta_description: { raw: {}, snippet: { size: 200, fallback: true } },
  information_type: { raw: {} },
};

function buildSearchBody({ topic, current, resultsPerPage = 10, includeTopicFacet = false, topicFacetSize = 300 }) {
  const filters = [];
  if (topic) filters.push({ field: 'topic', values: [topic], type: 'all' });
  filters.push({ field: 'content_type', values: ['pro:newsDocument'], type: 'all' });
  const facets = {
    ministry: { type: 'value', size: 250 },
    information_type: { type: 'value', size: 250 },
  };
  const disjunctiveFacets = ['ministry', 'information_type'];
  if (includeTopicFacet) {
    facets.topic = { type: 'value', size: topicFacetSize };
    disjunctiveFacets.push('topic');
  }
  return {
    requestState: { searchTerm: '', filters, resultsPerPage, current, sortDirection: '', sortField: '' },
    queryConfig: { result_fields: RESULT_FIELDS, facets, disjunctiveFacets, search_fields: { page_title: {} } },
  };
}

async function callSearchApi(body, hashVariant) {
  const url = hashVariant === 'none'
    ? 'https://www.rijksoverheid.nl/api/search'
    : `https://www.rijksoverheid.nl/api/search?hash=${hashVariant}`;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, status, contentType, error: `kon body niet lezen: ${err.message}` };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // niet-JSON response, bv. HTML-foutpagina
  }
  return { ok: res.ok, status, contentType, text, parsed };
}

async function testHashRequirement() {
  log('\n=== STAP 0: vereist de API een geldige/overeenkomende hash? ===');
  const body = buildSearchBody({ topic: 'Belasting betalen', current: 1 });
  for (const variant of ['none', 'test123', 'deadbeef']) {
    const r = await callSearchApi(body, variant);
    const count = r.parsed?.rawResponse?.rawResults?.length ?? 'n/a';
    log(`HASH_TEST variant=${variant} status=${r.status ?? 'ERR'} content-type=${r.contentType ?? ''} resultCount=${count} error=${r.error ?? ''}`);
  }
}

async function discoverTopicFacet() {
  log('\n=== STAP 2a: topic-facet opvragen (geen topicfilter, alleen content_type) ===');
  const body = buildSearchBody({ topic: null, current: 1, resultsPerPage: 1, includeTopicFacet: true, topicFacetSize: 300 });
  const r = await callSearchApi(body, 'none');
  log(`TOPIC_FACET_HTTP_STATUS: ${r.status ?? 'ERR'} error=${r.error ?? ''}`);
  const topicFacetData = r.parsed?.facets?.topic?.[0]?.data ?? null;
  if (!topicFacetData) {
    log('TOPIC_FACET_RESULT: geen topic-facet in response (veld afwezig of leeg) — body-sample volgt');
    log('TOPIC_FACET_BODY_SAMPLE:', (r.text || '').slice(0, 1500));
    return null;
  }
  log(`TOPIC_FACET_COUNT: ${topicFacetData.length} topicwaarden gevonden`);
  console.log('TOPIC_FACET_JSON: ' + JSON.stringify(topicFacetData));
  return topicFacetData;
}

async function fetchHtml(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, status: res.status, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function crawlLinksOnPage(url, hrefPrefix) {
  const r = await fetchHtml(url);
  log(`CRAWL_PAGE_STATUS url=${url} status=${r.status ?? 'ERR'}`);
  if (!r.ok) return { ok: false, status: r.status, list: [] };
  const escapedPrefix = hrefPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`<a[^>]+href="(${escapedPrefix}[a-z0-9-]+)"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
  const found = new Map();
  let m;
  while ((m = linkRe.exec(r.text))) {
    const href = m[1];
    const textRaw = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textRaw && !found.has(href)) found.set(href, textRaw);
  }
  return { ok: true, list: Array.from(found.entries()).map(([href, text]) => ({ href, text })) };
}

const THEMA_OVERVIEW_PAGES = [
  { themaKey: 'belastingen-uitkeringen-en-toeslagen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen' },
  { themaKey: 'werk', url: 'https://www.rijksoverheid.nl/themas/werk' },
  { themaKey: 'economie', url: 'https://www.rijksoverheid.nl/themas/economie' },
  { themaKey: 'migratie-en-reizen', url: 'https://www.rijksoverheid.nl/themas/migratie-en-reizen' },
];

async function crawlAllThemaOverviews() {
  log('\n=== STAP 2b/9: thema-overzichtspagina\'s crawlen (geen gok — live links van de echte pagina) ===');
  const byThema = {};
  for (const t of THEMA_OVERVIEW_PAGES) {
    const r = await crawlLinksOnPage(t.url, `/themas/${t.themaKey}/`);
    byThema[t.themaKey] = r.list;
    log(`THEMA_OVERVIEW_SUBPAGES_COUNT thema=${t.themaKey}: ${r.list.length}`);
  }
  console.log('THEMA_OVERVIEW_ALL_JSON: ' + JSON.stringify(byThema));

  const azResult = await crawlLinksOnPage('https://www.rijksoverheid.nl/onderwerpen', '/onderwerpen/');
  log(`ONDERWERPEN_AZ_COUNT: ${azResult.list.length}`);
  console.log('ONDERWERPEN_AZ_JSON: ' + JSON.stringify(azResult.list));

  return { byThema, onderwerpenAZ: azResult.list };
}

async function findTopicLinkOnPage(pageUrl) {
  const r = await fetchHtml(pageUrl);
  if (!r.ok) return { pageOk: false, status: r.status, error: r.error };
  const re = /filters\[0\]\[field\]=topic&(?:amp;)?filters\[0\]\[values\]\[0\]=([^&"'<>]+)/i;
  const m = re.exec(r.text);
  if (!m) return { pageOk: true, topicValueFound: null };
  const decoded = decodeURIComponent(m[1].replace(/\+/g, ' '));
  return { pageOk: true, topicValueFound: decoded };
}

const CANDIDATE_PAGES = [
  { key: 'belasting-betalen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belasting-betalen' },
  { key: 'inkomstenbelasting', url: 'https://www.rijksoverheid.nl/themas/werk/inkomstenbelasting' },
  { key: 'belastingverdragen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belastingverdragen' },
  { key: 'bbz', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/bbz' },
  { key: 'europese-subsidies', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/europese-subsidies' },
  { key: 'prinsjesdag-belastingplan', url: 'https://www.rijksoverheid.nl/onderwerpen/prinsjesdag' },
  { key: 'belastingplan', url: 'https://www.rijksoverheid.nl/onderwerpen/belastingplan' },
  { key: 'belastingontwijking', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/aanpak-belastingontwijking-en-belastingontduiking' },
  { key: 'zzp', url: 'https://www.rijksoverheid.nl/themas/werk/zelfstandigen-zonder-personeel-zzp' },
  { key: 'ziekteverzuim', url: 'https://www.rijksoverheid.nl/themas/werk/ziekteverzuim-en-herstel-naar-werk' },
  { key: 'arbeidsbeperking', url: 'https://www.rijksoverheid.nl/themas/werk/werken-met-arbeidsbeperking' },
  { key: 'buitenlandse-werknemers', url: 'https://www.rijksoverheid.nl/themas/migratie-en-reizen/buitenlandse-werknemers' },
  { key: 'ondernemen-innovatie', url: 'https://www.rijksoverheid.nl/themas/economie/ondernemen-en-innovatie' },
];

function findFallbackUrl(candidateLabel, crawlData) {
  const needle = candidateLabel.toLowerCase();
  const pools = [
    ...Object.values(crawlData.byThema).flat(),
    ...crawlData.onderwerpenAZ,
  ];
  const match = pools.find((p) => p.text.toLowerCase().includes(needle) || needle.includes(p.text.toLowerCase()));
  return match ? `https://www.rijksoverheid.nl${match.href}` : null;
}

async function resolveCandidateTopicNames(crawlData) {
  log('\n=== STAP 2: exacte topicnaam per kandidaat-onderwerp bepalen (via live thema-pagina, geen gok) ===');
  const resolved = [];
  for (const cand of CANDIDATE_PAGES) {
    let r = await findTopicLinkOnPage(cand.url);
    let usedUrl = cand.url;
    let fallbackUsed = false;
    if (!r.pageOk || !r.topicValueFound) {
      const fallbackLabel = cand.key.replace(/-/g, ' ');
      const fallbackUrl = findFallbackUrl(fallbackLabel, crawlData);
      if (fallbackUrl && fallbackUrl !== cand.url) {
        const r2 = await findTopicLinkOnPage(fallbackUrl);
        log(`CANDIDATE_FALLBACK_ATTEMPT key=${cand.key} fallbackUrl=${fallbackUrl} pageOk=${r2.pageOk} topicValueFound=${r2.topicValueFound ?? 'GEEN'}`);
        if (r2.pageOk && r2.topicValueFound) {
          r = r2;
          usedUrl = fallbackUrl;
          fallbackUsed = true;
        }
      }
    }
    log(`CANDIDATE_PAGE key=${cand.key} url=${usedUrl} fallbackUsed=${fallbackUsed} pageOk=${r.pageOk} status=${r.status ?? ''} topicValueFound=${r.topicValueFound ?? 'GEEN'} error=${r.error ?? ''}`);
    resolved.push({ ...cand, resolvedUrl: usedUrl, fallbackUsed, ...r });
  }
  console.log('CANDIDATE_RESOLUTION_JSON: ' + JSON.stringify(resolved));
  return resolved;
}

async function resolveAllBelastingenSubtopics(crawlData) {
  log('\n=== STAP 9: ALLE subonderwerpen onder "Belastingen, uitkeringen en toeslagen" resolven (volledige enumeratie, geen selectie) ===');
  const subpages = crawlData.byThema['belastingen-uitkeringen-en-toeslagen'] || [];
  const resolved = [];
  for (const sp of subpages) {
    const fullUrl = `https://www.rijksoverheid.nl${sp.href}`;
    const r = await findTopicLinkOnPage(fullUrl);
    log(`BELASTINGEN_SUBTOPIC href=${sp.href} text="${sp.text}" pageOk=${r.pageOk} topicValueFound=${r.topicValueFound ?? 'GEEN'}`);
    resolved.push({ href: sp.href, text: sp.text, url: fullUrl, ...r });
  }
  console.log('BELASTINGEN_ALL_SUBTOPICS_JSON: ' + JSON.stringify(resolved));
  return resolved;
}

function extractArticles(parsed) {
  const raw = parsed?.rawResponse?.rawResults ?? [];
  return raw.map((r) => ({
    id: r.id?.raw,
    title: r.page_title?.raw,
    url: r.url?.raw,
    date: r.sort_date?.raw,
    description: r.meta_description?.raw || r.meta_description?.snippet,
    type: r.information_type?.raw,
  }));
}

async function testTopicPages(topicName, label, maxPages = 3) {
  log(`\n--- API-test voor topic="${topicName}" (label=${label}) ---`);
  const pages = [];
  let infoTypeFacetTotal = null;
  for (let current = 1; current <= maxPages; current++) {
    const body = buildSearchBody({ topic: topicName, current, resultsPerPage: 10 });
    const r = await callSearchApi(body, 'none');
    const articles = r.parsed ? extractArticles(r.parsed) : [];
    if (current === 1) {
      const facetData = r.parsed?.facets?.information_type?.[0]?.data ?? [];
      const newsEntry = facetData.find((f) => /nieuwsbericht/i.test(f.value || ''));
      infoTypeFacetTotal = newsEntry ? newsEntry.count : null;
    }
    log(`PAGE_RESULT topic="${topicName}" page=${current} status=${r.status ?? 'ERR'} count=${articles.length} error=${r.error ?? ''}`);
    pages.push({ current, status: r.status, count: articles.length, articles });
    if (articles.length === 0) break;
  }
  console.log(`TOPIC_PAGES_JSON label=${label}: ` + JSON.stringify({ topicName, infoTypeFacetTotal, pages }));
  return { topicName, infoTypeFacetTotal, pages };
}

async function crawlGeneralSitemapUrls() {
  log('\n=== STAP 8: algemene sitemap.xml ophalen (voor vergelijking) ===');
  const indexUrl = 'https://www.rijksoverheid.nl/sitemap.xml';
  const r = await fetchHtml(indexUrl);
  log(`SITEMAP_INDEX_STATUS: ${r.status ?? 'ERR'}`);
  if (!r.ok) return [];
  const subSitemaps = Array.from(r.text.matchAll(/<loc>([^<]+)<\/loc>/g))
    .map((m) => m[1])
    .filter((u) => /\/sitemap\/\d+\.xml$/i.test(u));
  log(`SITEMAP_SUBSITEMAP_COUNT: ${subSitemaps.length}`);
  const all = [];
  for (const sm of subSitemaps) {
    const rr = await fetchHtml(sm);
    if (!rr.ok) {
      log(`SITEMAP_SUB_FAILED: ${sm} status=${rr.status ?? rr.error}`);
      continue;
    }
    const urlBlocks = Array.from(rr.text.matchAll(/<url>([\s\S]*?)<\/url>/g)).map((m) => m[1]);
    for (const block of urlBlocks) {
      const locM = /<loc>([^<]+)<\/loc>/.exec(block);
      const lastmodM = /<lastmod>([^<]+)<\/lastmod>/.exec(block);
      if (locM && /\/actueel\/nieuws\//.test(locM[1])) {
        all.push({ loc: locM[1], lastmod: lastmodM ? lastmodM[1] : null });
      }
    }
  }
  log(`SITEMAP_NEWS_URL_TOTAL: ${all.length}`);
  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    if (!seen.has(item.loc)) {
      seen.add(item.loc);
      deduped.push(item);
    }
  }
  deduped.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || ''));
  const top100 = deduped.slice(0, 100);
  console.log('SITEMAP_TOP100_JSON: ' + JSON.stringify(top100));

  const keywords = ['wbso', 'tek', 'zelfstandigenwet', 'crypto', 'belastingverdrag', 'box-3', 'box3', 'arbeidsbeperking', 're-integratie', 'reintegratie', 'zzp', 'subsidie'];
  const keywordMatches = {};
  for (const kw of keywords) {
    const matches = deduped.filter((item) => item.loc.toLowerCase().includes(kw));
    keywordMatches[kw] = matches.map((m) => m.loc);
    log(`SITEMAP_KEYWORD_MATCH keyword="${kw}" count=${matches.length}`);
  }
  console.log('SITEMAP_KEYWORD_MATCHES_JSON: ' + JSON.stringify(keywordMatches));
  return deduped;
}

async function main() {
  await testHashRequirement();
  const topicFacet = await discoverTopicFacet();
  const crawlData = await crawlAllThemaOverviews();
  const candidateResolution = await resolveCandidateTopicNames(crawlData);
  const belastingenSubtopics = await resolveAllBelastingenSubtopics(crawlData);

  log('\n=== STAP 3/4/5/6: API per opgelost topic testen (pagina 1-3, max 20 artikelen) ===');
  const topicsToTest = [];
  const seenTopicNames = new Set();
  for (const cand of candidateResolution) {
    if (cand.topicValueFound && !seenTopicNames.has(cand.topicValueFound)) {
      topicsToTest.push({ label: cand.key, topicName: cand.topicValueFound });
      seenTopicNames.add(cand.topicValueFound);
    }
  }
  for (const sub of belastingenSubtopics) {
    if (sub.topicValueFound && !seenTopicNames.has(sub.topicValueFound)) {
      topicsToTest.push({ label: `belastingen-subtopic:${sub.href}`, topicName: sub.topicValueFound });
      seenTopicNames.add(sub.topicValueFound);
    }
  }
  // Ook de twee al eerder bevestigde topics expliciet opnieuw testen voor consistentie.
  if (!seenTopicNames.has('Belasting betalen')) topicsToTest.push({ label: 'belasting-betalen-fallback', topicName: 'Belasting betalen' });
  if (!seenTopicNames.has('Inkomstenbelasting')) topicsToTest.push({ label: 'inkomstenbelasting-fallback', topicName: 'Inkomstenbelasting' });

  const allResults = [];
  for (const t of topicsToTest) {
    const res = await testTopicPages(t.topicName, t.label, 3);
    allResults.push({ label: t.label, ...res });
  }
  console.log('ALL_TOPIC_RESULTS_SUMMARY_JSON: ' + JSON.stringify(allResults.map((r) => ({
    label: r.label,
    topicName: r.topicName,
    infoTypeFacetTotal: r.infoTypeFacetTotal,
    pagesWithResults: r.pages.filter((p) => p.count > 0).length,
    totalArticlesFetched: r.pages.reduce((s, p) => s + p.count, 0),
  }))));

  await crawlGeneralSitemapUrls();

  log('\n=== KLAAR ===');
}

main().catch((err) => {
  console.error('ONVERWACHTE FOUT:', err);
  process.exit(1);
});
