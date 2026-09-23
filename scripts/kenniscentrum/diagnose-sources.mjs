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
  { label: 'feeds.rijksoverheid.nl/nieuws.rss (huidig geconfigureerd)', url: 'https://feeds.rijksoverheid.nl/nieuws.rss' },
  { label: 'feeds.rijksoverheid.nl/onderwerpen/belastingen-voor-ondernemers/nieuws.rss (huidig)', url: 'https://feeds.rijksoverheid.nl/onderwerpen/belastingen-voor-ondernemers/nieuws.rss' },
  { label: 'www.rijksoverheid.nl/service/rss', url: 'https://www.rijksoverheid.nl/service/rss' },
  { label: 'www.rijksoverheid.nl/rss.xml', url: 'https://www.rijksoverheid.nl/rss.xml' },
  { label: 'www.rijksoverheid.nl/actueel/nieuws/rss', url: 'https://www.rijksoverheid.nl/actueel/nieuws/rss' },
  { label: 'www.rijksoverheid.nl/actueel.rss', url: 'https://www.rijksoverheid.nl/actueel.rss' },
  { label: 'www.rijksoverheid.nl/sitemap.xml', url: 'https://www.rijksoverheid.nl/sitemap.xml' },
  { label: 'persberichten.rijksoverheid.nl/service/rss', url: 'https://persberichten.rijksoverheid.nl/service/rss' },
  { label: 'persberichten.rijksoverheid.nl/rss', url: 'https://persberichten.rijksoverheid.nl/rss' },
  { label: 'persberichten.rijksoverheid.nl/rss.xml', url: 'https://persberichten.rijksoverheid.nl/rss.xml' },
  { label: 'De testcase-URL zelf (mag NOOIT hardcoded in productiecode, alleen ter controle of de pagina live is)', url: 'https://www.rijksoverheid.nl/actueel/nieuws/2026/09/11/kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven' },
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
    console.log(`Eerste 400 tekens:\n${text.slice(0, 400).replace(/\n/g, ' ')}`);
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
