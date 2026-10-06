// TIJDELIJK, READ-ONLY diagnosescript — onderzoekt hoe rijksoverheid.nl
// vanuit themapagina's naar VOLLEDIGE nieuwsresultaten per onderwerp
// navigeert ("meer nieuws"/"al het nieuws"-links, paginering), en of
// /opendata/onderwerplijst hiervoor bruikbaar is. Schrijft NOOIT naar
// src/content/kenniscentrum, publiceert niets, commit niets. Wordt na
// gebruik weer volledig verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde geëxporteerde functies
// uit fetch-articles.mjs (extractMinistryTag, extractPageTitle,
// extractMetaDescription) voor artikel-metadata. Introduceert geen nieuwe
// relevantielogica — dit script verzamelt uitsluitend ruwe, daadwerkelijk
// waargenomen data (links, HTTP-statussen, paginastructuur) voor
// handmatige beoordeling door de onderzoeker. Niets wordt verzonnen: als
// een patroon niet wordt aangetroffen, wordt dat expliciet zo gelogd.

import {
  extractMinistryTag,
  extractPageTitle,
  extractMetaDescription,
} from './fetch-articles.mjs';

const FETCH_TIMEOUT_MS = 10000;

async function fetchRaw(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
      redirect: 'follow',
    });
    const contentType = res.headers.get('content-type');
    const contentLength = res.headers.get('content-length');
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString('utf8');
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, contentType, contentLength, byteLength: buf.byteLength, text };
  } catch (err) {
    return { ok: false, status: null, finalUrl: url, contentType: null, contentLength: null, byteLength: 0, text: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// Decodeert alleen de HTML-entities die daadwerkelijk in href-attributen
// voorkomen (vooral &amp;), zodat een href als
// "...?a=1&amp;b=2" correct als "...?a=1&b=2" door new URL() wordt
// geparsed. Zonder deze stap zou de queryparameter-naam van elk
// queryparameter na de eerste onterecht "amp;"-geprefixt worden.
function decodeHtmlEntitiesInUrl(raw) {
  return raw.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
}

// Zoekt naar aanwijzingen dat de pagina haar inhoud (deels) via
// ingebedde JSON-state of client-side JavaScript laadt, in plaats van
// als server-gerenderde <a href>-links — relevant om te bepalen of een
// "0 artikel-links gevonden"-resultaat betekent dat er daadwerkelijk
// niets is, of dat de inhoud alleen buiten het bereik van een simpele
// HTML-fetch valt.
function findClientRenderedStateHints(html) {
  const hints = {};
  hints.scriptTagCount = (html.match(/<script[\s>]/gi) || []).length;
  hints.hasNextData = /__NEXT_DATA__/.test(html);
  hints.hasNuxt = /__NUXT__/.test(html);
  hints.hasApplicationJsonScript = /<script[^>]+type=["']application\/json["']/i.test(html);
  hints.mentionsTopicFilterValueInRawHtml = null; // per-call ingevuld door caller
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/(ld\+json|json)["'][^>]*>([\s\S]*?)<\/script>/gi)];
  hints.jsonScriptBlockCount = jsonLdMatches.length;
  hints.jsonScriptBlockSampleLengths = jsonLdMatches.slice(0, 5).map((m) => m[2].length);
  return hints;
}

const NAV_KEYWORD_RE = /nieuws|meer nieuws|al het nieuws|alle nieuws|bekijk meer|bekijk alle/i;

// Zoekt alle <a ...>...</a>-blokken, haalt href + zichtbare tekst +
// aria-label/title op, en toetst of de GEZOCHTE trefwoorden daadwerkelijk
// voorkomen (geen aanname, letterlijke regex-toets op de echte tekst).
function findNavLinks(html, baseUrl) {
  const results = [];
  const re = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const innerHtml = m[2];
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const ariaMatch = attrs.match(/aria-label=["']([^"']*)["']/i);
    const titleMatch = attrs.match(/title=["']([^"']*)["']/i);
    const visibleText = stripTags(innerHtml);
    const combinedText = [visibleText, ariaMatch?.[1], titleMatch?.[1]].filter(Boolean).join(' | ');
    if (!NAV_KEYWORD_RE.test(combinedText)) continue;
    let absUrl = null;
    try {
      absUrl = new URL(decodeHtmlEntitiesInUrl(hrefMatch[1]), baseUrl).toString();
    } catch {
      continue;
    }
    // Korte context (200 tekens vóór de link in de ruwe HTML) als zwakke
    // indicatie van "waar op de pagina" — expliciet alleen gebruikt als
    // indicatie, nooit als harde waarheid (zie rapport: "indien
    // betrouwbaar te bepalen").
    const contextStart = Math.max(0, m.index - 200);
    const precedingRaw = html.slice(contextStart, m.index);
    const precedingText = stripTags(precedingRaw).slice(-120);
    results.push({
      href: hrefMatch[1],
      absUrl,
      visibleText,
      ariaLabel: ariaMatch?.[1] ?? null,
      title: titleMatch?.[1] ?? null,
      precedingTextSample: precedingText,
    });
  }
  return results;
}

function findActueelNieuwsLinks(html, baseUrl) {
  const links = new Set();
  const re = /href=["']([^"']*\/actueel\/nieuws\/[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      links.add(new URL(decodeHtmlEntitiesInUrl(m[1]), baseUrl).toString());
    } catch {
      // ignore
    }
  }
  return [...links];
}

// Zoekt expliciet naar de genoemde paginering-signalen — geen aannames,
// alleen wat daadwerkelijk als patroon in de HTML voorkomt.
function findPaginationSignals(html, baseUrl) {
  const signals = { relNext: null, relPrev: null, volgendeLink: null, meerLink: null, queryParamCandidates: [] };

  const relNextMatch = html.match(/<link[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i)
    ?? html.match(/<a[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i);
  if (relNextMatch) {
    try { signals.relNext = new URL(decodeHtmlEntitiesInUrl(relNextMatch[1]), baseUrl).toString(); } catch { /* ignore */ }
  }
  const relPrevMatch = html.match(/<link[^>]+rel=["']prev(?:ious)?["'][^>]*href=["']([^"']+)["']/i);
  if (relPrevMatch) {
    try { signals.relPrev = new URL(decodeHtmlEntitiesInUrl(relPrevMatch[1]), baseUrl).toString(); } catch { /* ignore */ }
  }

  const aTagRe = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aTagRe.exec(html))) {
    const hrefMatch = m[1].match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const text = stripTags(m[2]);
    if (!signals.volgendeLink && /^volgende\b|volgende\s*(pagina|resultaten)?/i.test(text)) {
      try { signals.volgendeLink = { text, url: new URL(decodeHtmlEntitiesInUrl(hrefMatch[1]), baseUrl).toString() }; } catch { /* ignore */ }
    }
    if (!signals.meerLink && /^meer\b/i.test(text)) {
      try { signals.meerLink = { text, url: new URL(decodeHtmlEntitiesInUrl(hrefMatch[1]), baseUrl).toString() }; } catch { /* ignore */ }
    }
  }

  // Query-parameter-kandidaten: zoek in alle hrefs op de pagina naar
  // bekende paginering-parameternamen.
  const paramNames = ['page', 'pagina', 'offset', 'start', 'from', 'limit', 'cursor'];
  const hrefRe = /href=["']([^"']+)["']/gi;
  const seenParams = new Set();
  while ((m = hrefRe.exec(html))) {
    try {
      const u = new URL(decodeHtmlEntitiesInUrl(m[1]), baseUrl);
      for (const p of paramNames) {
        if (u.searchParams.has(p) && !seenParams.has(p)) {
          seenParams.add(p);
          signals.queryParamCandidates.push({ param: p, exampleUrl: u.toString() });
        }
      }
    } catch {
      // ignore
    }
  }
  return signals;
}

function extractCanonical(html, baseUrl) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (!m) return null;
  try { return new URL(decodeHtmlEntitiesInUrl(m[1]), baseUrl).toString(); } catch { return null; }
}

function extractPublishedDateFromText(fullText) {
  const m = fullText.match(/Nieuwsbericht\s+(\d{2}-\d{2}-\d{4})/);
  return m ? m[1] : null;
}

const THEME_PAGES = [
  { key: 'belasting-betalen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belasting-betalen' },
  { key: 'inkomstenbelasting', url: 'https://www.rijksoverheid.nl/themas/werk/inkomstenbelasting' },
  { key: 'belastingplan', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belastingplan' },
  { key: 'zzp', url: 'https://www.rijksoverheid.nl/themas/werk/zelfstandigen-zonder-personeel-zzp' },
  { key: 'ziekteverzuim-reintegratie', url: 'https://www.rijksoverheid.nl/themas/werk/ziekteverzuim-van-het-werk' },
  { key: 'arbeidsbeperking', url: 'https://www.rijksoverheid.nl/themas/werk/werken-met-arbeidsbeperking' },
  { key: 'buitenlandse-werknemers', url: 'https://www.rijksoverheid.nl/themas/migratie-en-reizen/buitenlandse-werknemers' },
];

const DEEP_DIVE_TOPICS = new Set(['belasting-betalen', 'inkomstenbelasting', 'zzp']);
const MAX_FOLLOWUP_PAGES = 3; // pagina 1 + maximaal 2 vervolgpagina's

async function main() {
  console.log('=== ONDERZOEK 1: themapagina-HTML inspecteren op "meer nieuws"-links ===');
  const navLinksByTopic = {};
  for (const topic of THEME_PAGES) {
    console.log(`\n--- THEMAPAGINA: ${topic.key} ---`);
    console.log(`  URL: ${topic.url}`);
    const page = await fetchRaw(topic.url);
    console.log(`  HTTP_STATUS: ${page.status} finalUrl=${page.finalUrl}`);
    if (!page.ok || !page.text) {
      console.log('  NIET_BEREIKBAAR, overgeslagen.');
      navLinksByTopic[topic.key] = [];
      continue;
    }
    const navLinks = findNavLinks(page.text, page.finalUrl);
    console.log(`  NIEUWS_NAV_LINKS_GEVONDEN: ${navLinks.length}`);
    for (const l of navLinks) {
      const u = new URL(l.absUrl);
      const hasActueelNieuws = u.pathname.includes('/actueel/nieuws');
      const queryParams = [...u.searchParams.entries()];
      console.log(`NAVLINK_JSON: ${JSON.stringify({ topic: topic.key, ...l, hasActueelNieuwsPath: hasActueelNieuws, queryParams })}`);
    }
    if (navLinks.length === 0) {
      console.log('  GEEN_NIEUWS_NAV_LINK_GEVONDEN_OP_DEZE_PAGINA');
    }
    navLinksByTopic[topic.key] = navLinks;
  }

  console.log('\n=== ONDERZOEK 2: gevonden "meer nieuws"-URL\'s volgen (paginering) ===');
  const uniqueTargets = new Map(); // absUrl -> [topics]
  for (const [topicKey, links] of Object.entries(navLinksByTopic)) {
    for (const l of links) {
      uniqueTargets.set(l.absUrl, [...(uniqueTargets.get(l.absUrl) ?? []), topicKey]);
    }
  }
  console.log(`UNIEKE_MEER_NIEUWS_URLS: ${uniqueTargets.size}`);

  const followUpResults = {};
  for (const [targetUrl, topicsForUrl] of uniqueTargets.entries()) {
    console.log(`\n--- VOLG: ${targetUrl} (topics: ${topicsForUrl.join(',')}) ---`);
    const pages = [];
    let currentUrl = targetUrl;
    const visited = new Set();
    for (let pageNum = 1; pageNum <= MAX_FOLLOWUP_PAGES && currentUrl && !visited.has(currentUrl); pageNum++) {
      visited.add(currentUrl);
      const res = await fetchRaw(currentUrl);
      console.log(`  PAGINA ${pageNum}: url=${currentUrl} status=${res.status}`);
      if (!res.ok || !res.text) {
        console.log(`  PAGINA_${pageNum}_NIET_BEREIKBAAR`);
        break;
      }
      const canonical = extractCanonical(res.text, res.finalUrl);
      const articleLinks = findActueelNieuwsLinks(res.text, res.finalUrl);
      const pagination = findPaginationSignals(res.text, res.finalUrl);
      console.log(`  CANONICAL: ${canonical}`);
      console.log(`  ARTIKEL_LINKS_OP_PAGINA: ${articleLinks.length}`);
      console.log(`  PAGINATION_SIGNALS: ${JSON.stringify(pagination)}`);
      // Als er 0 artikel-links worden gevonden: controleer of dat is omdat
      // de pagina haar resultaten (mogelijk) client-side/via JavaScript
      // laadt in plaats van als server-gerenderde <a href>-links, vóórdat
      // "0 resultaten" als conclusie wordt genomen.
      if (articleLinks.length === 0) {
        const renderHints = findClientRenderedStateHints(res.text);
        const topicValueMatch = currentUrl.match(/values%5D%5B0%5D=([^&]+)/);
        const topicValueDecoded = topicValueMatch ? decodeURIComponent(topicValueMatch[1].replace(/\+/g, ' ')) : null;
        renderHints.topicFilterValueFoundLiterallyInHtml = topicValueDecoded ? res.text.includes(topicValueDecoded) : null;
        renderHints.rawHtmlByteLength = res.text.length;
        console.log(`  CLIENT_RENDER_HINTS (0 artikel-links): ${JSON.stringify(renderHints)}`);
      }
      pages.push({ pageNum, url: currentUrl, status: res.status, canonical, articleLinks, pagination });
      currentUrl = pagination.relNext ?? pagination.volgendeLink?.url ?? null;
      if (currentUrl && visited.has(currentUrl)) {
        console.log('  VOLGENDE_PAGINA_URL_IDENTIEK_AAN_BEZOCHTE_PAGINA, stoppen.');
        break;
      }
      if (!currentUrl) {
        console.log('  GEEN_VOLGENDE_PAGINA_MECHANISME_GEVONDEN, stoppen na deze pagina.');
      }
    }
    followUpResults[targetUrl] = { topics: topicsForUrl, pages };
  }

  console.log('\n=== ONDERZOEK 3: inhoudelijke steekproef voor belasting-betalen / inkomstenbelasting / zzp ===');
  for (const topicKey of DEEP_DIVE_TOPICS) {
    console.log(`\n--- DIEPTEONDERZOEK: ${topicKey} ---`);
    const links = navLinksByTopic[topicKey] ?? [];
    if (links.length === 0) {
      console.log('  GEEN_MEER_NIEUWS_LINK_GEVONDEN_VOOR_DIT_ONDERWERP, dus geen vervolgpagina-onderzoek mogelijk.');
      continue;
    }
    const targetUrl = links[0].absUrl;
    const result = followUpResults[targetUrl];
    const allArticleUrls = new Set();
    for (const p of result.pages) {
      for (const a of p.articleLinks) allArticleUrls.add(a);
    }
    console.log(`  UNIEKE_ARTIKEL_URLS_OVER_${result.pages.length}_PAGINA('S): ${allArticleUrls.size}`);
    let i = 0;
    for (const articleUrl of allArticleUrls) {
      i += 1;
      const page = await fetchRaw(articleUrl);
      if (!page.ok || !page.text) {
        console.log(`  ARTIKEL_NIET_BEREIKBAAR: ${articleUrl}`);
        continue;
      }
      const title = extractPageTitle(page.text);
      const description = extractMetaDescription(page.text);
      const ministry = extractMinistryTag(page.text);
      const fullTextForDate = stripTags(page.text).slice(0, 2000);
      const publishedDate = extractPublishedDateFromText(fullTextForDate);
      console.log(`DEEPDIVE_ARTICLE_JSON: ${JSON.stringify({ topic: topicKey, articleUrl, title, description, ministry, publishedDate })}`);
    }
  }

  console.log('\n=== ONDERZOEK 4: /opendata/onderwerplijst ===');
  const opendataUrl = 'https://www.rijksoverheid.nl/opendata/onderwerplijst';
  const opendata = await fetchRaw(opendataUrl);
  console.log(`OPENDATA_STATUS: ${opendata.status} finalUrl=${opendata.finalUrl}`);
  console.log(`OPENDATA_CONTENT_TYPE: ${opendata.contentType}`);
  console.log(`OPENDATA_CONTENT_LENGTH_HEADER: ${opendata.contentLength}`);
  console.log(`OPENDATA_ACTUAL_BYTE_LENGTH: ${opendata.byteLength}`);
  if (opendata.ok && opendata.text) {
    const sniff = opendata.text.trim().slice(0, 300);
    console.log(`OPENDATA_FIRST_300_CHARS: ${JSON.stringify(sniff)}`);
    let detectedFormat = 'onbekend';
    if (/^<\?xml/i.test(opendata.text.trim()) || /^<[a-zA-Z]/.test(opendata.text.trim())) {
      detectedFormat = 'xml-achtig';
      const rootMatch = opendata.text.match(/<([a-zA-Z0-9_:-]+)[\s>]/);
      console.log(`OPENDATA_XML_ROOT_ELEMENT: ${rootMatch?.[1] ?? 'onbekend'}`);
      const childTags = new Set();
      const tagRe = /<([a-zA-Z0-9_:-]+)[\s>/]/g;
      let tm;
      let count = 0;
      while ((tm = tagRe.exec(opendata.text)) && count < 5000) {
        childTags.add(tm[1]);
        count += 1;
      }
      console.log(`OPENDATA_XML_DISTINCT_TAGS (max 50 getoond): ${[...childTags].slice(0, 50).join(', ')}`);
      const urlMatches = [...opendata.text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
      console.log(`OPENDATA_URLS_GEVONDEN_IN_BESTAND (eerste 10 van ${urlMatches.length}): ${JSON.stringify(urlMatches.slice(0, 10))}`);
    } else if (/^[{[]/.test(opendata.text.trim())) {
      detectedFormat = 'json-achtig';
      try {
        const parsed = JSON.parse(opendata.text);
        const topLevelKeys = Array.isArray(parsed) ? `array met ${parsed.length} items` : Object.keys(parsed);
        console.log(`OPENDATA_JSON_TOPLEVEL: ${JSON.stringify(topLevelKeys)}`);
        const sampleItem = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
        console.log(`OPENDATA_JSON_SAMPLE_ITEM: ${JSON.stringify(sampleItem)?.slice(0, 1000)}`);
      } catch (err) {
        console.log(`OPENDATA_JSON_PARSE_FOUT: ${err.message}`);
      }
    }
    console.log(`OPENDATA_DETECTED_FORMAT: ${detectedFormat}`);
  } else {
    console.log('OPENDATA_NIET_BEREIKBAAR_OF_LEEG');
  }

  console.log('\n=== KLAAR ===');
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
