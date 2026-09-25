#!/usr/bin/env node
/**
 * Eenmalig diagnose-script: onderzoekt kandidaat-bronnen voor de
 * Kenniscentrum-uitbreiding (KVK, MKB-Nederland, NBA, FD, Gemeente Venray,
 * Rijksoverheid/Financiën) rechtstreeks vanaf een omgeving met echte
 * internettoegang (GitHub Actions), omdat de ontwikkelsandbox WebFetch/curl
 * blokkeert voor bijna alle externe domeinen.
 *
 * Voor elke kandidaat-pagina wordt (a) de ruwe HTML opgehaald en gescand op
 * <link rel="alternate" type="application/rss+xml|atom+xml"> — de officiële,
 * generieke manier waarop een site zelf een feed aankondigt (geen giswerk),
 * en (b) een lijst losse kandidaat-feed-URL's direct getest.
 *
 * Alleen voor onderzoek, niet voor productiegebruik — wordt na de diagnose
 * weer verwijderd.
 */

function extractFeedLinks(html) {
  const links = [];
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    const type = typeMatch?.[1] ?? '';
    if (!/rss|atom|xml/i.test(type) && !hrefMatch?.[1]?.match(/rss|feed|atom/i)) continue;
    links.push({ type, href: hrefMatch?.[1] ?? '(geen href)' });
  }
  return links;
}

const pagesToScanForFeedLinks = [
  { label: 'KVK overzicht', url: 'https://www.kvk.nl/overzicht/' },
  { label: 'MKB-Nederland nieuws', url: 'https://www.mkb.nl/artikelen/nieuws' },
  { label: 'MKB-Nederland /rss-2', url: 'https://www.mkb.nl/rss-2' },
  { label: 'NBA nieuws', url: 'https://www.nba.nl/nieuws/' },
  { label: 'Gemeente Venray nieuwsoverzicht', url: 'https://www.venray.nl/nieuwsoverzicht' },
  { label: 'FD economie', url: 'https://fd.nl/economie' },
];

const directFeedCandidates = [
  { label: 'KVK rss.xml', url: 'https://www.kvk.nl/rss.xml' },
  { label: 'KVK sitemap', url: 'https://www.kvk.nl/sitemap.xml' },
  { label: 'MKB-Nederland rss.xml', url: 'https://www.mkb.nl/rss.xml' },
  { label: 'MKB-Nederland feed', url: 'https://www.mkb.nl/feed' },
  { label: 'NBA sitemap', url: 'https://www.nba.nl/sitemap.xml' },
  { label: 'NBA rss', url: 'https://www.nba.nl/rss' },
  { label: 'NBA nieuws rss', url: 'https://www.nba.nl/nieuws/rss' },
  { label: 'FD economie ?rss=', url: 'https://fd.nl/economie?rss=' },
  { label: 'FD laatste-nieuws ?rss=', url: 'https://fd.nl/laatste-nieuws?rss=' },
  { label: 'FD root ?rss=', url: 'https://fd.nl/?rss=' },
  { label: 'Venray rss.xml', url: 'https://www.venray.nl/rss.xml' },
  { label: 'Venray sitemap', url: 'https://www.venray.nl/sitemap.xml' },
  { label: 'Venray nieuwsoverzicht rss', url: 'https://www.venray.nl/nieuwsoverzicht/rss' },
  { label: 'Rijksoverheid Financien nieuws rss (oud patroon, verwacht dood)', url: 'https://www.rijksoverheid.nl/ministeries/ministerie-van-financien/nieuws/rss' },
];

async function fetchText(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
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
  console.log(`Diagnose gestart (${new Date().toISOString()})`);

  console.log('\n\n########## FEED-AUTODISCOVERY (scan <link rel="alternate"> op echte pagina) ##########');
  for (const p of pagesToScanForFeedLinks) {
    const r = await fetchText(p.url);
    console.log(`\n=== ${p.label} ===`);
    console.log(`URL: ${p.url}`);
    if (r.error) {
      console.log(`FOUT: ${r.error}`);
      continue;
    }
    console.log(`Status: ${r.status} | Content-Type: ${r.contentType} | lengte: ${r.text.length}`);
    const feeds = extractFeedLinks(r.text);
    if (feeds.length === 0) {
      console.log('Geen <link rel="alternate" feed-achtig> gevonden.');
    } else {
      for (const f of feeds) console.log(`  FEED GEVONDEN: type="${f.type}" href="${f.href}"`);
    }
    // Ook: zoek platte "rss" tekst-links in de HTML als vangnet
    const plainRssLinks = [...r.text.matchAll(/href=["']([^"']*rss[^"']*)["']/gi)].map((m) => m[1]).slice(0, 5);
    if (plainRssLinks.length) console.log(`  Losse hrefs met "rss": ${JSON.stringify(plainRssLinks)}`);
  }

  console.log('\n\n########## DIRECTE KANDIDAAT-FEED-URL\'S ##########');
  for (const c of directFeedCandidates) {
    const r = await fetchText(c.url);
    console.log(`\n=== ${c.label} ===`);
    console.log(`URL: ${c.url}`);
    if (r.error) {
      console.log(`FOUT: ${r.error}`);
      continue;
    }
    console.log(`Status: ${r.status} | Content-Type: ${r.contentType} | lengte: ${r.text.length} | finale URL: ${r.finalUrl}`);
    console.log(`Eerste 300 tekens: ${r.text.slice(0, 300).replace(/\n/g, ' ')}`);
  }

  console.log('\nDiagnose klaar.');
}

main();
