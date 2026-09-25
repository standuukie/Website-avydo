#!/usr/bin/env node
// Tijdelijk onderzoeksscript (GitHub Actions only): haalt de echte PDF-href
// van de loonheffingen-brochurepagina op, downloadt de PDF, en print de
// tekst (via pdf-parse) zodat de exacte, officiële aangifte- en
// betaaldatums voor loonheffingen 2026 geverifieerd kunnen worden — net
// zoals al gelukt is voor btw via de HTML-tabel.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

async function main() {
  const pageUrl = 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/aangifte-loonheffingen-tijdvakcodes-aangifte-en-betaaldatums';
  const res = await fetch(pageUrl, { headers: UA });
  console.log(`GET ${pageUrl} -> ${res.status}`);
  const html = await res.text();

  const hrefs = [...html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)].map((m) => m[1]);
  console.log('Gevonden PDF-links:', hrefs);

  const pdf2026 = hrefs.find((h) => /2026/.test(h)) ?? hrefs[0];
  if (!pdf2026) {
    console.log('Geen PDF-link gevonden.');
    return;
  }
  const pdfUrl = new URL(pdf2026, pageUrl).toString();
  console.log(`\nDownload PDF: ${pdfUrl}`);

  const pdfRes = await fetch(pdfUrl, { headers: UA });
  console.log(`GET ${pdfUrl} -> ${pdfRes.status} (${pdfRes.headers.get('content-type')})`);
  if (!pdfRes.ok) return;
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  console.log(`PDF-grootte: ${buf.length} bytes`);

  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    console.log('pdf-parse niet geïnstalleerd, sla tekstextractie over.');
    return;
  }
  const data = await pdfParse(buf);
  console.log('\n===== PDF-TEKST =====');
  console.log(data.text);
}

main().catch((err) => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
