// TIJDELIJK, READ-ONLY diagnosescript — gebruikt een echte, headless
// Chromium-browser (Playwright) om tijdens het laden van een gefilterde
// Rijksoverheid-nieuwspagina ALLE netwerkrequests vast te leggen, om de
// daadwerkelijke request te identificeren die de nieuwsartikelen
// ophaalt (nadat eerder is vastgesteld dat de server-HTML zelf geen
// artikelen bevat en de inhoud client-side via Next.js wordt geladen).
//
// Schrijft NOOIT naar src/content/kenniscentrum, publiceert niets,
// commit niets. Wordt na gebruik weer volledig verwijderd. Slaat nooit
// cookies/tokens/sessiegegevens op — alleen URL/method/status/content-
// type/headers-namen (geen cookie-waardes) en response-body-samples van
// kennelijk niet-sessiegebonden, puur data-leverende requests.

import { chromium } from 'playwright';

const TOPICS = [
  { key: 'belasting-betalen', url: 'https://www.rijksoverheid.nl/actueel/nieuws?size=n_10_n&filters[0][field]=topic&filters[0][values][0]=Belasting%20betalen&filters[0][type]=all' },
  { key: 'inkomstenbelasting', url: 'https://www.rijksoverheid.nl/actueel/nieuws?size=n_10_n&filters[0][field]=topic&filters[0][values][0]=Inkomstenbelasting&filters[0][type]=all' },
  { key: 'zzp', url: 'https://www.rijksoverheid.nl/actueel/nieuws?size=n_10_n&filters[0][field]=topic&filters[0][values][0]=Zelfstandigen%20zonder%20personeel%20(zzp)&filters[0][type]=all' },
];

// Headers waarvan de WAARDE nooit gelogd wordt (privacygevoelig) — de
// aanwezigheid van de header (naam) wordt wel gerapporteerd.
const SENSITIVE_HEADER_NAMES = new Set(['cookie', 'set-cookie', 'authorization', 'x-csrf-token']);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? '[AANWEZIG, WAARDE NIET GELOGD]' : v;
  }
  return out;
}

const KEYWORD_RE = /api|search|news|topic|content|elastic|query|results|graphql/i;

async function captureNetworkForUrl(page, url, label) {
  const captured = [];
  const listeners = [];

  const onRequest = (request) => {
    captured.push({
      phase: 'request',
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: sanitizeHeaders(request.headers()),
      postData: request.postData() ? request.postData().slice(0, 500) : null,
    });
  };
  const onResponse = async (response) => {
    const req = response.request();
    const entry = {
      phase: 'response',
      url: response.url(),
      method: req.method(),
      status: response.status(),
      responseHeaders: sanitizeHeaders(response.headers()),
    };
    const contentType = response.headers()['content-type'] ?? '';
    const looksInteresting = /json|graphql/i.test(contentType) || KEYWORD_RE.test(response.url());
    if (looksInteresting) {
      try {
        const bodyText = await response.text();
        entry.bodySample = bodyText.slice(0, 3000);
        entry.bodyLength = bodyText.length;
      } catch (err) {
        entry.bodyError = err.message;
      }
    }
    captured.push(entry);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  listeners.push(() => page.off('request', onRequest), () => page.off('response', onResponse));

  console.log(`\n--- NAVIGEREN: ${label} ---`);
  console.log(`  URL: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (err) {
    console.log(`  NAVIGATIE_TIMEOUT_OF_FOUT: ${err.message} (requests tot nu toe worden alsnog gerapporteerd)`);
  }
  // Extra wachttijd voor eventuele vertraagde client-side data-calls.
  await page.waitForTimeout(2000);

  for (const off of listeners) off();

  console.log(`  TOTAAL_NETWERKREQUESTS_GEZIEN: ${captured.filter((c) => c.phase === 'request').length}`);

  // Zichtbare artikelen op de gerenderde pagina (na JS-executie) —
  // daadwerkelijk DOM-onderzoek, geen aanname.
  let visibleArticleLinks = [];
  try {
    visibleArticleLinks = await page.$$eval('a[href*="/actueel/nieuws/"]', (as) => as.map((a) => a.getAttribute('href')));
  } catch (err) {
    console.log(`  DOM_QUERY_FOUT: ${err.message}`);
  }
  console.log(`  ZICHTBARE_ARTIKEL_LINKS_NA_JS (${visibleArticleLinks.length}): ${JSON.stringify([...new Set(visibleArticleLinks)].slice(0, 20))}`);

  for (const entry of captured) {
    if (entry.phase === 'response') {
      console.log(`CAPTURED_RESPONSE_JSON: ${JSON.stringify({ topic: label, ...entry })}`);
    }
  }

  // Zoek daadwerkelijk naar een "volgende"/"meer"-besturingselement in de
  // gerenderde DOM, i.p.v. een queryparameter te gokken.
  let paginationControl = null;
  try {
    const candidates = await page.$$eval('a, button', (els) =>
      els
        .map((el) => ({ text: (el.textContent || '').trim(), href: el.getAttribute('href') }))
        .filter((c) => /^volgende\b|^meer\b|laad meer|load more/i.test(c.text)),
    );
    if (candidates.length > 0) paginationControl = candidates[0];
  } catch (err) {
    console.log(`  PAGINATION_DOM_QUERY_FOUT: ${err.message}`);
  }
  console.log(`  PAGINATION_CONTROL_IN_DOM: ${JSON.stringify(paginationControl)}`);

  return { captured, visibleArticleLinks, paginationControl };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl) Mozilla/5.0' });

  const results = {};
  for (const topic of TOPICS) {
    results[topic.key] = await captureNetworkForUrl(page, topic.url, topic.key);
  }

  await browser.close();
  console.log('\n=== KLAAR ===');
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
