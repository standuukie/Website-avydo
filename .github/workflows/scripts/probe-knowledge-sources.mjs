#!/usr/bin/env node
/**
 * TIJDELIJK diagnose-script, hoort bij .github/workflows/test-knowledge-sources.yml.
 * Geen onderdeel van de productie-Kenniscentrum-pipeline (scripts/kenniscentrum/).
 *
 * Ronde 3 (KVK-only): ronde 2 vond alleen "siteMenuItems" (navigatie) in
 * __NEXT_DATA__, geen artikeldata. Deze ronde zoekt gericht naar waar de
 * daadwerkelijke artikelkaarten vandaan komen:
 *  (a) server-rendered HTML rond de eerder gevonden artikel-links;
 *  (b) ALLE embedded JSON-datasets (niet alleen de eerste/grootste match);
 *  (c) Next.js' eigen publieke per-pagina data-route (/_next/data/<buildId>/…),
 *      een gedocumenteerd, publiek mechanisme — geen private/undocumented API;
 *  (d) de sitemapstructuur: sitemap/pages.xml en eventuele documents-*.xml.
 *
 * Haalt alleen publieke URL's op zoals een gewone browser dat zou doen.
 * Geen reverse engineering van private endpoints, geen omzeiling van
 * toegangsbeperkingen. Schrijft niets weg, wijzigt niets, commit niets.
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const KVK_OVERZICHT_URL = 'https://www.kvk.nl/overzicht/';
const KVK_SITEMAP_PAGES_URL = 'https://www.kvk.nl/sitemap/pages.xml';

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
        Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Zoekt RECURSIEF naar álle arrays van objecten met titel+url-achtige velden,
// op elke diepte (geen limiet van 5 zoals ronde 2) — en noteert ook arrays
// die hierop lijken maar een datum- of samenvattingsveld hebben, zodat we
// ook "bijna raak" kunnen zien i.p.v. alleen de eerste treffer.
function findArticleLikeArrays(node, path = '$', results = [], depth = 0, seen = new WeakSet()) {
  if (depth > 20) return results;
  if (node && typeof node === 'object') {
    if (seen.has(node)) return results;
    seen.add(node);
  }
  if (Array.isArray(node)) {
    if (node.length >= 2 && node.every((el) => el && typeof el === 'object' && !Array.isArray(el))) {
      const sample = node[0];
      const keys = Object.keys(sample).map((k) => k.toLowerCase());
      const hasTitleLike = keys.some((k) => /title|titel|heading|name|naam|kop/.test(k));
      const hasUrlLike = keys.some((k) => /url|link|href|slug|path/.test(k));
      const hasDateLike = keys.some((k) => /date|datum|published|publicat|modified|updated/.test(k));
      const hasSummaryLike = keys.some((k) => /summary|samenvatting|description|omschrijving|intro|excerpt|teaser|body|content/.test(k));
      if (hasTitleLike || hasUrlLike) {
        results.push({
          path,
          length: node.length,
          sampleKeys: Object.keys(sample),
          score: [hasTitleLike, hasUrlLike, hasDateLike, hasSummaryLike].filter(Boolean).length,
        });
      }
    }
    node.forEach((el, i) => findArticleLikeArrays(el, `${path}[${i}]`, results, depth + 1, seen));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      findArticleLikeArrays(value, `${path}.${key}`, results, depth + 1, seen);
    }
  }
  return results;
}

function getByPath(root, path) {
  const parts = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\d+\]/g) || [];
  let cur = root;
  for (const part of parts) {
    cur = /^\[\d+\]$/.test(part) ? cur?.[Number(part.slice(1, -1))] : cur?.[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

let cachedHtml = null;
let cachedNextData = null;

async function probeKvkOverzicht() {
  section(`KVK — overzicht — ${KVK_OVERZICHT_URL}`);

  let res;
  try {
    res = await fetchWithTimeout(KVK_OVERZICHT_URL);
  } catch (err) {
    console.log(`BEREIKBAAR: nee — fout bij ophalen: ${err.message}`);
    return;
  }
  console.log(`HTTP status: ${res.status}`);
  if (!res.ok) {
    console.log('Response niet OK — geen verdere analyse.');
    return;
  }
  const html = await res.text();
  cachedHtml = html;
  console.log(`Response-grootte: ${html.length} tekens`);

  // --- (a) Server-rendered HTML rond artikel-achtige links ---
  section('(a) Server-rendered HTML rond artikel-achtige links');
  // Zoek <a>-tags met een redelijk lange, titel-achtige teksinhoud, en toon
  // de omringende HTML (300 tekens vóór/na) zodat zichtbaar is of dit in een
  // herhaald "kaart"-element staat (bv. <article>, class met "card"/"teaser").
  const anchorRegex = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const anchors = [...html.matchAll(anchorRegex)]
    .map((m) => ({ href: m[1], raw: m[0], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), index: m.index }))
    .filter((a) => a.text.length >= 25 && a.text.length <= 180);
  console.log(`Kandidaat-artikel-links gevonden: ${anchors.length}`);
  anchors.slice(0, 6).forEach((a, i) => {
    const start = Math.max(0, a.index - 300);
    const end = Math.min(html.length, a.index + a.raw.length + 100);
    console.log(`\n--- Context rond kandidaat [${i + 1}]: "${a.text}" → ${a.href} ---`);
    console.log(html.slice(start, end).replace(/\s+/g, ' '));
  });

  // --- (b) Alle embedded JSON-datasets ---
  section('(b) Embedded JSON — __NEXT_DATA__, alle artikel-achtige arrays (geen limiet)');
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      cachedNextData = data;
      console.log('buildId:', data.buildId ?? '(niet aanwezig)');
      console.log('page:', data.page ?? '(niet aanwezig)');
      const candidates = findArticleLikeArrays(data);
      console.log(`\nAlle artikel-achtige arrays gevonden: ${candidates.length}`);
      candidates
        .sort((x, y) => y.score - x.score)
        .forEach((c, i) => {
          console.log(`[${i + 1}] score=${c.score} pad=${c.path} lengte=${c.length} sleutels=${JSON.stringify(c.sampleKeys)}`);
        });
      const best = candidates.sort((x, y) => y.score - x.score)[0];
      if (best) {
        const arr = getByPath(data, best.path);
        console.log(`\n--- Volledig eerste item van de best scorende kandidaat (${best.path}) ---`);
        console.log(JSON.stringify(arr[0], null, 2));
      }
    } catch (err) {
      console.log(`Kon __NEXT_DATA__ niet parsen: ${err.message}`);
    }
  } else {
    console.log('Geen __NEXT_DATA__ gevonden.');
  }

  // Overige <script type="application/json">-blocks (niet __NEXT_DATA__)
  const otherJsonBlocks = [...html.matchAll(/<script(?![^>]*__NEXT_DATA__)[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  console.log(`\nOverige <script type="application/json">-blocks: ${otherJsonBlocks.length}`);
  otherJsonBlocks.slice(0, 5).forEach((m, i) => {
    console.log(`\n--- block ${i + 1} (eerste 400 tekens) ---`);
    console.log(m[1].slice(0, 400));
  });

  // --- (c) Next.js publieke per-pagina data-route ---
  section('(c) Next.js publieke data-route (/_next/data/<buildId>/…) — gedocumenteerd, publiek mechanisme');
  const buildId = cachedNextData?.buildId;
  if (!buildId) {
    console.log('Geen buildId gevonden in __NEXT_DATA__ — kan deze route niet samenstellen.');
  } else {
    const dataUrl = `https://www.kvk.nl/_next/data/${buildId}/overzicht.json`;
    console.log(`Proberen: ${dataUrl}`);
    try {
      const dataRes = await fetchWithTimeout(dataUrl, 15000);
      console.log(`HTTP status: ${dataRes.status}, content-type: ${dataRes.headers.get('content-type')}`);
      if (dataRes.ok) {
        const json = await dataRes.json();
        console.log('Top-level sleutels:', Object.keys(json));
        const candidates = findArticleLikeArrays(json);
        console.log(`Artikel-achtige arrays in deze route: ${candidates.length}`);
        candidates.sort((x, y) => y.score - x.score).forEach((c, i) => {
          console.log(`[${i + 1}] score=${c.score} pad=${c.path} lengte=${c.length} sleutels=${JSON.stringify(c.sampleKeys)}`);
        });
        const best = candidates.sort((x, y) => y.score - x.score)[0];
        if (best) {
          const arr = getByPath(json, best.path);
          console.log(`\n--- Eerste 2 items van beste kandidaat (${best.path}) ---`);
          console.log(JSON.stringify(arr.slice(0, 2), null, 2));
        }
      }
    } catch (err) {
      console.log(`Fout bij ophalen: ${err.message}`);
    }
  }
}

async function probeKvkSitemapPages() {
  section(`(d) KVK — sitemap/pages.xml — ${KVK_SITEMAP_PAGES_URL}`);
  let res;
  try {
    res = await fetchWithTimeout(KVK_SITEMAP_PAGES_URL, 15000);
  } catch (err) {
    console.log(`Fout bij ophalen: ${err.message}`);
    return;
  }
  console.log(`HTTP status: ${res.status}, content-type: ${res.headers.get('content-type')}`);
  if (!res.ok) return;
  const xml = await res.text();
  console.log(`Response-grootte: ${xml.length} tekens`);

  const isIndex = /<sitemapindex/i.test(xml);
  console.log(`Is een sitemapindex (verwijst naar andere sitemaps): ${isIndex}`);

  if (isIndex) {
    const subSitemaps = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log(`Aantal sub-sitemaps: ${subSitemaps.length}`);
    const documentSitemaps = subSitemaps.filter((u) => /documents?-/i.test(u));
    console.log(`Daarvan "documents-*"-achtig: ${documentSitemaps.length}`);
    subSitemaps.slice(0, 15).forEach((u) => console.log(`  ${u}`));

    if (documentSitemaps.length > 0) {
      const firstDocSitemap = documentSitemaps[0];
      section(`Eerste documents-sitemap onderzoeken: ${firstDocSitemap}`);
      try {
        const docRes = await fetchWithTimeout(firstDocSitemap, 15000);
        console.log(`HTTP status: ${docRes.status}`);
        if (docRes.ok) {
          const docXml = await docRes.text();
          console.log(`Response-grootte: ${docXml.length} tekens`);
          const urls = [...docXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
          const lastmods = [...docXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
          console.log(`Aantal <loc>-URL's: ${urls.length}`);
          console.log(`Aantal <lastmod>-datums: ${lastmods.length}`);
          urls.slice(0, 10).forEach((u, i) => console.log(`  ${u}${lastmods[i] ? ` (lastmod: ${lastmods[i]})` : ''}`));
        }
      } catch (err) {
        console.log(`Fout bij ophalen sub-sitemap: ${err.message}`);
      }
    }
  } else {
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log(`Aantal <loc>-URL's direct in deze sitemap: ${urls.length}`);
    urls.slice(0, 15).forEach((u) => console.log(`  ${u}`));
  }
}

async function main() {
  console.log(`Kenniscentrum-bronnenproef ronde 3 (tijdelijk, alleen KVK) — ${new Date().toISOString()}`);
  console.log('Dit script wijzigt niets, voegt geen content toe en commit niets.');
  console.log('Alleen publieke URL\'s, geen private/undocumented endpoints, geen omzeiling van toegangsbeperkingen.');

  await probeKvkOverzicht();
  await probeKvkSitemapPages();

  section('Einde proef');
}

main().catch((err) => {
  console.error('Onverwachte fout in de testproef:', err);
  process.exit(1);
});
