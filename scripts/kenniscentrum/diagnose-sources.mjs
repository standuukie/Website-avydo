#!/usr/bin/env node
// Ronde 4: KVK sitemap_index.xml doorzoeken, Venray news/sitemap.xml-hypothese
// (zelfde platform als rijksoverheid.nl?) + __NEXT_DATA__, NBA /nieuws/ ruwe HTML.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function fetchText(url, extraHeaders = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)', ...extraHeaders },
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    return { ok: res.ok, status: res.status, contentType, text, finalUrl: res.url };
  } catch (err) {
    return { ok: false, error: `${err.name}: ${err.message}` };
  }
}

async function main() {
  console.log(`Diagnose ronde 4 gestart (${new Date().toISOString()})`);

  console.log('\n\n########## KVK sitemap_index.xml ##########');
  const kvkIdx = await fetchText('https://www.kvk.nl/sitemap_index.xml');
  console.log(`Status: ${kvkIdx.status} | lengte: ${kvkIdx.text?.length}`);
  if (kvkIdx.text) {
    const locs = [...kvkIdx.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log(`Aantal sub-sitemaps: ${locs.length}`);
    console.log(JSON.stringify(locs, null, 1));
  }

  console.log('\n\n########## VENRAY: news/sitemap.xml hypothese + __NEXT_DATA__ ##########');
  const venrayNews = await fetchText('https://www.venray.nl/news/sitemap.xml', { headers: { 'User-Agent': BROWSER_UA } });
  console.log(`\nVenray news/sitemap.xml status: ${venrayNews.status} | Content-Type: ${venrayNews.contentType} | lengte: ${venrayNews.text?.length}`);
  console.log(`Inhoud (600): ${(venrayNews.text || '').slice(0, 600).replace(/\n/g, ' ')}`);

  const venrayPage = await fetchText('https://www.venray.nl/nieuwsoverzicht', { headers: { 'User-Agent': BROWSER_UA } });
  if (venrayPage.text) {
    const nextDataMatch = venrayPage.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    console.log(`\n__NEXT_DATA__ gevonden op nieuwsoverzicht: ${Boolean(nextDataMatch)}`);
    if (nextDataMatch) {
      console.log(`Lengte JSON: ${nextDataMatch[1].length}`);
      console.log(`Eerste 1500 tekens: ${nextDataMatch[1].slice(0, 1500)}`);
    }
  }

  console.log('\n\n########## NBA /nieuws/ ruwe HTML (structuur van artikel-links) ##########');
  const nbaPage = await fetchText('https://www.nba.nl/nieuws/');
  if (nbaPage.text) {
    console.log(`Status: ${nbaPage.status} | lengte: ${nbaPage.text.length}`);
    // Zoek links die naar individuele nieuwsartikelen lijken te wijzen
    const articleLinks = [...nbaPage.text.matchAll(/<a[^>]+href="(\/nieuws\/[^"]+)"[^>]*>/gi)].map((m) => m[1]);
    console.log(`Artikel-links gevonden: ${articleLinks.length}`);
    console.log(JSON.stringify([...new Set(articleLinks)].slice(0, 15), null, 1));
    // Fragment rond de eerste paar links tonen voor structuurinzicht
    const firstIdx = nbaPage.text.indexOf('/nieuws/20');
    console.log(`\nContext rond eerste artikel-link:\n${nbaPage.text.slice(Math.max(0, firstIdx - 300), firstIdx + 500)}`);
  }

  console.log('\nDiagnose ronde 4 klaar.');
}

main();
