// Hoofdtekst-extractie voor Rijksoverheid-nieuwsberichten
// (extractRijksoverheidArticleBody in fetch-articles.mjs) en de dry-run-
// backfill (backfill-rijksoverheid-body.mjs).
//
// Fixtures: ruwe rijksoverheid.nl-HTML was vanuit de ontwikkelomgeving niet
// bereikbaar. De HTML hieronder is daarom representatief opgebouwd volgens
// de structuur die een read-only audit op 176 echte nieuwsberichten
// (opgehaald vanaf de GitHub-runner, 2026-10-06) op tekstniveau vaststelde:
// skiplink + navigatie + zoekveld, titel, "Nieuwsbericht DD-MM-JJJJ | UU:MM",
// hoofdtekst, optioneel blok "Documenten", "Heeft deze informatie u
// geholpen? Ja Nee", "Meer over dit onderwerp", "Hoort bij", vaste footer
// ("... Terug naar boven"), plus een Next.js-scriptpayload met dezelfde tekst.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractRijksoverheidArticleBody } from './fetch-articles.mjs';
import { sources } from './sources.config.mjs';


const META = 'Minister Vijlbrief wil dat werkgevers geen huur meer op het minimumloon van werkenden mogen inhouden. Dit schrijft de minister in een brief aan de Tweede Kamer.';
const PARAGRAPHS = [
  'Minister Vijlbrief wil dat werkgevers geen huur meer op het minimumloon van werkenden mogen inhouden. Dit schrijft de minister in een brief aan de Tweede Kamer.',
  'Op dit moment geldt nog een maximumpercentage van 25% van het brutominimumloon dat mag worden ingehouden in ruil voor woonruimte. De minister schaft die mogelijkheid per 1 juli 2028 af.',
  'Uit een eerdere verkenning bleek dat werkgevers regelmatig het maximale bedrag inhouden, terwijl de kwaliteit van de woning dit niet altijd rechtvaardigt.',
];
const DEFAULT_CONTENT = `
  <div class="intro"><p>${PARAGRAPHS[0]}</p></div>
  <div class="rich-text">
    <p>${PARAGRAPHS[1]}</p>
    <figure><img src="/foto.jpg" alt="Woningen"/><figcaption>Foto: archief, ter illustratie bij dit bericht</figcaption></figure>
    <h2>Huurbescherming</h2>
    <p>${PARAGRAPHS[2]}</p>
    <h3>Voorwaarden tot die tijd</h3>
    <ul><li>de werknemer stemt schriftelijk in met de inhouding;</li><li>de woning voldoet aan de geldende kwaliteitseisen.</li></ul>
    <script>window.__trackParagraph = true;</script>
  </div>`;
const DOCUMENTS_BLOCK = `
  <section class="documents"><h2>Documenten</h2><ul>
    <li><a href="/documenten/kamerstukken/2026/09/10/kamerbrief.pdf">Kamerbrief over afschaffen inhoudingen op het minimumloon voor huisvesting</a><p>Kamerstuk | 10-09-2026</p></li>
  </ul></section>`;

function rijksoverheidPageHtml({ type = 'Nieuwsbericht', content = DEFAULT_CONTENT, documents = DOCUMENTS_BLOCK, withStart = true, withEnd = true } = {}) {
  const meta = withStart ? `<p class="article-meta"><span>${type}</span> <span>10-09-2026</span> | <span>14:30</span></p>` : '<p class="article-meta">Geen datumregel</p>';
  const feedback = withEnd ? '<section class="feedback"><h2>Heeft deze informatie u geholpen?</h2><button>Ja</button><button>Nee</button></section>' : '';
  return `<!DOCTYPE html><html lang="nl"><head><meta charSet="utf-8"/>
<title>Werkgever mag geen huur meer inhouden op minimumloon arbeidsmigrant | Rijksoverheid.nl</title>
<meta name="description" content="${META}"/>
<meta name="DCTERMS.rights" content="CC0 1.0 Universal"/>
<script>self.__next_f.push([1,"Vul in wat u zoekt Nieuwsbericht 01-01-2020 | 00:00 payload Heeft deze informatie u geholpen? Terug naar boven"])</script>
<style>.article-meta{color:#000}</style>
</head><body>
<a href="#main" class="skiplink">Ga direct naar inhoud</a>
<header><a href="/">Naar de homepage van Rijksoverheid.nl</a>
  <nav><ul><li><a href="/">Home</a></li><li><a href="/actueel">Actueel</a></li><li><a href="/actueel/nieuws">Nieuws</a></li></ul></nav>
  <form role="search"><label for="q">Vul in wat u zoekt</label><input id="q"/></form>
</header>
<main id="main">
  <h1>Werkgever mag geen huur meer inhouden op minimumloon arbeidsmigrant</h1>
  ${meta}
  ${content}
  ${documents}
  ${feedback}
  <section><h2>Meer over dit onderwerp</h2><ul><li><a href="/onderwerpen/buitenlandse-werknemers">Buitenlandse werknemers in Nederland</a></li></ul></section>
  <p>Hoort bij</p><ul><li><a href="/onderwerpen/buitenlandse-werknemers">Buitenlandse werknemers</a></li></ul>
  <p>Onderwerp</p><ul><li><a href="/ministeries/ministerie-van-sociale-zaken-en-werkgelegenheid">Ministerie van Sociale Zaken en Werkgelegenheid</a></li></ul>
</main>
<footer><p>De Rijksoverheid. Voor Nederland</p><ul><li><a href="/english">Andere talen</a></li><li><a href="/contact">Contact</a></li><li><a href="/copyright">Copyright</a></li><li><a href="/cookies">Cookies</a></li></ul><a href="#top">Terug naar boven</a></footer>
<script src="/_next/static/chunks/app.js" async=""></script>
</body></html>`;
}

const extract = (opts) => extractRijksoverheidArticleBody(rijksoverheidPageHtml(opts));

// --- Positief ---

test('normale pagina: hoofdtekst wordt geëxtraheerd, met alinea\'s, kopjes en lijstitems in de juiste volgorde', () => {
  const body = extract();
  assert.ok(body, 'verwacht een body');
  assert.equal(
    body,
    [
      PARAGRAPHS[0],
      PARAGRAPHS[1],
      'Huurbescherming',
      PARAGRAPHS[2],
      'Voorwaarden tot die tijd',
      '- de werknemer stemt schriftelijk in met de inhouding;',
      '- de woning voldoet aan de geldende kwaliteitseisen.',
    ].join('\n\n'),
  );
});

test('beginmarker: niets van vóór "Nieuwsbericht DD-MM-JJJJ | UU:MM" (titel, navigatie, zoekveld) komt in de body; de body begint met de eerste alinea', () => {
  const body = extract();
  assert.ok(body.startsWith(PARAGRAPHS[0]));
  for (const before of ['Ga direct naar inhoud', 'Naar de homepage', 'Vul in wat u zoekt', 'Actueel', 'Werkgever mag geen huur meer inhouden op minimumloon arbeidsmigrant', '10-09-2026']) {
    assert.equal(body.includes(before), false, before);
  }
});

test('eindmarker: niets vanaf "Heeft deze informatie u geholpen?" (feedback, Meer over dit onderwerp, Hoort bij) komt in de body', () => {
  const body = extract();
  assert.ok(body.endsWith('- de woning voldoet aan de geldende kwaliteitseisen.'));
  for (const after of ['Heeft deze informatie', 'Meer over dit onderwerp', 'Hoort bij', 'Onderwerp', 'Ministerie van Sociale Zaken', 'Buitenlandse werknemers in Nederland']) {
    assert.equal(body.includes(after), false, after);
  }
});

test('footer en scripts verwijderd: geen footertekst, geen Next.js-payload, geen script- of stijlinhoud', () => {
  const body = extract();
  for (const noise of ['De Rijksoverheid. Voor Nederland', 'Andere talen', 'Cookies', 'Terug naar boven', '__next_f', 'payload', '__trackParagraph', 'color:#000']) {
    assert.equal(body.includes(noise), false, noise);
  }
});

test('documentenblok (bijlagen) en <figure> met onderschrift worden verwijderd', () => {
  const body = extract();
  for (const noise of ['Documenten', 'Kamerbrief over afschaffen', 'Kamerstuk', 'Foto: archief', 'Woningen']) {
    assert.equal(body.includes(noise), false, noise);
  }
});

test('HTML-entiteiten worden correct gedecodeerd (&quot; &#x27; &#8217; &nbsp; &euro; &amp; en dubbele codering)', () => {
  const content = `<p>Minister: &quot;Werkgevers moeten een eerlijke prijs vragen.&quot; Dat is het uitgangspunt van het kabinet voor de komende jaren.</p>
    <p>Het kabinet&#x27;s plan en de minister&#8217;s brief gaan uit van&nbsp;25% en &euro;&#160;1.000 per maand &amp; meer, met &amp;lt;code&amp;gt; als letterlijke tekst. Dit geldt voor werkgevers en werknemers in alle sectoren.</p>
    <p>Daarnaast blijft het mogelijk om binnen de bestaande wettelijke kaders afspraken te maken over huisvesting en de kwaliteit daarvan.</p>`;
  const body = extract({ content });
  assert.ok(body);
  assert.ok(body.includes('Minister: "Werkgevers moeten een eerlijke prijs vragen."'));
  assert.ok(body.includes("Het kabinet's plan en de minister’s brief gaan uit van 25% en € 1.000 per maand & meer"));
  // Eén decodeerstap: "&amp;lt;" wordt de tekst "&lt;", nooit een echte "<".
  assert.ok(body.includes('met &lt;code&gt; als letterlijke tekst'));
  assert.equal(/&(quot|nbsp|euro|#x27|#8217|#160);/.test(body), false);
});

test('meerdere alinea\'s blijven behouden als aparte blokken, gescheiden door een lege regel', () => {
  const blocks = extract().split('\n\n');
  assert.equal(blocks.length, 7);
  assert.ok(blocks.every((b) => b.trim() === b && b.length > 0 && !b.includes('\n')));
});

test('lange body wordt afgekapt op maximaal 8.000 tekens, op een zinsgrens, zonder toegevoegde tekst', () => {
  const sentence = (i) => `Dit is zin nummer ${i} in een lange alinea over de nieuwe regels voor werkgevers en hun personeel.`;
  const paragraphs = Array.from({ length: 30 }, (_, p) => `<p>${Array.from({ length: 4 }, (_, s) => sentence(p * 4 + s)).join(' ')}</p>`).join('\n');
  const body = extract({ content: paragraphs, documents: '' });
  assert.ok(body);
  assert.ok(body.length <= 8000, String(body.length));
  assert.ok(body.length > 7000, String(body.length));
  assert.ok(body.endsWith('personeel.'), body.slice(-40));
  assert.equal(body.includes('…'), false);
  // Elke zin in de body is een volledige, ongewijzigde bronzin.
  const allSentences = new Set(Array.from({ length: 120 }, (_, i) => sentence(i)));
  for (const s of body.split(/\n\n| (?=Dit is zin)/)) assert.ok(allSentences.has(s), s);
});

test('afkappen respecteert afkortingen: geen knip na "bijv." midden in een zin', () => {
  const filler = 'x'.repeat(10);
  const long = `<p>Een eerste alinea van voldoende lengte om de drempel van twee alinea's te halen.</p><p>${Array.from({ length: 140 }, (_, i) => `Werkgevers betalen kosten, bijv. huur van ${filler} woning ${i} en meer.`).join(' ')}</p>`;
  assert.ok(long.length > 8000);
  const body = extract({ content: long, documents: '' });
  assert.ok(body);
  assert.ok(body.length <= 8000 && body.length > 7000, String(body.length));
  assert.equal(body.endsWith('bijv.'), false);
  assert.ok(body.endsWith('en meer.'));
});

// --- Negatief ---

test('ontbrekende beginmarker → null', () => {
  assert.equal(extract({ withStart: false }), null);
});

test('ontbrekende eindmarker → null', () => {
  assert.equal(extract({ withEnd: false }), null);
});

test('beginmarker alleen in een script-payload (Next.js) telt niet → null', () => {
  const html = rijksoverheidPageHtml({ withStart: false });
  assert.ok(html.includes('Nieuwsbericht 01-01-2020 | 00:00'));
  assert.equal(extractRijksoverheidArticleBody(html), null);
});

test('te korte tekst → null', () => {
  const content = '<p>Een korte eerste alinea van iets meer dan veertig tekens.</p><p>En nog een korte tweede alinea van veertig tekens.</p>';
  assert.equal(extract({ content }), null);
});

test('boilerplate binnen het gebied → null', () => {
  for (const noise of ['Vul in wat u zoekt', 'Terug naar boven', 'Heeft deze informatie geholpen? (variant)']) {
    const content = `${DEFAULT_CONTENT}<p>${noise} — dit hoort niet in een artikeltekst thuis en mag niet worden opgeslagen.</p>`;
    assert.equal(extract({ content }), null, noise);
  }
});

test('verkeerd paginatype (bijv. "Toespraak") → null', () => {
  assert.equal(extract({ type: 'Toespraak' }), null);
  assert.equal(extract({ type: 'Publicatie' }), null);
});

test('maar één inhoudelijke alinea (rest alleen kopjes/lijst) → null', () => {
  const content = `<p>${PARAGRAPHS[1]} ${PARAGRAPHS[2]} ${PARAGRAPHS[0]}</p><h2>Kopje</h2><ul><li>Een lijstitem dat zelf geen alinea is maar wel tekst bevat.</li><li>Nog een lijstitem met wat extra tekst erin ter lengte.</li></ul>`;
  assert.equal(extract({ content }), null);
});

test('lege of ongeldige invoer → null', () => {
  assert.equal(extractRijksoverheidArticleBody(''), null);
  assert.equal(extractRijksoverheidArticleBody(null), null);
  assert.equal(extractRijksoverheidArticleBody(undefined), null);
});

// --- Veiligheid ---

test('markdown/frontmatter-achtige regels worden geneutraliseerd (---, #, ***, ===)', () => {
  const content = `<p>---</p><p>${PARAGRAPHS[0]}</p><p># Geen kop maar tekst die met een hekje begint en lang genoeg is.</p><p>*** sterretjes aan het begin van een alinea met voldoende tekst erachter.</p><p>${PARAGRAPHS[1]}</p><p>${PARAGRAPHS[2]}</p><h2>=== kopje ===</h2>`;
  const body = extract({ content, documents: '' });
  assert.ok(body);
  const lines = body.split('\n');
  assert.equal(lines.some((l) => /^(?:-{3,}|#|\*{3,}|={3,})/.test(l)), false, body);
  assert.ok(lines.includes('\\---'));
  assert.ok(lines.includes('\\# Geen kop maar tekst die met een hekje begint en lang genoeg is.'));
});

test('"---" in de body kan geen frontmatter openen of afsluiten in het geschreven bestand', () => {
  const content = `<p>---</p><p>title: "gekaapt"</p><p>---</p><p>${PARAGRAPHS[0]}</p><p>${PARAGRAPHS[1]}</p><p>${PARAGRAPHS[2]}</p>`;
  const body = extract({ content, documents: '' });
  assert.ok(body);
  const file = `---\ntitle: "Echt"\nsourceName: "Rijksoverheid"\n---\n\n${body}\n`;
  assert.equal(file.match(/^---\n[\s\S]*?\n---\n/)[0], '---\ntitle: "Echt"\nsourceName: "Rijksoverheid"\n---\n');
  assert.equal(file.split('\n').filter((l) => l === '---').length, 2);
});

test('HTML wordt nooit letterlijk opgeslagen: geen tags, ook niet uit gecodeerde of inline HTML', () => {
  const content = `<p>${PARAGRAPHS[0]} <a href="https://example.test">Lees de <strong>brief</strong></a> <img src="x.png" onerror="alert(1)"/></p>
    <p>&lt;script&gt;alert(1)&lt;/script&gt; Dit is gecodeerde HTML in de bron en moet als tekst eindigen, niet als tag.</p>
    <p>&lt;iframe src="https://evil.test"&gt; Ook dit is tekst. Daarnaast nog een zin om deze alinea lang genoeg te maken.</p>
    <p>${PARAGRAPHS[1]}</p>`;
  const body = extract({ content, documents: '' });
  assert.ok(body);
  assert.equal(/[<>]/.test(body), false, body);
  assert.ok(body.includes('Lees de brief'));
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(body.includes('href'), false);
  assert.equal(body.includes('onerror'), false);
});

// --- Pipeline-integratie (geïsoleerde CONTENT_DIR, gemockte fetch) ---

const realTopicApiSource = sources.find((s) => s.id === 'rijksoverheid-topic-api');
const TEST_NOW = new Date('2026-10-07T00:00:00.000Z');
const ARTICLE_URL = 'https://www.rijksoverheid.nl/actueel/nieuws/2026/09/10/werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant';
let importCounter = 0;

async function runRijksoverheidPipeline(pageHtml) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kenniscentrum-body-test-'));
  const previousEnv = process.env.KENNISCENTRUM_CONTENT_DIR;
  const previousKey = process.env.GROQ_API_KEY;
  process.env.KENNISCENTRUM_CONTENT_DIR = dir;
  delete process.env.GROQ_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  let pageFetches = 0;
  try {
    importCounter += 1;
    const mod = await import(`./fetch-articles.mjs?body-test-${importCounter}`);
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        const first = body.requestState.current === 1 && body.requestState.filters[0].values[0] === realTopicApiSource.topics[0];
        const rawResults = first ? [{ url: { raw: ARTICLE_URL }, sort_date: { raw: '2026-09-10T12:30:00+00:00' } }] : [];
        return new Response(JSON.stringify({ rawResponse: { rawResults } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url) === ARTICLE_URL) {
        pageFetches += 1;
        return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response('', { status: 404 });
    };
    console.log = (...args) => logs.push(args.join(' '));
    const result = await mod.processSitemapSource(realTopicApiSource, new Set(), { count: 50 }, TEST_NOW);
    // Sinds 2026-10-08 schrijft de import bronrecords (bronlaag), geen artikelen.
    const articles = readdirSync(dir).filter((f) => f.endsWith('.md'));
    const recordsDir = path.join(dir, 'bronnen');
    const records = existsSync(recordsDir)
      ? readdirSync(recordsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(recordsDir, f), 'utf8')))
      : [];
    return { result, articles, records, logs, pageFetches };
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.KENNISCENTRUM_CONTENT_DIR;
    else process.env.KENNISCENTRUM_CONTENT_DIR = previousEnv;
    if (previousKey !== undefined) process.env.GROQ_API_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
}

// Een relevante pagina (huisvesting/minimumloon → werkgeversartikel); de
// relevantiepoort zelf wordt hier niet getest, alleen wat er geschreven wordt.
const RELEVANT_PAGE = rijksoverheidPageHtml().replace(
  META,
  'Werkgevers mogen geen huur meer inhouden op het minimumloon van arbeidsmigranten; dit raakt de loonadministratie en de loonheffingen van werkgevers.',
);

test('pipeline: Rijksoverheid-bron krijgt de geëxtraheerde hoofdtekst in het bronrecord; overige velden gelijk aan de situatie zonder hoofdtekst; geen zichtbaar artikel', async () => {
  const withBody = await runRijksoverheidPipeline(RELEVANT_PAGE);
  const withoutBody = await runRijksoverheidPipeline(RELEVANT_PAGE.replaceAll('Heeft deze informatie u geholpen?', 'Feedback'));
  assert.equal(withBody.result.stages.recorded, 1);
  assert.equal(withoutBody.result.stages.recorded, 1);
  assert.deepEqual(withBody.articles, []);
  assert.deepEqual(withoutBody.articles, []);
  const [a] = withBody.records;
  const [b] = withoutBody.records;
  assert.equal(a.body, extractRijksoverheidArticleBody(RELEVANT_PAGE));
  assert.equal(b.body, undefined);
  const rest = ({ body, fetchedAt, ...other }) => other;
  assert.deepEqual(rest(a), rest(b));
  assert.equal(a.sourceUrl, ARTICLE_URL);
  assert.equal(a.processingStatus, 'kandidaat');
});

test('pipeline: geen extra HTTP-request voor de body (precies één paginafetch per artikel)', async () => {
  const { pageFetches, result } = await runRijksoverheidPipeline(RELEVANT_PAGE);
  assert.equal(result.stages.recorded, 1);
  assert.equal(pageFetches, 1);
});

test('pipeline: mislukte extractie slaat de bron niet over (bronrecord zonder hoofdtekst)', async () => {
  const { result, records } = await runRijksoverheidPipeline(RELEVANT_PAGE.replace(/Nieuwsbericht/g, 'Persbericht'));
  assert.equal(result.stages.recorded, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].body, undefined);
});

test('logging: "body extracted (N tekens)" of "body extraction failed", plus één samenvattende regel per run', async () => {
  const ok = await runRijksoverheidPipeline(RELEVANT_PAGE);
  const body = extractRijksoverheidArticleBody(RELEVANT_PAGE);
  assert.ok(ok.logs.includes(`    body extracted (${body.length} tekens)`), ok.logs.join('\n'));
  assert.ok(ok.logs.includes('  Body-extractie: 1 extracted, 0 failed'));
  const failed = await runRijksoverheidPipeline(RELEVANT_PAGE.replaceAll('Heeft deze informatie u geholpen?', 'Feedback'));
  assert.ok(failed.logs.includes('    body extraction failed (bron zonder hoofdtekst vastgelegd)'));
  assert.ok(failed.logs.includes('  Body-extractie: 0 extracted, 1 failed'));
});
