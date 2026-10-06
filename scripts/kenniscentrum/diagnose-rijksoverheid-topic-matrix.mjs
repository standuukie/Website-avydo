#!/usr/bin/env node
/**
 * TIJDELIJK, READ-ONLY onderzoeksscript. Geen onderdeel van de productie-
 * pijplijn, importeert niets uit fetch-articles.mjs/sources.config.mjs en
 * schrijft niets naar src/content/. Wordt na gebruik volledig verwijderd.
 *
 * Doel: de daadwerkelijke rijksoverheid.nl topic-API (POST /api/search)
 * bevragen voor een reeks kandidaat-onderwerpen, zonder te gokken op
 * topicnamen of op de exacte request-body-structuur. Ronde 2: een eerdere
 * poging om de body uit het geheugen te reconstrueren gaf HTTP 400
 * "Invalid search request" — dus nu wordt de ECHTE, huidige request eerst
 * opnieuw live gecaptured met Playwright (net als het eerdere onderzoek),
 * en die exacte body wordt als sjabloon hergebruikt (alleen topic/pagina
 * aangepast), nooit hertypt.
 */
import { chromium } from 'playwright';

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

// --- Stap A: de ECHTE, huidige /api/search-request live capturen met een browser ---

async function captureRealApiTemplate(page) {
  log('\n=== STAP A: echte /api/search-request opnieuw live capturen (Belasting betalen) ===');
  const url = 'https://www.rijksoverheid.nl/actueel/nieuws?size=n_10_n&filters[0][field]=topic&filters[0][values][0]=Belasting%20betalen&filters[0][type]=all';
  let captured = null;
  const onRequest = (req) => {
    if (req.url().includes('/api/search') && req.method() === 'POST' && !captured) {
      captured = { url: req.url(), postData: req.postData() };
    }
  };
  page.on('request', onRequest);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    log(`CAPTURE_TEMPLATE_NAV_ERROR: ${err.message}`);
  }
  page.off('request', onRequest);
  if (!captured) {
    log('CAPTURE_TEMPLATE_RESULT: GEEN /api/search-request gezien tijdens page load');
    return null;
  }
  log(`CAPTURE_TEMPLATE_RESULT: gevonden, url=${captured.url}`);
  console.log('CAPTURE_TEMPLATE_POSTDATA: ' + captured.postData);
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(captured.postData);
  } catch (err) {
    log(`CAPTURE_TEMPLATE_PARSE_ERROR: ${err.message}`);
    return null;
  }
  return { apiUrl: captured.url, body: parsedBody };
}

function cloneTemplateForTopic(template, topicValue, current) {
  const body = JSON.parse(JSON.stringify(template.body));
  const filters = body.requestState?.filters ?? [];
  const topicFilter = filters.find((f) => f.field === 'topic');
  if (topicFilter) topicFilter.values = [topicValue];
  else filters.push({ field: 'topic', values: [topicValue], type: 'all' });
  body.requestState.current = current;
  return body;
}

async function callSearchApi(apiUrl, body) {
  let res;
  try {
    res = await fetchWithTimeout(apiUrl, {
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
    // niet-JSON response
  }
  return { ok: res.ok, status, contentType, text, parsed };
}

async function testHashVariants(template) {
  log('\n=== STAP 0: is de ?hash=-parameter daadwerkelijk nodig (nu met de echte, correcte body)? ===');
  const base = new URL(template.apiUrl);
  const noHashUrl = `${base.origin}${base.pathname}`;
  const variants = [
    { label: 'origineel-gecaptured-hash', url: template.apiUrl },
    { label: 'geen-hash-param', url: noHashUrl },
    { label: 'dummy-hash', url: `${noHashUrl}?hash=deadbeef` },
  ];
  for (const v of variants) {
    const r = await callSearchApi(v.url, template.body);
    const count = r.parsed?.rawResponse?.rawResults?.length ?? 'n/a';
    log(`HASH_TEST variant=${v.label} status=${r.status ?? 'ERR'} resultCount=${count} error=${r.error ?? ''}`);
  }
}

async function discoverTopicFacet(template) {
  log('\n=== STAP 2a: topic-facet opvragen via de echte sjabloon-body (extra facet toegevoegd) ===');
  const body = JSON.parse(JSON.stringify(template.body));
  body.requestState.filters = (body.requestState.filters ?? []).filter((f) => f.field !== 'topic');
  body.requestState.current = 1;
  body.requestState.resultsPerPage = 1;
  body.queryConfig = body.queryConfig || {};
  body.queryConfig.facets = body.queryConfig.facets || {};
  body.queryConfig.facets.topic = { type: 'value', size: 300 };
  if (Array.isArray(body.queryConfig.disjunctiveFacets)) {
    if (!body.queryConfig.disjunctiveFacets.includes('topic')) body.queryConfig.disjunctiveFacets.push('topic');
  }
  const r = await callSearchApi(template.apiUrl, body);
  log(`TOPIC_FACET_HTTP_STATUS: ${r.status ?? 'ERR'} error=${r.error ?? ''}`);
  const topicFacetData = r.parsed?.facets?.topic?.[0]?.data ?? null;
  if (!topicFacetData) {
    log('TOPIC_FACET_RESULT: geen topic-facet in response');
    log('TOPIC_FACET_BODY_SAMPLE: ' + (r.text || '').slice(0, 1200));
    return null;
  }
  log(`TOPIC_FACET_COUNT: ${topicFacetData.length} topicwaarden gevonden`);
  console.log('TOPIC_FACET_JSON: ' + JSON.stringify(topicFacetData));
  return topicFacetData;
}

// --- Stap B: thema-overzichtspagina's (plain fetch werkte hier al, status 200) ---

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
  return { byThema };
}

// --- Stap C: topic-link per pagina via de ECHTE browser-DOM (robuust tegen encoding) ---

async function findTopicValueViaDom(page, pageUrl) {
  let resp;
  try {
    resp = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    return { pageOk: false, error: err.message };
  }
  if (!resp || !resp.ok()) return { pageOk: false, status: resp ? resp.status() : null };
  let hrefs = [];
  try {
    hrefs = await page.$$eval('a', (as) => as.map((a) => a.href).filter((h) => h.includes('filters') && h.toLowerCase().includes('topic')));
  } catch (err) {
    return { pageOk: true, status: resp.status(), error: err.message, topicValueFound: null };
  }
  if (hrefs.length === 0) return { pageOk: true, status: resp.status(), topicValueFound: null };
  try {
    const u = new URL(hrefs[0]);
    const val = u.searchParams.get('filters[0][values][0]');
    return { pageOk: true, status: resp.status(), topicValueFound: val, matchedHref: hrefs[0] };
  } catch {
    return { pageOk: true, status: resp.status(), topicValueFound: null, matchedHref: hrefs[0] };
  }
}

const CANDIDATE_PAGES = [
  { key: 'belasting-betalen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belasting-betalen' },
  { key: 'inkomstenbelasting', url: 'https://www.rijksoverheid.nl/themas/werk/inkomstenbelasting' },
  { key: 'belastingverdragen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belastingverdragen' },
  { key: 'bbz', url: 'https://www.rijksoverheid.nl/themas/werk/bijstand-voor-zelfstandigen-bbz' },
  { key: 'europese-subsidies', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/europese-subsidies' },
  { key: 'prinsjesdag-belastingplan', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belastingplan' },
  { key: 'belastingontwijking', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/aanpak-belastingontwijking-en-belastingontduiking' },
  { key: 'zzp', url: 'https://www.rijksoverheid.nl/themas/werk/zelfstandigen-zonder-personeel-zzp' },
  { key: 'ziekteverzuim', url: 'https://www.rijksoverheid.nl/themas/werk/ziekteverzuim-van-het-werk' },
  { key: 'arbeidsbeperking', url: 'https://www.rijksoverheid.nl/themas/werk/werken-met-arbeidsbeperking' },
  { key: 'buitenlandse-werknemers', url: 'https://www.rijksoverheid.nl/themas/migratie-en-reizen/buitenlandse-werknemers' },
  { key: 'ondernemen-innovatie', url: 'https://www.rijksoverheid.nl/themas/economie/ondernemen-en-innovatie' },
];

async function resolveCandidateTopicNames(page) {
  log('\n=== STAP 2: exacte topicnaam per kandidaat-onderwerp bepalen (via echte browser-DOM, geen gok) ===');
  const resolved = [];
  for (const cand of CANDIDATE_PAGES) {
    const r = await findTopicValueViaDom(page, cand.url);
    log(`CANDIDATE_PAGE key=${cand.key} url=${cand.url} pageOk=${r.pageOk} status=${r.status ?? ''} topicValueFound=${r.topicValueFound ?? 'GEEN'} error=${r.error ?? ''}`);
    resolved.push({ ...cand, ...r });
  }
  console.log('CANDIDATE_RESOLUTION_JSON: ' + JSON.stringify(resolved));
  return resolved;
}

async function resolveAllBelastingenSubtopics(page, crawlData) {
  log('\n=== STAP 9: ALLE subonderwerpen onder "Belastingen, uitkeringen en toeslagen" resolven (volledige enumeratie, geen selectie) ===');
  const subpages = crawlData.byThema['belastingen-uitkeringen-en-toeslagen'] || [];
  const resolved = [];
  for (const sp of subpages) {
    const fullUrl = `https://www.rijksoverheid.nl${sp.href}`;
    const r = await findTopicValueViaDom(page, fullUrl);
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

async function testTopicPages(template, topicName, label, maxPages = 3) {
  log(`\n--- API-test voor topic="${topicName}" (label=${label}) ---`);
  const pages = [];
  let infoTypeFacetTotal = null;
  for (let current = 1; current <= maxPages; current++) {
    const body = cloneTemplateForTopic(template, topicName, current);
    const r = await callSearchApi(template.apiUrl, body);
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
    if (!rr.ok) continue;
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
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: UA });

  const template = await captureRealApiTemplate(page);
  if (!template) {
    log('FATALE FOUT: kon geen geldige /api/search-sjabloon capturen. Stoppen.');
    await browser.close();
    process.exit(1);
  }

  await testHashVariants(template);
  await discoverTopicFacet(template);
  const crawlData = await crawlAllThemaOverviews();
  const candidateResolution = await resolveCandidateTopicNames(page);
  const belastingenSubtopics = await resolveAllBelastingenSubtopics(page, crawlData);

  await browser.close();

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
  if (!seenTopicNames.has('Belasting betalen')) topicsToTest.push({ label: 'belasting-betalen-fallback', topicName: 'Belasting betalen' });

  const allResults = [];
  for (const t of topicsToTest) {
    const res = await testTopicPages(template, t.topicName, t.label, 3);
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
