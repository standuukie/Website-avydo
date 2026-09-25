#!/usr/bin/env node
// Tijdelijk onderzoeksscript (GitHub Actions only). Ronde 4:
// 1) PDF-tekst van de loonheffingen-brochure (tijdvakcodes/aangifte/
//    betaaldatums 2026) extraheren.
// 2) Opnieuw de officiële sitemap doorzoeken, nu met bredere trefwoorden,
//    om de exacte pagina met de aangiftetermijn (1 mei) voor de
//    inkomstenbelasting te vinden — nooit een URL raden.
import { createRequire } from 'node:module';
import { XMLParser } from 'fast-xml-parser';
const require = createRequire(import.meta.url);

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

async function fetchText(url, headers = UA) {
  const res = await fetch(url, { headers });
  console.log(`GET ${url} -> ${res.status}`);
  if (!res.ok) return null;
  return res.text();
}

async function part1PdfText() {
  console.log('\n===== DEEL 1: loonheffingen-PDF =====');
  const pageUrl = 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/aangifte-loonheffingen-tijdvakcodes-aangifte-en-betaaldatums';
  const html = await fetchText(pageUrl);
  if (!html) return;
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)].map((m) => m[1]);
  const pdf2026 = hrefs.find((h) => /2026/i.test(h) || !/lh2101t51fd/i.test(h)) ?? hrefs[0];
  if (!pdf2026) { console.log('Geen PDF-link gevonden.'); return; }
  const pdfUrl = new URL(pdf2026, pageUrl).toString();
  const pdfRes = await fetch(pdfUrl, { headers: UA });
  console.log(`GET ${pdfUrl} -> ${pdfRes.status} (${pdfRes.headers.get('content-type')})`);
  if (!pdfRes.ok) return;
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  console.log(`PDF-grootte: ${buf.length} bytes`);

  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    console.log('\n===== PDF-TEKST =====');
    console.log(result.text);
  } catch (err) {
    console.log('PDF-tekstextractie mislukt:', err.message);
  }
}

async function part2FindIbDeadline() {
  console.log('\n\n===== DEEL 2: sitemap opnieuw doorzoeken voor IB-aangiftetermijn =====');
  const robots = await fetchText('https://www.belastingdienst.nl/robots.txt');
  const sitemapUrls = [...(robots ?? '').matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);

  const keywords = [
    '1-mei', 'aangiftetermijn', 'uitstel-aangifte-inkomstenbelasting',
    'verlengen-aangiftetermijn', 'te-laat-met-aangifte', 'boete-te-laat',
    'wanneer-moet-ik-aangifte', 'aangifte-inkomstenbelasting-doen-voor',
    'uiterste-datum', 'aangifte-inkomstenbelasting-2025',
  ];

  const parser = new XMLParser({ ignoreAttributes: false });
  const candidateUrls = new Set();

  for (const sitemapUrl of sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    let doc;
    try { doc = parser.parse(xml); } catch { continue; }
    const urls = doc?.urlset?.url;
    const urlArr = Array.isArray(urls) ? urls : urls ? [urls] : [];
    for (const u of urlArr) {
      const uloc = typeof u.loc === 'string' ? u.loc : u.loc?.['#text'];
      if (uloc && keywords.some((kw) => uloc.toLowerCase().includes(kw))) {
        candidateUrls.add(uloc);
      }
    }
  }

  console.log(`Kandidaten (${candidateUrls.size}):`);
  for (const u of candidateUrls) console.log(u);

  let count = 0;
  for (const url of candidateUrls) {
    if (count >= 8) break;
    count += 1;
    const html = await fetchText(url);
    if (!html) continue;
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    console.log(`\n--- ${url} ---`);
    console.log(`TITLE: ${titleMatch?.[1] ?? '(geen titel)'}`);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' \n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    console.log(text.slice(0, 3000));
  }
}

async function main() {
  try {
    await part1PdfText();
  } catch (err) {
    console.log('Deel 1 (PDF) mislukt:', err.message);
  }
  await part2FindIbDeadline();
}

main().catch((err) => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
