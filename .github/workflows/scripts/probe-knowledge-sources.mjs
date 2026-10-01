#!/usr/bin/env node
/**
 * TIJDELIJK diagnose-script, hoort bij .github/workflows/test-knowledge-sources.yml.
 * Geen onderdeel van de productie-Kenniscentrum-pipeline (scripts/kenniscentrum/).
 *
 * Ronde 2: FD is komen te vervallen (geen commerciële licentie — zie het
 * Kenniscentrum-auditrapport). Dit script onderzoekt nu uitsluitend de
 * daadwerkelijke, ruwe structuur van de publieke KVK-overzichtspagina, zodat
 * de productie-parsing (fetch-articles.mjs) op een geverifieerde, echte
 * structuur gebaseerd kan worden in plaats van op aannames.
 *
 * Haalt alleen de publieke pagina op zoals een gewone browser dat zou doen.
 * Schrijft niets weg, wijzigt niets, commit niets.
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const KVK_OVERZICHT_URL = 'https://www.kvk.nl/overzicht/';
const KVK_SITEMAP_INDEX_URL = 'https://www.kvk.nl/sitemap_index.xml';

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

// Zoekt recursief naar het eerste array van objecten dat "artikelachtig" is:
// elk object heeft minstens één titel-achtig en één url-achtig veld.
// Geeft het pad (voor leesbaarheid) en het array zelf terug.
function findArticleLikeArrays(node, path = '$', results = [], depth = 0) {
  if (depth > 12 || results.length >= 5) return results;
  if (Array.isArray(node)) {
    if (node.length >= 2 && node.every((el) => el && typeof el === 'object' && !Array.isArray(el))) {
      const sample = node[0];
      const keys = Object.keys(sample).map((k) => k.toLowerCase());
      const hasTitleLike = keys.some((k) => /title|titel|heading|name|naam/.test(k));
      const hasUrlLike = keys.some((k) => /url|link|href|slug|path/.test(k));
      if (hasTitleLike && hasUrlLike) {
        results.push({ path, length: node.length, sampleKeys: Object.keys(sample) });
      }
    }
    node.forEach((el, i) => findArticleLikeArrays(el, `${path}[${i}]`, results, depth + 1));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      findArticleLikeArrays(value, `${path}.${key}`, results, depth + 1);
    }
  }
  return results;
}

function getByPath(root, path) {
  // path als "$.a.b[0].c" — simpele evaluator, alleen voor deze diagnose.
  const parts = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\d+\]/g) || [];
  let cur = root;
  for (const part of parts) {
    if (/^\[\d+\]$/.test(part)) {
      cur = cur?.[Number(part.slice(1, -1))];
    } else {
      cur = cur?.[part];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

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
  console.log(`Content-Type: ${res.headers.get('content-type') ?? '(geen header)'}`);
  if (!res.ok) {
    console.log('Response niet OK — geen verdere analyse.');
    return;
  }

  const html = await res.text();
  console.log(`Response-grootte: ${html.length} tekens`);

  // --- __NEXT_DATA__ extractie ---
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    console.log('\nGeen <script id="__NEXT_DATA__"> gevonden met het standaardpatroon.');
    // Val terug op een ruimere zoekopdracht naar elk application/json-blok.
    const anyJsonBlocks = [...html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    console.log(`Generieke <script type="application/json">-blocks gevonden: ${anyJsonBlocks.length}`);
    anyJsonBlocks.forEach((m, i) => {
      console.log(`\n--- JSON-block ${i + 1} (eerste 500 tekens) ---`);
      console.log(m[1].slice(0, 500));
    });
    return;
  }

  console.log(`\n__NEXT_DATA__ gevonden, lengte: ${nextDataMatch[1].length} tekens`);
  let data;
  try {
    data = JSON.parse(nextDataMatch[1]);
  } catch (err) {
    console.log(`Kon __NEXT_DATA__ niet als JSON parsen: ${err.message}`);
    console.log('Eerste 1000 tekens van de ruwe inhoud:');
    console.log(nextDataMatch[1].slice(0, 1000));
    return;
  }

  console.log('Top-level sleutels in __NEXT_DATA__:', Object.keys(data));
  const pageProps = data.props?.pageProps;
  if (pageProps) {
    console.log('Sleutels in props.pageProps:', Object.keys(pageProps));
  }

  const candidates = findArticleLikeArrays(data);
  console.log(`\nArray(s) die op een artikelenlijst lijken (titel+url-achtige velden): ${candidates.length}`);
  candidates.forEach((c, i) => {
    console.log(`\n[${i + 1}] pad: ${c.path}, lengte: ${c.length}, sample-sleutels: ${JSON.stringify(c.sampleKeys)}`);
  });

  if (candidates.length > 0) {
    const best = candidates[0];
    const arr = getByPath(data, best.path);
    console.log(`\n--- Volledige eerste 3 items van kandidaat [1] (${best.path}) ---`);
    console.log(JSON.stringify(arr.slice(0, 3), null, 2).slice(0, 4000));
  } else {
    console.log('\nGeen duidelijke artikel-array gevonden. Dump van props.pageProps (eerste 3000 tekens) voor handmatige inspectie:');
    console.log(JSON.stringify(pageProps, null, 2)?.slice(0, 3000) ?? '(pageProps leeg of niet aanwezig)');
  }
}

async function probeKvkSitemapIndex() {
  section(`KVK — sitemap_index.xml — ${KVK_SITEMAP_INDEX_URL}`);
  let res;
  try {
    res = await fetchWithTimeout(KVK_SITEMAP_INDEX_URL, 15000);
  } catch (err) {
    console.log(`Fout bij ophalen: ${err.message}`);
    return;
  }
  console.log(`HTTP status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type') ?? '(geen header)'}`);
  if (!res.ok) return;
  const xml = await res.text();
  console.log(`Response-grootte: ${xml.length} tekens`);
  const sitemapRefs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`Aantal <loc>-verwijzingen in de index: ${sitemapRefs.length}`);
  const overzichtRelevant = sitemapRefs.filter((u) => /overzicht|nieuws|artikel|blog|content/i.test(u));
  console.log(`Daarvan mogelijk relevant voor artikelen/overzicht-content: ${overzichtRelevant.length}`);
  overzichtRelevant.slice(0, 15).forEach((u) => console.log(`  ${u}`));
  if (overzichtRelevant.length === 0) {
    console.log('Eerste 15 verwijzingen (ter oriëntatie):');
    sitemapRefs.slice(0, 15).forEach((u) => console.log(`  ${u}`));
  }
}

async function main() {
  console.log(`Kenniscentrum-bronnenproef ronde 2 (tijdelijk, alleen KVK) — ${new Date().toISOString()}`);
  console.log('Dit script wijzigt niets, voegt geen content toe en commit niets.');
  console.log('FD is komen te vervallen (geen commerciële licentie) en wordt hier niet meer getest.');

  await probeKvkOverzicht();
  await probeKvkSitemapIndex();

  section('Einde proef');
}

main().catch((err) => {
  console.error('Onverwachte fout in de testproef:', err);
  process.exit(1);
});
