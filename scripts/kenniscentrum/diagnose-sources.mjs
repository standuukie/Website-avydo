#!/usr/bin/env node
// Ronde 2: verdiepend onderzoek op basis van ronde 1.
function extractFeedLinks(html) {
  const links = [];
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    links.push({ type: typeMatch?.[1] ?? '', href: hrefMatch?.[1] ?? '' });
  }
  return links;
}

async function fetchText(url, extraHeaders = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)',
        ...extraHeaders,
      },
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    return { ok: res.ok, status: res.status, contentType, text, finalUrl: res.url };
  } catch (err) {
    return { ok: false, error: `${err.name}: ${err.message}` };
  }
}

async function report(label, url, opts = {}) {
  const r = await fetchText(url, opts.headers);
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  if (r.error) { console.log(`FOUT: ${r.error}`); return r; }
  console.log(`Status: ${r.status} | Content-Type: ${r.contentType} | lengte: ${r.text.length}`);
  const n = opts.preview ?? 500;
  console.log(`Eerste ${n} tekens: ${r.text.slice(0, n).replace(/\n/g, ' ')}`);
  if (opts.allRssHrefs) {
    const hrefs = [...r.text.matchAll(/href=["']([^"']*rss[^"']*)["']/gi)].map((m) => m[1]);
    console.log(`ALLE hrefs met "rss" (${hrefs.length}): ${JSON.stringify([...new Set(hrefs)])}`);
  }
  if (opts.checkFeedLinks) {
    const feeds = extractFeedLinks(r.text);
    console.log(`<link rel=alternate>: ${JSON.stringify(feeds)}`);
  }
  if (opts.countLoc) {
    console.log(`Aantal <loc>: ${(r.text.match(/<loc>/g) || []).length}`);
  }
  return r;
}

async function main() {
  console.log(`Diagnose ronde 2 gestart (${new Date().toISOString()})`);

  // --- FD: volledige copyright/terms + item-structuur (full text of alleen samenvatting?) ---
  await report('FD laatste-nieuws RSS - volledige inhoud', 'https://fd.nl/laatste-nieuws?rss=', { preview: 3500 });

  // --- MKB-Nederland: alle rss-hrefs op de /rss-2 pagina, en directe kandidaten ---
  await report('MKB-Nederland /rss-2 (alle rss-links)', 'https://www.mkb.nl/rss-2', { preview: 0, allRssHrefs: true });
  await report('MKB-Nederland /rss/nieuws', 'https://www.mkb.nl/rss/nieuws', { preview: 400 });
  await report('MKB-Nederland /rss/artikelen', 'https://www.mkb.nl/rss/artikelen', { preview: 400 });

  // --- NBA: sitemap nieuws-paden + kijk of er een aparte nieuws-sitemap/index is ---
  const nbaSitemap = await fetchText('https://www.nba.nl/sitemap.xml');
  if (nbaSitemap.text) {
    const newsUrls = [...nbaSitemap.text.matchAll(/<loc>([^<]*\/nieuws\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    console.log(`\n=== NBA sitemap: URLs onder /nieuws/ ===`);
    console.log(`Aantal: ${newsUrls.length}`);
    console.log(`Eerste 10: ${JSON.stringify(newsUrls.slice(0, 10))}`);
    const sitemapIndexHint = nbaSitemap.text.includes('<sitemapindex');
    console.log(`Is sitemapindex (verwijst naar sub-sitemaps): ${sitemapIndexHint}`);
  }
  await report('NBA nieuws-artikel pagina (check meta description + evt. json-ld date)', 'https://www.nba.nl/nieuws/2025/november/nba-luidt-noodklok-over-dreigende-oncontroleerbaarheid-financiele-verantwoording-zorgsector/', { preview: 0, checkFeedLinks: false });

  // --- KVK: WordPress-stijl en andere patronen, en JSON API hint uit Next.js data ---
  await report('KVK /?feed=rss2 (WordPress-patroon)', 'https://www.kvk.nl/?feed=rss2', { preview: 300 });
  await report('KVK /overzicht/?feed=rss2', 'https://www.kvk.nl/overzicht/?feed=rss2', { preview: 300 });
  await report('KVK /nieuws (los pad, check of dit anders is dan /overzicht)', 'https://www.kvk.nl/nieuws/', { preview: 300, checkFeedLinks: true });
  const kvkOverzicht = await fetchText('https://www.kvk.nl/overzicht/');
  if (kvkOverzicht.text) {
    const nextData = kvkOverzicht.text.match(/"buildId":"([^"]+)"/);
    console.log(`\n=== KVK Next.js buildId (voor evt. JSON-endpoint) ===`);
    console.log(buildIdInfo(nextData));
    const apiHints = [...kvkOverzicht.text.matchAll(/"(\/[a-z0-9\-_/]*api[a-z0-9\-_/]*)"/gi)].map((m) => m[1]).slice(0, 10);
    console.log(`API-achtige paden in HTML: ${JSON.stringify([...new Set(apiHints)])}`);
  }
  function buildIdInfo(m) { return m ? m[1] : '(niet gevonden)'; }

  // --- Gemeente Venray: andere User-Agent proberen (403 kan bot-blocking zijn) ---
  await report('Venray nieuwsoverzicht met browser-UA', 'https://www.venray.nl/nieuwsoverzicht', {
    preview: 500,
    checkFeedLinks: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  await report('Venray root met browser-UA', 'https://www.venray.nl/', {
    preview: 300,
    checkFeedLinks: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
  });

  console.log('\nDiagnose ronde 2 klaar.');
}

main();
