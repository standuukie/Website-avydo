#!/usr/bin/env node
// Ronde 3: robots.txt (canonieke sitemap-locatie), Venray-sitemap met browser-UA,
// MKB-Nederland definitieve feed-URL, Rijksoverheid-ministerie-attributie.
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

async function report(label, url, opts = {}) {
  const r = await fetchText(url, opts.headers);
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  if (r.error) { console.log(`FOUT: ${r.error}`); return r; }
  console.log(`Status: ${r.status} | Content-Type: ${r.contentType} | lengte: ${r.text.length}`);
  const n = opts.preview ?? 600;
  if (n > 0) console.log(`Inhoud: ${r.text.slice(0, n).replace(/\n/g, ' ')}`);
  return r;
}

async function main() {
  console.log(`Diagnose ronde 3 gestart (${new Date().toISOString()})`);

  console.log('\n\n########## ROBOTS.TXT (canonieke sitemap-locatie) ##########');
  for (const [name, host] of [
    ['KVK', 'https://www.kvk.nl'],
    ['MKB-Nederland', 'https://www.mkb.nl'],
    ['NBA', 'https://www.nba.nl'],
    ['Venray', 'https://www.venray.nl'],
    ['FD', 'https://fd.nl'],
  ]) {
    await report(`${name} robots.txt`, `${host}/robots.txt`, { preview: 1200 });
  }

  console.log('\n\n########## VENRAY MET BROWSER-UA ##########');
  await report('Venray sitemap.xml (browser-UA)', 'https://www.venray.nl/sitemap.xml', { preview: 800, headers: { 'User-Agent': BROWSER_UA } });
  await report('Venray rss.xml (browser-UA)', 'https://www.venray.nl/rss.xml', { preview: 400, headers: { 'User-Agent': BROWSER_UA } });

  console.log('\n\n########## MKB-NEDERLAND DEFINITIEVE FEED ##########');
  await report('MKB-Nederland /rss/nieuws-mkb-nederland', 'https://www.mkb.nl/rss/nieuws-mkb-nederland', { preview: 2000 });

  console.log('\n\n########## RIJKSOVERHEID: ministerie-attributie op artikelpagina ##########');
  const r1 = await fetchText('https://www.rijksoverheid.nl/actueel/nieuws/2026/09/11/kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven');
  if (r1.text) {
    const ministryLinks = [...r1.text.matchAll(/href="(\/ministeries\/[a-z0-9\-]+)"[^>]*>([^<]*)</gi)].map((m) => ({ href: m[1], text: m[2] }));
    console.log(`Ministerie-links op artikelpagina: ${JSON.stringify(ministryLinks.slice(0, 10))}`);
    const jsonLd = r1.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    console.log(`JSON-LD aanwezig: ${Boolean(jsonLd)}`);
    if (jsonLd) console.log(`JSON-LD (eerste 800 tekens): ${jsonLd[1].slice(0, 800)}`);
  }
  // Een bekend Financiën-artikel als extra check (Prinsjesdag/begroting is typisch Financiën)
  const r2 = await fetchText('https://www.rijksoverheid.nl/ministeries/ministerie-van-financien');
  if (r2.text) {
    console.log(`\nMinisterie van Financiën themapagina status: ${r2.status}, lengte: ${r2.text.length}`);
    const feedHint = [...r2.text.matchAll(/href="([^"]*rss[^"]*)"/gi)].map((m) => m[1]);
    console.log(`rss-hrefs op ministeriepagina: ${JSON.stringify(feedHint)}`);
  }

  console.log('\nDiagnose ronde 3 klaar.');
}

main();
