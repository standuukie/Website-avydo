// Actualiteit van Kenniscentrum-bronnen: `supersededBy` + publicatiedatum
// (zie src/lib/source-freshness.mjs).
//
// Getest wordt op de ECHTE content in src/content/kenniscentrum/ en met de
// ECHTE matchinglogica (tokenize/overlapScore/MIN_RELEVANCE_SCORE uit
// knowledge-match.mjs, rankScoredArticles/formatSourcesForPrompt uit
// source-freshness.mjs, buildSourceFallbackAnswer uit fallback-answer.mjs).
// retrieveContext() zelf draait op de Astro-runtime (getCollection) en is
// hier niet direct aan te roepen; retrieveArticleSources() hieronder volgt
// exact dezelfde artikelstap, en een aparte test bewaakt dat ai-assistent.ts
// die stap nog op dezelfde manier uitvoert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_RELEVANCE_SCORE, overlapScore, tokenize } from '../../src/lib/knowledge-match.mjs';
import { formatSourceDate, formatSourceName, formatSourcesForPrompt, rankScoredArticles, substituteExplicitSuccessors } from '../../src/lib/source-freshness.mjs';
import { buildSourceFallbackAnswer } from '../../src/lib/fallback-answer.mjs';
import { articleContextSnippet } from '../../src/lib/article-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');
const B = 'https://www.rijksoverheid.nl/actueel/nieuws/';

const URL_AOV_OUD = `${B}2025/09/12/wetsvoorstel-voor-basisverzekering-arbeidsongeschiktheid-voor-zelfstandigen-naar-de-raad-van-state`;
const URL_AOV_NIEUW = `${B}2026/03/13/kabinet-komt-met-betaalbare-basisverzekering-voor-zelfstandigen-bij-arbeidsongeschiktheid`;
const URL_HUIS_FEB = `${B}2025/02/06/afschaffen-van-inhoudingen-op-het-minimumloon-voor-huisvesting`;
const URL_HUIS_MEI = `${B}2025/05/09/internetconsultatie-afschaffen-van-inhoudingen-op-het-minimumloon-voor-huisvesting`;
const URL_HUIS_BESLUIT = `${B}2025/10/30/regeling-voor-huisvestingskosten-arbeidsmigranten-blijft-bestaan`;
const URL_HUIS_VOORNEMEN = `${B}2026/09/10/werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant`;
const URL_E_FACTURATIE = `${B}2026/09/11/kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven`;
const URL_CRYPTO_2025 = `${B}2025/07/07/transacties-met-crypto-straks-meer-in-beeld-bij-belastingdienst`;

function loadArticles() {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
      const get = (key) => text.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
      return {
        file,
        title: get('title') ?? '',
        summary: get('summary') ?? '',
        relevance: get('relevance') ?? '',
        category: get('category') ?? '',
        tags: (text.match(/^tags: \[(.*)\]$/m)?.[1] ?? '').replace(/"/g, '').split(',').map((t) => t.trim()).filter(Boolean),
        publishedAt: new Date(get('publishedAt')),
        sourceName: get('sourceName') ?? '',
        sourceUrl: get('sourceUrl') ?? '',
        supersededBy: get('supersededBy'),
        hidden: get('hidden') === 'true',
        body: text.replace(/^---\n[\s\S]*?\n---\n/, ''),
      };
    });
}

const ARTICLES = loadArticles();
const byUrl = (url) => ARTICLES.find((a) => a.sourceUrl === url);

// Zelfde artikelstap als retrieveContext() in src/lib/ai-assistent.ts.
function retrieveArticleSources(query, articles = ARTICLES, max = 2) {
  const queryTokens = tokenize(query);
  const candidates = articles
    .filter((a) => !a.hidden)
    .map((article) => ({
      article,
      score: overlapScore(queryTokens, `${article.title} ${article.summary} ${article.category} ${article.tags.join(' ')}`),
      publishedAt: article.publishedAt,
      sourceUrl: article.sourceUrl,
      supersededBy: article.supersededBy,
    }));
  const ranked = rankScoredArticles(candidates.filter((x) => x.score >= MIN_RELEVANCE_SCORE));
  const selected = substituteExplicitSuccessors(ranked.slice(0, max), candidates);
  const sources = selected.map(({ article }, i) => ({
    id: i + 1,
    name: `Kenniscentrum Avydo (bron: ${article.sourceName})`,
    title: article.title,
    url: article.sourceUrl,
    snippet: articleContextSnippet(article),
    publishedAt: article.publishedAt,
    superseded: Boolean(article.supersededBy),
  }));
  return { ranked, sources };
}

// --- Bewaking: ai-assistent.ts voert de artikelstap nog zo uit ---

test('ai-assistent.ts gebruikt ongewijzigde score + rankScoredArticles + de formatter met datum', () => {
  const text = readFileSync(path.resolve(__dirname, '../../src/lib/ai-assistent.ts'), 'utf8');
  assert.ok(text.includes("`${article.data.title} ${article.data.summary} ${article.data.category} ${article.data.tags.join(' ')}`"));
  assert.match(text, /rankScoredArticles\(/);
  assert.match(text, /\.filter\(\(x\) => x\.score >= MIN_RELEVANCE_SCORE\),\s*\)\.slice\(0, MAX_ARTICLE_SOURCES\)/);
  assert.match(text, /supersededBy: article\.data\.supersededBy/);
  assert.match(text, /publishedAt: article\.data\.publishedAt,\s*superseded: Boolean\(article\.data\.supersededBy\)/);
  assert.match(text, /return formatSourcesWithFreshness\(sources\);/);
  // Geen recentheidsbonus in de score zelf.
  assert.equal(/overlapScore\([^)]*publishedAt/.test(text), false);
  // De body telt nooit mee voor de score; hij wordt pas ná de top-N-selectie
  // gebruikt, uitsluitend als bronfragment (zie article-context.mjs).
  assert.equal((text.match(/article\.body/g) ?? []).length, 1);
  assert.match(text, /snippet: articleContextSnippet\(\{\s*sourceName: article\.data\.sourceName,\s*summary: article\.data\.summary,\s*relevance: article\.data\.relevance,\s*body: article\.body,\s*\}\)/);
  assert.ok(text.indexOf('article.body') > text.indexOf('.slice(0, MAX_ARTICLE_SOURCES)'));
  // Opvolgervervanging: ná de topselectie, vóór het bronfragment.
  const substitution = text.indexOf('substituteExplicitSuccessors(');
  assert.ok(substitution > text.indexOf('.slice(0, MAX_ARTICLE_SOURCES)'));
  assert.ok(substitution < text.indexOf('articleContextSnippet({'));
  assert.match(text, /for \(const \{ article \} of selectedArticles\)/);
});

// --- Integriteit van supersededBy ---

test('integriteit: elk supersededBy verwijst naar een bestaand, niet-verborgen artikel (op sourceUrl), nooit naar zichzelf', () => {
  for (const a of ARTICLES.filter((x) => x.supersededBy)) {
    const target = byUrl(a.supersededBy);
    assert.ok(target, `${a.file}: supersededBy verwijst naar onbekende sourceUrl ${a.supersededBy}`);
    assert.notEqual(a.supersededBy, a.sourceUrl, `${a.file} verwijst naar zichzelf`);
    assert.equal(target.hidden, false, `${a.file}: opvolger is verborgen`);
  }
});

test('integriteit: geen kringen in supersededBy-ketens', () => {
  for (const start of ARTICLES.filter((x) => x.supersededBy)) {
    const seen = new Set([start.sourceUrl]);
    let current = start;
    while (current?.supersededBy) {
      assert.equal(seen.has(current.supersededBy), false, `kring vanaf ${start.file}`);
      seen.add(current.supersededBy);
      current = byUrl(current.supersededBy);
    }
  }
});

test('markeringen: exact de drie handmatig vastgestelde relaties, geen andere', () => {
  const marked = Object.fromEntries(ARTICLES.filter((a) => a.supersededBy).map((a) => [a.sourceUrl, a.supersededBy]));
  assert.deepEqual(marked, {
    [URL_AOV_OUD]: URL_AOV_NIEUW,
    [URL_HUIS_FEB]: URL_HUIS_BESLUIT,
    [URL_HUIS_MEI]: URL_HUIS_BESLUIT,
  });
});

test('regressie "nieuwste = geldende regel": het besluit van 30-10-2025 is NIET opgevolgd door het voornemen van 10-09-2026', () => {
  assert.equal(byUrl(URL_HUIS_BESLUIT).supersededBy, undefined);
  assert.equal(byUrl(URL_HUIS_VOORNEMEN).supersededBy, undefined);
  assert.equal(ARTICLES.some((a) => a.supersededBy === URL_HUIS_VOORNEMEN), false);
  assert.equal(byUrl(URL_AOV_NIEUW).supersededBy, undefined);
});

test('behoud: historische artikelen blijven gewoon in de contentcollectie (niet verwijderd, niet verborgen)', () => {
  for (const url of [URL_AOV_OUD, URL_HUIS_FEB, URL_HUIS_MEI]) {
    const a = byUrl(url);
    assert.ok(a, `${url} moet nog in de kennisbank staan`);
    assert.equal(a.hidden, false);
    assert.ok(a.title && a.summary && !Number.isNaN(a.publishedAt.getTime()));
  }
});

test('behoud: pagina-/overzichtscode filtert niet op supersededBy (historische pagina\'s blijven bestaan)', () => {
  for (const file of ['../../src/pages/kenniscentrum/[...slug].astro', '../../src/pages/kenniscentrum/index.astro', '../../src/lib/kenniscentrum.ts']) {
    assert.equal(readFileSync(path.resolve(__dirname, file), 'utf8').includes('supersededBy'), false, file);
  }
});

// --- Volgorde (rankScoredArticles) ---

const d = (iso) => new Date(iso);

test('rankScoredArticles: bij gelijke score gaat een niet-opgevolgd artikel vóór een opgevolgd, ook als het opgevolgde nieuwer is', () => {
  const ranked = rankScoredArticles([
    { id: 'hist', score: 3, publishedAt: d('2026-05-01'), sourceUrl: 'u:hist', supersededBy: 'u:elders' },
    { id: 'cur', score: 3, publishedAt: d('2025-01-01'), sourceUrl: 'u:cur' },
  ]);
  assert.deepEqual(ranked.map((x) => x.id), ['cur', 'hist']);
});

test('rankScoredArticles: de score blijft leidend — een duidelijk relevanter opgevolgd artikel blijft vindbaar en wordt niet weggefilterd', () => {
  const ranked = rankScoredArticles([
    { id: 'hist', score: 5, publishedAt: d('2025-01-01'), sourceUrl: 'u:hist', supersededBy: 'u:niet-in-lijst' },
    { id: 'cur', score: 2, publishedAt: d('2026-01-01'), sourceUrl: 'u:cur' },
  ]);
  assert.deepEqual(ranked.map((x) => x.id), ['hist', 'cur']);
});

test('rankScoredArticles: geen recentheidsbonus — een relevanter ouder artikel wint van een nieuwer artikel', () => {
  const ranked = rankScoredArticles([
    { id: 'nieuw', score: 2, publishedAt: d('2026-09-01'), sourceUrl: 'u:nieuw' },
    { id: 'oud', score: 3, publishedAt: d('2024-01-01'), sourceUrl: 'u:oud' },
  ]);
  assert.deepEqual(ranked.map((x) => x.id), ['oud', 'nieuw']);
});

test('rankScoredArticles: een opgevolgd artikel staat nooit vóór zijn eigen opvolger (als die ook kandidaat is)', () => {
  const ranked = rankScoredArticles([
    { id: 'pred', score: 3, publishedAt: d('2025-05-01'), sourceUrl: 'u:pred', supersededBy: 'u:succ' },
    { id: 'ander', score: 4, publishedAt: d('2026-01-01'), sourceUrl: 'u:ander' },
    { id: 'succ', score: 2, publishedAt: d('2025-10-01'), sourceUrl: 'u:succ' },
  ]);
  assert.deepEqual(ranked.map((x) => x.id), ['ander', 'succ', 'pred']);
});

// --- Bronweergave aan het model ---

test('formatSourcesForPrompt: Kenniscentrum-artikelen tonen de publicatiedatum, opgevolgde artikelen het label "historisch"; andere bronnen ongewijzigd', () => {
  assert.equal(formatSourceDate(d('2026-03-13T13:15:00.000Z')), '13-03-2026');
  assert.equal(
    formatSourceName({ name: 'Kenniscentrum Avydo (bron: Rijksoverheid)', publishedAt: d('2026-03-13T13:15:00.000Z') }),
    'Kenniscentrum Avydo (bron: Rijksoverheid, 13-03-2026)',
  );
  assert.equal(
    formatSourceName({ name: 'Kenniscentrum Avydo (bron: Rijksoverheid)', publishedAt: d('2025-09-12T13:00:00.000Z'), superseded: true }),
    'Kenniscentrum Avydo (bron: Rijksoverheid, 12-09-2025, historisch)',
  );
  const kennisitem = { id: 1, name: 'Avydo kennisbank (bron: Belastingdienst)', title: 'Btw-aangifte', url: 'https://example.test', snippet: 'Tekst.' };
  assert.equal(formatSourcesForPrompt([kennisitem]), '[1] Avydo kennisbank (bron: Belastingdienst) — "Btw-aangifte"\nTekst.');
  assert.match(formatSourcesForPrompt([]), /^\(Geen relevante bronnen gevonden/);
});

// --- Dossier: arbeidsongeschiktheidsverzekering zelfstandigen ---

for (const query of [
  'Komt er een verplichte basisverzekering arbeidsongeschiktheid voor zelfstandigen?',
  'Wanneer komt de basisverzekering voor zelfstandigen bij arbeidsongeschiktheid?',
]) {
  test(`dossier AOV zelfstandigen — "${query}": 13-03-2026 krijgt voorrang, 12-09-2025 is herkenbaar historisch, het model ziet beide datums`, () => {
    const { sources } = retrieveArticleSources(query);
    assert.deepEqual(sources.map((s) => s.url), [URL_AOV_NIEUW, URL_AOV_OUD]);
    assert.equal(sources[0].superseded, false);
    assert.equal(sources[1].superseded, true);
    const prompt = formatSourcesForPrompt(sources);
    assert.ok(prompt.includes('(bron: Rijksoverheid, 13-03-2026)'));
    assert.ok(prompt.includes('(bron: Rijksoverheid, 12-09-2025, historisch)'));
  });
}

// --- Dossier: huisvestingskosten arbeidsmigranten ---

const HUISVESTING_VRAAG = 'Mag ik als werkgever huisvestingskosten inhouden op het minimumloon?';

test('dossier huisvesting — het geldende besluit (30-10-2025) én het latere voornemen (10-09-2026) worden beide meegegeven, met datum', () => {
  const { sources } = retrieveArticleSources(HUISVESTING_VRAAG);
  assert.deepEqual(sources.map((s) => s.url), [URL_HUIS_VOORNEMEN, URL_HUIS_BESLUIT]);
  assert.ok(sources.every((s) => s.superseded === false));
  const prompt = formatSourcesForPrompt(sources);
  assert.ok(prompt.includes('(bron: Rijksoverheid, 10-09-2026)'));
  assert.ok(prompt.includes('(bron: Rijksoverheid, 30-10-2025)'));
  assert.equal(prompt.includes('historisch'), false);
});

test('dossier huisvesting — de herziene artikelen uit februari en mei 2025 blijven kandidaat, maar staan als historisch ná het besluit', () => {
  const { ranked } = retrieveArticleSources(HUISVESTING_VRAAG);
  const urls = ranked.map((x) => x.sourceUrl);
  for (const old of [URL_HUIS_FEB, URL_HUIS_MEI]) {
    assert.ok(urls.includes(old), `${old} moet kandidaat blijven`);
    assert.ok(urls.indexOf(old) > urls.indexOf(URL_HUIS_BESLUIT));
    assert.ok(ranked.find((x) => x.sourceUrl === old).supersededBy === URL_HUIS_BESLUIT);
  }
});

test('dossier huisvesting — zonder de supersededBy-markeringen én zonder de tags van het besluit (30-10-2025) valt het geldende besluit buiten de bronnen (dit is wat de markeringen oplossen)', () => {
  // Fixture los van de content-metadata: het besluit zonder zijn tags, zodat
  // deze test uitsluitend het effect van de supersededBy-markeringen meet.
  const unmarked = ARTICLES.map((a) => ({ ...a, supersededBy: undefined, tags: a.sourceUrl === URL_HUIS_BESLUIT ? [] : a.tags }));
  const { sources } = retrieveArticleSources(HUISVESTING_VRAAG, unmarked);
  assert.equal(sources.some((s) => s.url === URL_HUIS_BESLUIT), false);
  assert.ok(sources.some((s) => s.url === URL_HUIS_MEI || s.url === URL_HUIS_FEB));
});

// --- Expliciete opvolgervervanging (substituteExplicitSuccessors) ---

test('substituteExplicitSuccessors: een geselecteerd artikel met expliciete supersededBy wordt vervangen door die opvolger, op dezelfde plek', () => {
  const corpus = [
    { id: 'a', sourceUrl: 'u:a' },
    { id: 'pred', sourceUrl: 'u:pred', supersededBy: 'u:succ' },
    { id: 'succ', sourceUrl: 'u:succ' },
  ];
  const result = substituteExplicitSuccessors([corpus[1], corpus[0]], corpus);
  assert.deepEqual(result.map((x) => x.id), ['succ', 'a']);
});

test('substituteExplicitSuccessors: zonder supersededBy nooit vervangen — ook niet door een nieuwer artikel over hetzelfde onderwerp', () => {
  const corpus = [
    { id: 'oud', sourceUrl: 'u:oud', publishedAt: d('2025-01-01'), title: 'Regeling X' },
    { id: 'nieuw', sourceUrl: 'u:nieuw', publishedAt: d('2026-01-01'), title: 'Regeling X gewijzigd' },
  ];
  assert.deepEqual(substituteExplicitSuccessors([corpus[0]], corpus).map((x) => x.id), ['oud']);
});

test('substituteExplicitSuccessors: opvolger al geselecteerd → geen vervanging, geen dubbele bron', () => {
  const corpus = [
    { id: 'succ', sourceUrl: 'u:succ' },
    { id: 'pred', sourceUrl: 'u:pred', supersededBy: 'u:succ' },
  ];
  assert.deepEqual(substituteExplicitSuccessors(corpus, corpus).map((x) => x.id), ['succ', 'pred']);
});

test('substituteExplicitSuccessors: twee voorgangers van dezelfde opvolger → alleen de eerste wordt vervangen', () => {
  const corpus = [
    { id: 'feb', sourceUrl: 'u:feb', supersededBy: 'u:succ' },
    { id: 'mei', sourceUrl: 'u:mei', supersededBy: 'u:succ' },
    { id: 'succ', sourceUrl: 'u:succ' },
  ];
  assert.deepEqual(substituteExplicitSuccessors([corpus[0], corpus[1]], corpus).map((x) => x.id), ['succ', 'mei']);
});

test('substituteExplicitSuccessors: onbekende of dubbelzinnige (gedeelde) opvolger-URL → geen vervanging', () => {
  const corpus = [
    { id: 'p1', sourceUrl: 'u:p1', supersededBy: 'u:bestaat-niet' },
    { id: 'p2', sourceUrl: 'u:p2', supersededBy: 'u:gedeeld' },
    { id: 'g1', sourceUrl: 'u:gedeeld' },
    { id: 'g2', sourceUrl: 'u:gedeeld' },
  ];
  assert.deepEqual(substituteExplicitSuccessors([corpus[0], corpus[1]], corpus).map((x) => x.id), ['p1', 'p2']);
});

// --- Gerichte retrievalfixes op echte content ---

test('content: T1/T2-tags staan in de productie-artikelen', () => {
  assert.deepEqual(byUrl(URL_E_FACTURATIE).tags, ['e-facturatie', 'verplicht']);
  assert.deepEqual(byUrl(URL_HUIS_BESLUIT).tags, ['huur', 'inhouden', 'werkgever', 'huisvesting']);
});

for (const query of ['Wanneer wordt e-facturatie verplicht?', 'Is e-facturatie verplicht?']) {
  test(`e-facturatie — "${query}" vindt het bestaande e-facturatie-artikel`, () => {
    assert.ok(retrieveArticleSources(query).sources.some((s) => s.url === URL_E_FACTURATIE));
  });
}

test('e-facturatie — bekend neveneffect van de tag "verplicht": "Is rapportage voor crypto verplicht?" krijgt het e-facturatie-artikel vóór crypto 07-07-2025', () => {
  // Bewust vastgelegd (niet weggewerkt met bredere retrievallogica): het
  // e-facturatie-artikel scoort hier op "rapportage" + "verplicht".
  const { sources } = retrieveArticleSources('Is rapportage voor crypto verplicht?');
  assert.deepEqual(sources.map((s) => s.url), [URL_E_FACTURATIE, URL_CRYPTO_2025]);
});

test('huur — "Hoeveel huur mag een werkgever inhouden op het minimumloon?": het voorstel (10-09-2026) én de geldende regel (30-10-2025)', () => {
  const { sources } = retrieveArticleSources('Hoeveel huur mag een werkgever inhouden op het minimumloon?');
  assert.deepEqual(sources.map((s) => s.url), [URL_HUIS_VOORNEMEN, URL_HUIS_BESLUIT]);
  assert.ok(sources.every((s) => s.superseded === false));
  // Het latere voorstel heeft geen supersededBy-relatie met het besluit en vervangt het dus niet.
  assert.equal(byUrl(URL_HUIS_BESLUIT).supersededBy, undefined);
  const prompt = formatSourcesForPrompt(sources);
  assert.ok(prompt.includes('(bron: Rijksoverheid, 10-09-2026)'));
  assert.ok(prompt.includes('(bron: Rijksoverheid, 30-10-2025)'));
});

const HUUR_OPVOLGER_VRAAG = 'Mag ik als werkgever kosten voor huisvesting inhouden op het minimumloon?';

test('huur-opvolger — "Mag ik als werkgever kosten voor huisvesting inhouden op het minimumloon?": 30-10-2025 wordt geselecteerd; 02-2025 en 05-2025 niet vóór de geldende opvolger', () => {
  const { sources } = retrieveArticleSources(HUUR_OPVOLGER_VRAAG);
  const urls = sources.map((s) => s.url);
  assert.deepEqual(urls, [URL_HUIS_VOORNEMEN, URL_HUIS_BESLUIT]);
  for (const old of [URL_HUIS_FEB, URL_HUIS_MEI]) {
    assert.ok(!urls.includes(old) || urls.indexOf(old) > urls.indexOf(URL_HUIS_BESLUIT), old);
  }
  assert.equal(formatSourcesForPrompt(sources).includes('historisch'), false);
});

test('huur-opvolger — ook zonder de tags van het besluit: de topselectie kiest de opgevolgde 02-2025-bron, de expliciete supersededBy vervangt die door 30-10-2025', () => {
  const untagged = ARTICLES.map((a) => (a.sourceUrl === URL_HUIS_BESLUIT ? { ...a, tags: [] } : a));
  const { ranked, sources } = retrieveArticleSources(HUUR_OPVOLGER_VRAAG, untagged);
  assert.deepEqual(ranked.slice(0, 2).map((x) => x.sourceUrl), [URL_HUIS_VOORNEMEN, URL_HUIS_FEB]);
  assert.deepEqual(sources.map((s) => s.url), [URL_HUIS_VOORNEMEN, URL_HUIS_BESLUIT]);
});

test('opvolgervervanging — verwachte wijziging in de bestaande set: "Moet ik mezelf verzekeren tegen het risico dat een werknemer ziek wordt?" krijgt 13-03-2026 i.p.v. het opgevolgde 12-09-2025', () => {
  const { ranked, sources } = retrieveArticleSources('Moet ik mezelf verzekeren tegen het risico dat een werknemer ziek wordt?');
  assert.ok(ranked.slice(0, 2).some((x) => x.sourceUrl === URL_AOV_OUD));
  const urls = sources.map((s) => s.url);
  assert.ok(urls.includes(URL_AOV_NIEUW));
  assert.equal(urls.includes(URL_AOV_OUD), false);
});

// --- Fallback bij uitval van Groq ---

test('fallback: bij gelijkwaardige scores komt de geldende bron vóór de historische, dus de fallback gebruikt de geldende bron', () => {
  const aovOud = byUrl(URL_AOV_OUD);
  const aovNieuw = byUrl(URL_AOV_NIEUW);
  // Historische bron bewust als eerste aangeboden, met gelijke score.
  const ranked = rankScoredArticles([
    { article: aovOud, score: 4, publishedAt: aovOud.publishedAt, sourceUrl: aovOud.sourceUrl, supersededBy: aovOud.supersededBy },
    { article: aovNieuw, score: 4, publishedAt: aovNieuw.publishedAt, sourceUrl: aovNieuw.sourceUrl, supersededBy: aovNieuw.supersededBy },
  ]);
  const sources = ranked.map(({ article }, i) => ({
    id: i + 1,
    name: `Kenniscentrum Avydo (bron: ${article.sourceName})`,
    title: article.title,
    url: article.sourceUrl,
    snippet: `${article.summary} ${article.relevance}`,
    publishedAt: article.publishedAt,
    superseded: Boolean(article.supersededBy),
  }));
  const answer = buildSourceFallbackAnswer(sources);
  assert.equal(answer.sources[0].url, URL_AOV_NIEUW);
  assert.equal(answer.fallback, true);
});

test('fallback: ook met een historische bron die NIEUWER is dan de geldende bron (gelijke score) blijft de geldende bron eerst', () => {
  const ranked = rankScoredArticles([
    { id: 'hist', score: 2, publishedAt: d('2026-06-01'), sourceUrl: 'u:hist', supersededBy: 'u:elders' },
    { id: 'cur', score: 2, publishedAt: d('2025-06-01'), sourceUrl: 'u:cur' },
  ]);
  const sources = ranked.map((x, i) => ({ id: i + 1, name: 'n', title: x.id, url: x.sourceUrl, snippet: 'Zin één. Zin twee.' }));
  assert.equal(buildSourceFallbackAnswer(sources).sources[0].url, 'u:cur');
});

// --- Fetcher: bestaande metadata wordt niet overschreven ---

test('fetcher: een bestaand artikel met supersededBy wordt bij een nieuwe fetch als duplicate overgeslagen en niet overschreven', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kenniscentrum-freshness-test-'));
  const fileName = '2025-09-12-wetsvoorstel-voor-basisverzekering-arbeidsongeschiktheid-voor-zelfstandigen-naar.md';
  const original = readFileSync(path.join(CONTENT_DIR, fileName), 'utf8');
  writeFileSync(path.join(dir, fileName), original, 'utf8');
  const previousEnv = process.env.KENNISCENTRUM_CONTENT_DIR;
  process.env.KENNISCENTRUM_CONTENT_DIR = dir;
  const originalFetch = globalThis.fetch;
  try {
    const mod = await import(`./fetch-articles.mjs?freshness-test=${Date.now()}`);
    const cfg = await import('./sources.config.mjs');
    const source = cfg.sources.find((s) => s.id === 'rijksoverheid-topic-api');
    let pageFetches = 0;
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        const first = body.requestState.current === 1 && body.requestState.filters[0].values[0] === source.topics[0];
        const rawResults = first ? [{ url: { raw: URL_AOV_OUD }, sort_date: { raw: '2025-09-12T13:00:00+00:00' } }] : [];
        return new Response(JSON.stringify({ rawResponse: { rawResults } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      pageFetches += 1;
      return new Response('', { status: 404 });
    };
    const log = console.log;
    console.log = () => {};
    let result;
    try {
      result = await mod.processSitemapSource(source, new Set([URL_AOV_OUD]), { count: 50 }, new Date('2026-10-07T00:00:00.000Z'));
    } finally {
      console.log = log;
    }
    assert.equal(result.stages.reasons.duplicate, 1);
    assert.equal(result.stages.published, 0);
    assert.equal(pageFetches, 0);
    assert.deepEqual(readdirSync(dir), [fileName]);
    assert.equal(readFileSync(path.join(dir, fileName), 'utf8'), original);
    assert.ok(original.includes(`supersededBy: "${URL_AOV_NIEUW}"`));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.KENNISCENTRUM_CONTENT_DIR;
    else process.env.KENNISCENTRUM_CONTENT_DIR = previousEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
