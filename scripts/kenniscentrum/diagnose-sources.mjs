#!/usr/bin/env node
// Ronde 5: ruwe HTML-structuur van KVK /overzicht/ en Venray /nieuwsoverzicht
// controleren op een betrouwbaar, server-gerenderd linkpatroon (laatste check
// voordat wordt besloten of HTML-parsing als laatste redmiddel haalbaar is).
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function fetchText(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, {
    signal: controller.signal,
    redirect: 'follow',
    headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)', ...extraHeaders },
  });
  clearTimeout(timer);
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  console.log(`Diagnose ronde 5 gestart (${new Date().toISOString()})`);

  console.log('\n\n########## KVK /overzicht/ ##########');
  const kvk = await fetchText('https://www.kvk.nl/overzicht/');
  console.log(`Status: ${kvk.status} | lengte: ${kvk.text.length}`);
  const kvkNextData = kvk.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  console.log(`__NEXT_DATA__ aanwezig: ${Boolean(kvkNextData)}`);
  if (kvkNextData) console.log(`__NEXT_DATA__ eerste 2000 tekens: ${kvkNextData[1].slice(0, 2000)}`);
  const kvkOverzichtLinks = [...kvk.text.matchAll(/href="(\/overzicht\/[^"?#]+)"/gi)].map((m) => m[1]);
  console.log(`hrefs onder /overzicht/: ${JSON.stringify([...new Set(kvkOverzichtLinks)].slice(0, 20))}`);

  console.log('\n\n########## VENRAY /nieuwsoverzicht ##########');
  const venray = await fetchText('https://www.venray.nl/nieuwsoverzicht', { headers: { 'User-Agent': BROWSER_UA } });
  console.log(`Status: ${venray.status} | lengte: ${venray.text.length}`);
  // Zoek alle scripts met type application/json (App Router RSC payload of vergelijkbaar)
  const jsonScripts = [...venray.text.matchAll(/<script[^>]+type="application\/json"[^>]*id="([^"]*)"[^>]*>/gi)].map((m) => m[1]);
  console.log(`JSON script-ids: ${JSON.stringify(jsonScripts)}`);
  // Zoek herkenbare artikel-tegels: vaak <a href="/slug" ...>...titel...</a> binnen een lijst/grid
  const bodyStart = venray.text.indexOf('<body');
  const bodySample = venray.text.slice(bodyStart, bodyStart + 4000);
  console.log(`\nBody-sample (eerste 4000 tekens na <body>):\n${bodySample}`);

  console.log('\nDiagnose ronde 5 klaar.');
}

main();
