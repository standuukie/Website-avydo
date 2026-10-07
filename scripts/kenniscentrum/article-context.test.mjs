// Bronfragment van een AL GESELECTEERD Kenniscentrum-artikel
// (articleContextSnippet in src/lib/article-context.mjs, gebruikt door
// retrieveContext() in src/lib/ai-assistent.ts).
//
// Getest op de ECHTE content en met de ECHTE matchinglogica. De artikelstap
// van retrieveContext() draait op de Astro-runtime; selectArticles()
// hieronder volgt die stap exact, en source-freshness.test.mjs bewaakt dat
// ai-assistent.ts de body uitsluitend als fragment ná de selectie gebruikt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_RELEVANCE_SCORE, overlapScore, tokenize } from '../../src/lib/knowledge-match.mjs';
import { rankScoredArticles, formatSourcesForPrompt, substituteExplicitSuccessors } from '../../src/lib/source-freshness.mjs';
import { estimateTokens } from '../../src/lib/token-estimate.mjs';
import {
  articleContextSnippet,
  fallbackArticleSnippet,
  truncateAtTextBoundary,
  ARTICLE_BODY_SNIPPET_MAX_LENGTH,
} from '../../src/lib/article-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');
const MAX_ARTICLE_SOURCES = 2; // zelfde waarde als ai-assistent.ts (bewaakt in knowledge-retrieval.test.mjs)
const B = 'https://www.rijksoverheid.nl/actueel/nieuws/';
const URL_AOV_OUD = `${B}2025/09/12/wetsvoorstel-voor-basisverzekering-arbeidsongeschiktheid-voor-zelfstandigen-naar-de-raad-van-state`;
const URL_AOV_NIEUW = `${B}2026/03/13/kabinet-komt-met-betaalbare-basisverzekering-voor-zelfstandigen-bij-arbeidsongeschiktheid`;

const ARTICLES = readdirSync(CONTENT_DIR)
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

// Zelfde artikelstap als retrieveContext(): score (zonder body) → drempel →
// rankScoredArticles → top-N → expliciete opvolgervervanging → pas dán het fragment.
function selectArticles(query, articles = ARTICLES) {
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
  return substituteExplicitSuccessors(ranked.slice(0, MAX_ARTICLE_SOURCES), candidates).map(({ article, score }) => ({ article, score }));
}

function toSources(selected, snippetFn) {
  return selected.map(({ article }, i) => ({
    id: i + 1,
    name: `Kenniscentrum Avydo (bron: ${article.sourceName})`,
    title: article.title,
    url: article.sourceUrl,
    snippet: snippetFn(article),
    publishedAt: article.publishedAt,
    superseded: Boolean(article.supersededBy),
  }));
}
const newSnippet = (a) => articleContextSnippet(a);
const oldSnippet = (a) => `${a.summary} ${a.relevance}`.slice(0, 500);
const signature = (selected) => selected.map(({ article, score }) => `${article.sourceUrl}|${score}|${Boolean(article.supersededBy)}`);

// Alle bestaande retrievalvragen uit de andere testbestanden (zelfde
// verzameling als query-alias.test.mjs).
const EXISTING_QUESTIONS = (() => {
  const questions = new Set();
  const self = path.basename(fileURLToPath(import.meta.url));
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs') && f !== self)) {
    const text = readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of text.matchAll(/['"`]([A-Z][^'"`\n${}]{10,160}\?)['"`]/g)) questions.add(m[1]);
  }
  return [...questions];
})();

const RO = ARTICLES.filter((a) => a.sourceName === 'Rijksoverheid' && !a.hidden);
const byUrl = (url) => ARTICLES.find((a) => a.sourceUrl === url);

// --- Helper: fragmentregels ---

test('helper: Rijksoverheid-artikel met body → de body is het fragment (niet summary + relevance)', () => {
  const article = { sourceName: 'Rijksoverheid', summary: 'Korte samenvatting.', relevance: 'Algemene relevantietekst.', body: '\nEerste alinea van de hoofdtekst.\n\nTweede alinea met een datum: 1 juli 2028.\n' };
  assert.equal(articleContextSnippet(article), 'Eerste alinea van de hoofdtekst.\nTweede alinea met een datum: 1 juli 2028.');
});

test('helper: fragment is maximaal 1.200 tekens en eindigt op een zinsgrens, zonder toegevoegde tekst', () => {
  const sentence = (i) => `Dit is zin ${i} van een lange alinea over regels voor werkgevers.`;
  const body = `\n${Array.from({ length: 60 }, (_, i) => sentence(i)).join(' ')}\n`;
  const snippet = articleContextSnippet({ sourceName: 'Rijksoverheid', summary: 's', relevance: 'r', body });
  assert.ok(snippet.length <= ARTICLE_BODY_SNIPPET_MAX_LENGTH, String(snippet.length));
  assert.ok(snippet.length > 1000, String(snippet.length));
  assert.ok(snippet.endsWith('werkgevers.'));
  assert.ok(body.includes(snippet));
});

test('helper: nooit meer dan 1.200 tekens, ook zonder zinsgrens of zonder spaties', () => {
  for (const body of ['woord '.repeat(400), 'x'.repeat(5000), `${'a'.repeat(1300)}. ${'b'.repeat(50)}`]) {
    const snippet = articleContextSnippet({ sourceName: 'Rijksoverheid', summary: 's', relevance: 'r', body });
    assert.ok(snippet.length > 0 && snippet.length <= ARTICLE_BODY_SNIPPET_MAX_LENGTH, String(snippet.length));
  }
  assert.equal(truncateAtTextBoundary('kort'), 'kort');
});

test('helper: geen bruikbare body (ontbreekt, leeg, of alleen de summary) → exact de bestaande summary + relevance-fallback', () => {
  const base = { sourceName: 'Rijksoverheid', summary: 'De samenvatting van dit bericht.', relevance: 'Dit kan relevant zijn.' };
  const expected = `${base.summary} ${base.relevance}`.slice(0, 500);
  for (const body of [undefined, null, '', '\n\n', `\n${base.summary}\n`]) {
    assert.equal(articleContextSnippet({ ...base, body }), expected, String(body));
  }
  assert.equal(fallbackArticleSnippet(base), expected);
});

test('helper: KVK en Belastingdienst gebruiken altijd de bestaande fallback, ook met een lange eigen body', () => {
  for (const sourceName of ['KVK', 'Belastingdienst']) {
    const article = { sourceName, summary: 'S', relevance: 'R', body: '\nEen lange eigen hoofdtekst.\n\nNog een alinea.\n' };
    assert.equal(articleContextSnippet(article), 'S R');
  }
});

test('helper: markdown-escapes en entiteiten van de extractor verschijnen niet in het fragment', () => {
  const body = '\n\\--- streepjes aan het begin\n\n\\# hekje aan het begin\n\nTekst met &lt;code&gt; erin.\n';
  assert.equal(
    articleContextSnippet({ sourceName: 'Rijksoverheid', summary: 's', relevance: 'r', body }),
    '--- streepjes aan het begin\n# hekje aan het begin\nTekst met <code> erin.',
  );
});

// --- Echte content ---

test('echte content: elk Rijksoverheid-artikel krijgt een body-fragment (≤ 1.200 tekens, begint met de hoofdtekst)', () => {
  // 48 vóór de opschoning van 2026-10-07; 16 artikelen staan sindsdien op hidden.
  assert.ok(RO.length >= 32, String(RO.length));
  for (const a of RO) {
    const snippet = newSnippet(a);
    assert.notEqual(snippet, oldSnippet(a), a.file);
    assert.ok(snippet.length <= ARTICLE_BODY_SNIPPET_MAX_LENGTH, `${a.file}: ${snippet.length}`);
    assert.ok(snippet.startsWith(a.body.trim().split('\n')[0].slice(0, 60)), a.file);
  }
});

test('echte content: KVK en Belastingdienst houden exact het bestaande fragment (summary + relevance, max. 500)', () => {
  const others = ARTICLES.filter((a) => a.sourceName === 'KVK' || a.sourceName === 'Belastingdienst');
  assert.ok(others.length > 0);
  for (const a of others) assert.equal(newSnippet(a), oldSnippet(a), a.file);
});

// --- Selectie blijft ongewijzigd ---

test('regressie: voor alle bestaande retrievalvragen is de artikelselectie (bron, score, volgorde, superseded) identiek met en zonder body', () => {
  assert.ok(EXISTING_QUESTIONS.length >= 151, String(EXISTING_QUESTIONS.length));
  const withoutBody = ARTICLES.map((a) => ({ ...a, body: undefined }));
  for (const q of EXISTING_QUESTIONS) {
    assert.deepEqual(signature(selectArticles(q)), signature(selectArticles(q, withoutBody)), q);
  }
});

test('regressie: de body wordt pas ná de selectie gebruikt — een body vol vraagwoorden verandert geen enkele selectie', () => {
  for (const q of EXISTING_QUESTIONS) {
    const poisoned = ARTICLES.map((a) => ({ ...a, body: `\n${q} ${tokenize(q).join(' ')}\n` }));
    assert.deepEqual(signature(selectArticles(q, poisoned)), signature(selectArticles(q)), q);
  }
});

test('regressie: fragmenten van de geselecteerde artikelen gebruiken de body waar die er is, anders de fallback', () => {
  let bodyUsed = 0;
  for (const q of EXISTING_QUESTIONS) {
    for (const { article } of selectArticles(q)) {
      const snippet = newSnippet(article);
      if (article.sourceName === 'Rijksoverheid') {
        assert.notEqual(snippet, oldSnippet(article), `${q} | ${article.file}`);
        bodyUsed += 1;
      } else {
        assert.equal(snippet, oldSnippet(article), `${q} | ${article.file}`);
      }
    }
  }
  assert.ok(bodyUsed > 0);
});

test('supersededBy en bronvolgorde ongewijzigd: AOV-dossier geeft 13-03-2026 vóór 12-09-2025 (historisch), beide met body-fragment', () => {
  const selected = selectArticles('Komt er een verplichte basisverzekering arbeidsongeschiktheid voor zelfstandigen?');
  assert.deepEqual(selected.map(({ article }) => article.sourceUrl), [URL_AOV_NIEUW, URL_AOV_OUD]);
  const prompt = formatSourcesForPrompt(toSources(selected, newSnippet));
  assert.ok(prompt.includes('(bron: Rijksoverheid, 13-03-2026)'));
  assert.ok(prompt.includes('(bron: Rijksoverheid, 12-09-2025, historisch)'));
  assert.ok(prompt.includes(newSnippet(byUrl(URL_AOV_NIEUW))));
  assert.ok(prompt.includes(newSnippet(byUrl(URL_AOV_OUD))));
});

// --- Tokenmeting ---
//
// Schatting: estimateTokens() uit src/lib/token-estimate.mjs, dezelfde
// vuistregel als de TPM-limiter: ~4 tekens per token, naar boven afgerond.

function contextChars(selected, snippetFn) {
  return formatSourcesForPrompt(toSources(selected, snippetFn));
}

test('tokenmeting: extra context over alle bestaande retrievalvragen (huidig vs. nieuw, tekens en geschatte tokens)', (t) => {
  let oldChars = 0;
  let newChars = 0;
  let maxExtraTokens = 0;
  let questionsWithArticles = 0;
  for (const q of EXISTING_QUESTIONS) {
    const selected = selectArticles(q);
    if (selected.length === 0) continue;
    questionsWithArticles += 1;
    const before = contextChars(selected, oldSnippet);
    const after = contextChars(selected, newSnippet);
    oldChars += before.length;
    newChars += after.length;
    maxExtraTokens = Math.max(maxExtraTokens, estimateTokens(after) - estimateTokens(before));
  }
  const n = questionsWithArticles;
  t.diagnostic(`vragen met artikelbronnen: ${n} van ${EXISTING_QUESTIONS.length}`);
  t.diagnostic(`gem. artikelcontext: ${Math.round(oldChars / n)} → ${Math.round(newChars / n)} tekens (+${Math.round((newChars - oldChars) / n)}), ≈ +${Math.round(estimateTokens('x'.repeat(Math.round((newChars - oldChars) / n))))} tokens`);
  t.diagnostic(`max. extra per vraag: +${maxExtraTokens} tokens`);
  assert.ok(n > 0);
  assert.ok(newChars >= oldChars);
  // Bovengrens: 2 artikelen × 1.200 tekens body = 2 × 300 tokens.
  assert.ok(maxExtraTokens <= 600, String(maxExtraTokens));
});

test('tokenmeting worst-case: 2 geselecteerde Rijksoverheid-artikelen met de langste bodies, elk ≤ 1.200 tekens', (t) => {
  const longest = [...RO].sort((a, b) => b.body.length - a.body.length).slice(0, MAX_ARTICLE_SOURCES).map((article) => ({ article, score: 2 }));
  const before = contextChars(longest, oldSnippet);
  const after = contextChars(longest, newSnippet);
  const snippetChars = longest.map(({ article }) => newSnippet(article).length);
  const extraChars = after.length - before.length;
  const extraTokens = estimateTokens(after) - estimateTokens(before);
  t.diagnostic(`bodies: ${longest.map(({ article }) => article.body.length).join(' + ')} tekens → fragmenten ${snippetChars.join(' + ')} tekens`);
  t.diagnostic(`artikelcontext: ${before.length} → ${after.length} tekens (+${extraChars}); tokens ${estimateTokens(before)} → ${estimateTokens(after)} (+${extraTokens})`);
  assert.ok(snippetChars.every((c) => c <= ARTICLE_BODY_SNIPPET_MAX_LENGTH));
  // De fragmenten samen kosten nooit meer dan 2 × ceil(1200 / 4) = 600 tokens.
  assert.ok(snippetChars.reduce((s, c) => s + estimateTokens('x'.repeat(c)), 0) <= 600);
  assert.ok(extraTokens > 0 && extraTokens <= 600, String(extraTokens));
});
