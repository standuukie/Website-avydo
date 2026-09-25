#!/usr/bin/env node
// Tijdelijk onderzoeksscript (draait alleen via GitHub Actions, waar wél
// echte internettoegang is): haalt de tekst op van specifieke, al via
// sitemapdiscovery bevestigde officiële Belastingdienst-pagina's over
// aangifte- en betaaltermijnen, zodat de deadlines voor de Belastingkalender
// handmatig geverifieerd en met bronverwijzing overgenomen kunnen worden.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

const URLS = [
  'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/uiterste-aangifte-en-betaaldatums',
  'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/wijziging-aangiftetijdvak-btw',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/aangifte-loonheffingen-tijdvakcodes-aangifte-en-betaaldatums',
  'https://www.belastingdienst.nl/wps/wcm/connect/nl/personeel-en-loon/content/loonaangifte-aangifte-loonheffingen',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/aangifte-vennootschapsbelasting-doen/aangifte-vennootschapsbelasting-doen',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/uitstel_aangifte_vennootschapsbelasting/uitstel_aangifte_vennootschapsbelasting',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/betaalinformatie-vennootschapsbelasting/betaalinformatie-vennootschapsbelasting',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/als_u_dividend_uitkeert/dividendbelasting-aangifte-betalen',
  'https://www.belastingdienst.nl/wps/wcm/connect/nl/belastingaangifte/content/hoe-aangifte-inkomstenbelasting-doen',
  'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/internationaal/btw_voor_buitenlandse_ondernemers/btw_aangifte_doen_en_betalen/aangifte_doen/opgaaf_icp/opgaaf_intracommunautaire_prestaties',
  'https://www.belastingdienst.nl/wps/wcm/connect/nl/voorlopige-aanslag/content/vanaf-wanneer-een-voorlopige-aanslag-aanvragen-of-wijzigen',
];

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
    .replace(/<[^>]*>/g, ' \n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function main() {
  for (const url of URLS) {
    const html = await fetchText(url);
    console.log(`\n\n########## ${url} ##########`);
    if (!html) {
      console.log('(niet opgehaald)');
      continue;
    }
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    console.log(`TITLE: ${titleMatch?.[1] ?? '(geen titel)'}`);
    const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i);
    console.log(`CANONICAL: ${canonicalMatch?.[1] ?? '(geen canonical)'}`);
    const text = stripHtml(html);
    console.log(text.slice(0, 6000));
  }
}

main().catch((err) => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
