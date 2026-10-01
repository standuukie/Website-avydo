// TIJDELIJK, READ-ONLY diagnosescript — haalt uitsluitend de titel +
// meta-description op van de 30 al bekende, vastgestelde Rijksoverheid/
// Financien-URL's uit de vorige diagnose (geen nieuwe discovery, geen
// scoring, geen schrijfacties naar src/content). Wordt na gebruik weer
// verwijderd. Gebruikt de bestaande, ongewijzigde extractPageTitle/
// extractMetaDescription-functies uit fetch-articles.mjs.

import { extractPageTitle, extractMetaDescription } from './fetch-articles.mjs';
import { readFileSync } from 'node:fs';

const urls = JSON.parse(readFileSync(new URL('./diagnose-urls.json', import.meta.url)));

async function fetchContent(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    return {
      title: extractPageTitle(html),
      description: extractMetaDescription(html),
    };
  } catch (err) {
    return { error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  for (const item of urls) {
    const content = await fetchContent(item.url);
    console.log(`CONTENT_JSON: ${JSON.stringify({ title: item.title, url: item.url, ...content })}`);
  }
  console.log('=== KLAAR ===');
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
