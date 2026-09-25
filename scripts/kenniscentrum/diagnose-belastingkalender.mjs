#!/usr/bin/env node
// Tijdelijk onderzoeksscript (draait alleen via GitHub Actions, waar wél
// echte internettoegang is) om officiële Belastingdienst/Rijksoverheid-
// pagina's over aangifte- en betaaltermijnen te vinden en hun tekst te
// printen, zodat deadlines voor de Belastingkalender handmatig geverifieerd
// en met een bronverwijzing overgenomen kunnen worden. Nooit fabricage:
// dit script raadt geen URL's, het ontdekt ze via robots.txt -> sitemap.
import { XMLParser } from 'fast-xml-parser';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

async function fetchText(url, headers = UA) {
  const res = await fetch(url, { headers });
  console.log(`GET ${url} -> ${res.status}`);
  if (!res.ok) return null;
  return res.text();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('=== 1. robots.txt van belastingdienst.nl ===');
  const robots = await fetchText('https://www.belastingdienst.nl/robots.txt');
  console.log(robots ?? '(niet opgehaald)');

  const sitemapUrls = [...(robots ?? '').matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  console.log('\nGevonden sitemap-URLs:', sitemapUrls);

  const keywords = [
    'btw', 'loonheffing', 'vennootschapsbelasting', 'inkomstenbelasting',
    'dividendbelasting', 'icp', 'aangiftetijdvak', 'aangifte-en-betaaltermijn',
    'kalender', 'aangiftetermijn', 'betaaltermijn', 'voorlopige-aanslag',
  ];

  const parser = new XMLParser({ ignoreAttributes: false });
  const candidateUrls = new Set();

  for (const sitemapUrl of sitemapUrls) {
    console.log(`\n=== Sitemap: ${sitemapUrl} ===`);
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    let doc;
    try {
      doc = parser.parse(xml);
    } catch (err) {
      console.log('Kon sitemap niet parsen:', err.message);
      continue;
    }
    // Kan een sitemapindex zijn (verwijst naar sub-sitemaps) of een urlset.
    const subSitemaps = doc?.sitemapindex?.sitemap;
    if (subSitemaps) {
      const arr = Array.isArray(subSitemaps) ? subSitemaps : [subSitemaps];
      console.log(`Dit is een sitemap-index met ${arr.length} sub-sitemap(s).`);
      for (const s of arr) {
        const loc = typeof s.loc === 'string' ? s.loc : s.loc?.['#text'];
        if (loc && /zakelijk|ondernemer|btw|loonheffing|winst|belasting/i.test(loc)) {
          console.log(`  Relevante sub-sitemap: ${loc}`);
          const subXml = await fetchText(loc);
          if (!subXml) continue;
          try {
            const subDoc = parser.parse(subXml);
            const urls = subDoc?.urlset?.url;
            const urlArr = Array.isArray(urls) ? urls : urls ? [urls] : [];
            for (const u of urlArr) {
              const uloc = typeof u.loc === 'string' ? u.loc : u.loc?.['#text'];
              if (uloc && keywords.some((kw) => uloc.toLowerCase().includes(kw))) {
                candidateUrls.add(uloc);
              }
            }
          } catch (err) {
            console.log(`  Kon sub-sitemap niet parsen: ${err.message}`);
          }
        }
      }
      continue;
    }

    const urls = doc?.urlset?.url;
    const urlArr = Array.isArray(urls) ? urls : urls ? [urls] : [];
    console.log(`Dit is een urlset met ${urlArr.length} URL('s).`);
    for (const u of urlArr) {
      const uloc = typeof u.loc === 'string' ? u.loc : u.loc?.['#text'];
      if (uloc && keywords.some((kw) => uloc.toLowerCase().includes(kw))) {
        candidateUrls.add(uloc);
      }
    }
  }

  console.log(`\n=== Kandidaat-URL's (${candidateUrls.size}) ===`);
  for (const url of candidateUrls) console.log(url);

  console.log('\n=== 2. Directe navigatie: zakelijk-index en subpagina-links ===');
  const zakelijkHtml = await fetchText('https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/');
  if (zakelijkHtml) {
    const hrefs = [...zakelijkHtml.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((h) => keywords.some((kw) => h.toLowerCase().includes(kw)));
    console.log('Relevante links op zakelijk-index:', [...new Set(hrefs)]);
  }

  console.log('\n=== 3. Tekst van kandidaat-pagina\'s (top 15) ===');
  let count = 0;
  for (const url of candidateUrls) {
    if (count >= 15) break;
    count += 1;
    const html = await fetchText(url);
    if (!html) continue;
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    console.log(`\n--- ${url} ---`);
    console.log(`TITLE: ${titleMatch?.[1] ?? '(geen titel)'}`);
    const text = stripHtml(html);
    console.log(text.slice(0, 3000));
  }
}

main().catch((err) => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
