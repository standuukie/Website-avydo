#!/usr/bin/env node
/**
 * Eenmalig diagnose-script: test een reeks kandidaat-URL's voor de
 * Rijksoverheid-nieuwsbron (RSS, sitemap) rechtstreeks vanaf een omgeving
 * met echte internettoegang (GitHub Actions), zodat we empirisch kunnen
 * vaststellen welk endpoint nu daadwerkelijk werkt na de platformmigratie
 * van rijksoverheid.nl (juni 2026). Alleen voor onderzoek, niet voor
 * productiegebruik — wordt na de fix weer verwijderd.
 */
const candidates = [
  { label: 'www.rijksoverheid.nl/news/sitemap.xml (kandidaat, gevonden via sitemapindex)', url: 'https://www.rijksoverheid.nl/news/sitemap.xml', preview: 4000 },
];

async function check(c) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(c.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    console.log(`\n=== ${c.label} ===`);
    console.log(`URL: ${c.url}`);
    console.log(`Status: ${res.status} ${res.statusText} | redirected: ${res.redirected} | finale URL: ${res.url}`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Lengte: ${text.length} tekens`);
    const preview = c.preview || 400;
    console.log(`Eerste ${preview} tekens:\n${text.slice(0, preview).replace(/\n/g, ' ')}`);
    console.log(`Bevat "e-facturatie": ${text.includes('e-facturatie')}`);
    console.log(`Bevat "2026/09/11": ${text.includes('2026/09/11')}`);
    const urlCount = (text.match(/<loc>/g) || []).length;
    console.log(`Aantal <loc> entries: ${urlCount}`);
  } catch (err) {
    console.log(`\n=== ${c.label} ===`);
    console.log(`URL: ${c.url}`);
    console.log(`FOUT: ${err.name}: ${err.message}`);
  }
}

async function main() {
  console.log(`Diagnose gestart (${new Date().toISOString()})`);
  for (const c of candidates) {
    await check(c);
  }
  console.log('\nDiagnose klaar.');
}

main();
