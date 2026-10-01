#!/usr/bin/env node
/**
 * TIJDELIJK diagnose-script, hoort bij .github/workflows/test-knowledge-sources.yml.
 * Geen onderdeel van de productie-Kenniscentrum-pipeline (scripts/kenniscentrum/).
 *
 * Haalt twee kandidaat-bronpagina's op zoals een gewone browser dat zou doen
 * (geen login, geen paywall-omzeiling, geen scraping van niet-publieke data)
 * en rapporteert puur technische, objectieve bevindingen: statuscode,
 * content-type, of de response HTML is, aanwijzingen voor RSS/JSON/sitemap/
 * paginering/API-endpoints, en een heuristische telling van mogelijke
 * artikel-links. Schrijft niets weg, wijzigt niets, commit niets.
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TARGETS = [
  { label: 'KVK — overzicht', url: 'https://www.kvk.nl/overzicht/' },
  { label: 'FD — net binnen', url: 'https://fd.nl/net-binnen' },
];

const AUX_PROBES = [
  { label: 'KVK robots.txt', url: 'https://www.kvk.nl/robots.txt' },
  { label: 'KVK sitemap.xml', url: 'https://www.kvk.nl/sitemap.xml' },
  { label: 'KVK sitemap_index.xml', url: 'https://www.kvk.nl/sitemap_index.xml' },
  { label: 'FD robots.txt', url: 'https://fd.nl/robots.txt' },
  { label: 'FD sitemap.xml', url: 'https://fd.nl/sitemap.xml' },
];

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function findAll(regex, text, mapFn) {
  return [...text.matchAll(regex)].map(mapFn);
}

async function probeMainPage({ label, url }) {
  section(`${label} — ${url}`);

  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    console.log(`BEREIKBAAR: nee — fout bij ophalen: ${err.message}`);
    return;
  }

  console.log(`BEREIKBAAR: ja`);
  console.log(`HTTP status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type') ?? '(geen header)'}`);
  console.log(`Finale URL na eventuele redirects: ${res.url}`);

  if (!res.ok) {
    console.log(`Response niet OK (status ${res.status}) — geen verdere inhoudsanalyse.`);
    return;
  }

  const text = await res.text();
  console.log(`Response-grootte: ${text.length} tekens`);

  const isHtml = /<html[\s>]/i.test(text);
  console.log(`Is HTML: ${isHtml}`);
  if (!isHtml) {
    console.log('Geen HTML-document ontvangen — geen verdere HTML-analyse.');
    return;
  }

  // --- RSS/Atom ---
  const rssLinks = findAll(
    /<link[^>]+type=["'](application\/rss\+xml|application\/atom\+xml)["'][^>]*>/gi,
    text,
    (m) => m[0],
  );
  console.log(`\nRSS/Atom <link>-tags gevonden: ${rssLinks.length}`);
  rssLinks.slice(0, 5).forEach((l) => console.log(`  ${l}`));

  // --- Embedded JSON (Next.js/Nuxt/generiek/JSON-LD) ---
  const hasNextData = text.includes('__NEXT_DATA__');
  const hasNuxtData = text.includes('__NUXT__') || text.includes('window.__NUXT__');
  const jsonLdBlocks = findAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi, text, (m) => m[0]);
  const jsonScriptBlocks = findAll(
    /<script[^>]+type=["']application\/json["'][^>]*(?:id=["']([^"']*)["'])?[^>]*>/gi,
    text,
    (m) => m[1] || '(zonder id)',
  );
  console.log(`\n__NEXT_DATA__ (Next.js embedded JSON) aanwezig: ${hasNextData}`);
  console.log(`__NUXT__ (Nuxt embedded JSON) aanwezig: ${hasNuxtData}`);
  console.log(`<script type="application/ld+json">-blocks: ${jsonLdBlocks.length}`);
  console.log(`<script type="application/json">-blocks: ${jsonScriptBlocks.length}`);
  jsonScriptBlocks.slice(0, 10).forEach((id) => console.log(`  id/kenmerk: ${id}`));

  // --- API-endpoint hints (paden die in inline scripts/markup voorkomen) ---
  const apiHints = [...new Set(findAll(/["'](\/api\/[a-zA-Z0-9\-_/]+)["']/g, text, (m) => m[1]))];
  const graphqlHint = /graphql/i.test(text);
  console.log(`\nMogelijke /api/-paden in de response: ${apiHints.length}`);
  apiHints.slice(0, 15).forEach((p) => console.log(`  ${p}`));
  console.log(`Verwijzing naar "graphql" aangetroffen: ${graphqlHint}`);

  // --- Paginering ---
  const hasRelNext = /rel=["']next["']/i.test(text);
  const hasPaginationWords = /(toon meer|laad meer|load more|volgende pagina|pagina\s*\d+|page=\d+)/i.test(text);
  console.log(`\nPaginering — rel="next" aanwezig: ${hasRelNext}`);
  console.log(`Paginering — tekst/query-aanwijzing ("toon meer" / page=N e.d.): ${hasPaginationWords}`);

  // --- Sitemap-verwijzing in de pagina zelf ---
  const sitemapRefs = [...new Set(findAll(/https?:\/\/[^"'\s]+sitemap[^"'\s]*\.xml/gi, text, (m) => m[0]))];
  console.log(`\nSitemap-verwijzingen in de pagina: ${sitemapRefs.length}`);
  sitemapRefs.slice(0, 5).forEach((s) => console.log(`  ${s}`));

  // --- Heuristische telling van mogelijke artikel-links ---
  // Anchors met een tekstlengte die past bij een artikeltitel (niet te kort
  // zoals "Home"/"Contact", niet te lang zoals een hele paragraaf).
  const anchors = findAll(/<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, text, (m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
  const candidates = anchors.filter((a) => a.text.length >= 25 && a.text.length <= 180);
  console.log(`\nTotaal <a>-tags: ${anchors.length}`);
  console.log(`Kandidaat-artikel-links (tekstlengte 25–180 tekens): ${candidates.length}`);
  candidates.slice(0, 15).forEach((a, i) => console.log(`  [${i + 1}] "${a.text}" → ${a.href}`));
  if (candidates.length > 15) console.log(`  ... en nog ${candidates.length - 15} meer`);

  console.log(`\n--- Samenvattend oordeel voor ${label} ---`);
  console.log(`RSS/API/JSON-aanwijzing gevonden: ${rssLinks.length > 0 || hasNextData || hasNuxtData || apiHints.length > 0 || jsonScriptBlocks.length > 0}`);
  console.log(`Meerdere artikel-kandidaten gevonden: ${candidates.length > 1}`);
}

async function probeAux({ label, url }) {
  try {
    const res = await fetchWithTimeout(url, 10000);
    const contentType = res.headers.get('content-type') ?? '(geen header)';
    console.log(`${label}: HTTP ${res.status}, content-type: ${contentType}`);
  } catch (err) {
    console.log(`${label}: fout bij ophalen (${err.message})`);
  }
}

async function main() {
  console.log(`Kenniscentrum-bronnenproef (tijdelijk) — ${new Date().toISOString()}`);
  console.log('Dit script wijzigt niets, voegt geen content toe en commit niets.');

  for (const target of TARGETS) {
    await probeMainPage(target);
  }

  section('Aanvullende proeven: robots.txt / sitemap.xml');
  for (const aux of AUX_PROBES) {
    await probeAux(aux);
  }

  section('Einde proef');
}

main().catch((err) => {
  console.error('Onverwachte fout in de testproef:', err);
  process.exit(1);
});
