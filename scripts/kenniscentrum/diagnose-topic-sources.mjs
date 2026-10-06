// TIJDELIJK, READ-ONLY diagnosescript — onderzoekt 7 Rijksoverheid-
// topicpagina's als mogelijke vervanging/aanvulling op de huidige
// algemene sitemap-bron. Schrijft NOOIT naar src/content/kenniscentrum,
// publiceert niets, commit niets. Wordt na gebruik weer volledig
// verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde geëxporteerde functies
// uit fetch-articles.mjs (extractMinistryTag, extractPageTitle,
// extractMetaDescription) voor de daadwerkelijke metadata-extractie.
// Introduceert geen nieuwe relevantielogica — dit script verzamelt
// uitsluitend ruwe data (links, feeds, sitemaps, paginainhoud) voor
// handmatige inhoudelijke beoordeling door de onderzoeker.

import {
  extractMinistryTag,
  extractPageTitle,
  extractMetaDescription,
} from './fetch-articles.mjs';

const FETCH_TIMEOUT_MS = 10000;

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
      redirect: 'follow',
    });
    const html = res.ok ? await res.text() : null;
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, html };
  } catch (err) {
    return { ok: false, status: null, finalUrl: url, html: null, error: err.message };
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

function extractPublishedDateFromText(fullText) {
  const m = fullText.match(/Nieuwsbericht\s+(\d{2}-\d{2}-\d{4})/);
  return m ? m[1] : null;
}

function extractFeedLinks(html) {
  const links = [];
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  for (const tag of html.match(re) || []) {
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (typeMatch && hrefMatch && /rss|atom/i.test(typeMatch[1])) {
      links.push({ type: typeMatch[1], href: hrefMatch[1] });
    }
  }
  return links;
}

function extractNewsLinks(html, baseUrl) {
  const links = new Set();
  const re = /href=["']([^"']*\/actueel\/nieuws\/[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      links.add(abs);
    } catch {
      // ignore unparseable
    }
  }
  return [...links];
}

function extractThemaSubLinks(html, baseUrl, pathPrefix) {
  const links = new Map(); // href -> anchor text
  const re = /<a[^>]+href=["']([^"']*themas\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (!abs.includes(pathPrefix)) continue;
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) links.set(abs, text);
    } catch {
      // ignore
    }
  }
  return [...links.entries()].map(([href, text]) => ({ href, text }));
}

async function fetchRssItems(feedUrl) {
  const { ok, html: xml } = await fetchPage(feedUrl);
  if (!ok || !xml) return null;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const entries = items.length ? items : [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  return entries.map((block) => {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? null;
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim()
      ?? block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    const pubDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim()
      ?? block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim() ?? null;
    return { title, link, pubDate };
  });
}

async function analyzeArticle(url) {
  const { ok, status, finalUrl, html } = await fetchPage(url);
  if (!ok || !html) return { url, ok: false, status };
  const title = extractPageTitle(html);
  const description = extractMetaDescription(html);
  const ministry = extractMinistryTag(html);
  const fullText = extractFullText(html);
  const publishedDate = extractPublishedDateFromText(fullText);
  return {
    url,
    finalUrl,
    ok: true,
    title,
    description,
    ministry,
    publishedDate,
    fullTextLength: fullText.length,
    fullText: fullText.slice(0, 1800),
  };
}

const KNOWN_TOPICS = [
  { key: 'belasting-betalen', label: 'Belastingen / Belasting betalen', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belasting-betalen' },
  { key: 'inkomstenbelasting', label: 'Inkomstenbelasting', url: 'https://www.rijksoverheid.nl/themas/werk/inkomstenbelasting' },
  { key: 'belastingplan', label: 'Belastingplan', url: 'https://www.rijksoverheid.nl/themas/belastingen-uitkeringen-en-toeslagen/belastingplan' },
  { key: 'zzp', label: 'Zelfstandigen zonder personeel (zzp)', url: 'https://www.rijksoverheid.nl/themas/werk/zelfstandigen-zonder-personeel-zzp' },
  { key: 'ondernemen-innovatie', label: 'Ondernemen en innovatie', url: 'https://www.rijksoverheid.nl/themas/economie/ondernemen-en-innovatie' },
  { key: 'buitenlandse-werknemers', label: 'Buitenlandse werknemers', url: 'https://www.rijksoverheid.nl/themas/migratie-en-reizen/buitenlandse-werknemers' },
];

async function main() {
  console.log('=== STAP 0: discovery werkgevers/arbeidsmarkt-topicpagina (via /themas/werk) ===');
  const werkThema = await fetchPage('https://www.rijksoverheid.nl/themas/werk');
  console.log(`THEMA_WERK_STATUS: ok=${werkThema.ok} status=${werkThema.status} finalUrl=${werkThema.finalUrl}`);
  let werkgeversUrl = null;
  if (werkThema.ok && werkThema.html) {
    const subLinks = extractThemaSubLinks(werkThema.html, werkThema.finalUrl, '/themas/werk/');
    console.log(`THEMA_WERK_SUBLINKS (${subLinks.length}):`);
    for (const l of subLinks) console.log(`  SUBLINK: ${l.href} | tekst="${l.text}"`);
    const candidate = subLinks.find((l) => /werkgever/i.test(l.text) || /werkgever/i.test(l.href))
      ?? subLinks.find((l) => /arbeidsmarkt/i.test(l.text) || /arbeidsmarkt/i.test(l.href))
      ?? subLinks.find((l) => /arbeidsovereenkomst/i.test(l.text) || /arbeidsovereenkomst/i.test(l.href));
    if (candidate) {
      werkgeversUrl = candidate.href;
      console.log(`GEKOZEN_WERKGEVERS_URL: ${werkgeversUrl} (reden: anchor-tekst/URL bevat 'werkgever', 'arbeidsmarkt' of 'arbeidsovereenkomst')`);
    } else {
      console.log('GEEN_WERKGEVERS_SUBLINK_GEVONDEN onder /themas/werk/');
    }
  }

  const topics = [...KNOWN_TOPICS];
  if (werkgeversUrl) {
    topics.push({ key: 'werkgevers', label: 'Werkgevers/arbeidsmarkt (SZW, zelf ontdekt)', url: werkgeversUrl });
  } else {
    topics.push({ key: 'werkgevers', label: 'Werkgevers/arbeidsmarkt (SZW, GEEN URL GEVONDEN)', url: null });
  }

  console.log('\n=== STAP 1: sitemap.xml volledige sub-sitemap-lijst (voor topic-sitemap-check) ===');
  const sitemapRes = await fetchPage('https://www.rijksoverheid.nl/sitemap.xml');
  if (sitemapRes.ok && sitemapRes.html) {
    const subSitemaps = [...sitemapRes.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log(`TOTAAL_SUBSITEMAPS: ${subSitemaps.length}`);
    for (const s of subSitemaps) console.log(`  SUBSITEMAP: ${s}`);
  } else {
    console.log('SITEMAP_XML_NIET_BEREIKBAAR');
  }

  console.log('\n=== STAP 2: per topic — pagina-analyse, feed-check, nieuwslinks, artikel-sampling ===');
  const allArticleUrls = new Map(); // url -> [topicKeys]

  for (const topic of topics) {
    console.log(`\n--- TOPIC: ${topic.label} [${topic.key}] ---`);
    if (!topic.url) {
      console.log('  GEEN URL BESCHIKBAAR, overgeslagen.');
      continue;
    }
    console.log(`  AANGEVRAAGDE_URL: ${topic.url}`);
    const page = await fetchPage(topic.url);
    console.log(`  STATUS: ok=${page.ok} httpStatus=${page.status} finalUrl=${page.finalUrl}`);
    if (page.finalUrl && page.finalUrl !== topic.url) {
      console.log(`  REDIRECT_GEDETECTEERD: ${topic.url} -> ${page.finalUrl}`);
    }
    if (!page.ok || !page.html) {
      console.log('  PAGINA NIET BEREIKBAAR, topic overgeslagen.');
      continue;
    }

    const feeds = extractFeedLinks(page.html);
    console.log(`  RSS/ATOM_FEEDS_GEVONDEN: ${feeds.length}`);
    for (const f of feeds) console.log(`    FEED: type=${f.type} href=${f.href}`);

    const newsLinks = extractNewsLinks(page.html, page.finalUrl);
    console.log(`  DIRECTE_NIEUWSLINKS_OP_PAGINA: ${newsLinks.length}`);

    let sampleUrls = [];
    let feedItemsInfo = null;
    if (feeds.length > 0) {
      const feedUrl = new URL(feeds[0].href, page.finalUrl).toString();
      const items = await fetchRssItems(feedUrl);
      if (items) {
        feedItemsInfo = { feedUrl, itemCount: items.length, oldestPubDate: items[items.length - 1]?.pubDate ?? null, newestPubDate: items[0]?.pubDate ?? null };
        console.log(`  FEED_ITEMS: url=${feedUrl} count=${items.length} newest=${feedItemsInfo.newestPubDate} oldest=${feedItemsInfo.oldestPubDate}`);
        sampleUrls = items.map((it) => it.link).filter(Boolean).slice(0, 10);
      } else {
        console.log(`  FEED_NIET_BEREIKBAAR_OF_LEEG: ${feedUrl}`);
      }
    }
    if (sampleUrls.length === 0) {
      sampleUrls = newsLinks.slice(0, 10);
      console.log(`  GEEN_FEED_GEBRUIKT, VAL_TERUG_OP_DIRECTE_NIEUWSLINKS: ${sampleUrls.length} genomen (van ${newsLinks.length} gevonden)`);
    }

    console.log(`  TE_ANALYSEREN_ARTIKELEN: ${sampleUrls.length}`);
    for (const url of sampleUrls) {
      allArticleUrls.set(url, [...(allArticleUrls.get(url) ?? []), topic.key]);
      const art = await analyzeArticle(url);
      if (!art.ok) {
        console.log(`  ARTICLE_FETCH_FAILED: ${url} status=${art.status}`);
        continue;
      }
      console.log(`ARTICLE_JSON: ${JSON.stringify({ topic: topic.key, ...art })}`);
    }
  }

  console.log('\n=== STAP 3: duplicate-analyse tussen topics ===');
  const duplicates = [...allArticleUrls.entries()].filter(([, topicsForUrl]) => topicsForUrl.length > 1);
  console.log(`TOTAAL_UNIEKE_ARTIKEL_URLS: ${allArticleUrls.size}`);
  console.log(`DUPLICATEN_TUSSEN_TOPICS: ${duplicates.length}`);
  for (const [url, topicsForUrl] of duplicates) {
    console.log(`  DUPLICATE: ${url} | topics=${topicsForUrl.join(',')}`);
  }

  console.log('\n=== KLAAR ===');
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
