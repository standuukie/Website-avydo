// Expliciete alias voor de samenstelling "arbeidsongeschiktheidsverzekering"
// (QUERY_ALIASES in src/lib/knowledge-match.mjs).
//
// Getest wordt met de ECHTE matchinglogica en de ECHTE content: kennisbank
// (src/data/ai-knowledge/), Kenniscentrum-artikelen (src/content/
// kenniscentrum/) en de Belastingkalender-bron (src/data/belastingkalender.ts).
// De regressietest onderaan neemt alle bestaande retrievalvragen uit de
// andere testbestanden en eist dat hun score op ELK document gelijk blijft
// aan pure exacte-tokenscoring — gelijke scores betekent een ongewijzigde
// bronselectie voor kennisitems, artikelen, deadlines en de deterministische
// fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_RELEVANCE_SCORE,
  overlapScore,
  scoreKnowledgeItem,
  tokenize,
  retrieveKnowledgeItems,
  findDeterministicFallbackItem,
} from '../../src/lib/knowledge-match.mjs';
import { formatSourcesForPrompt, rankScoredArticles } from '../../src/lib/source-freshness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ALIAS = 'arbeidsongeschiktheidsverzekering';
const AOV_VRAAG = 'Hoe zit het met de arbeidsongeschiktheidsverzekering voor zelfstandigen?';
const B = 'https://www.rijksoverheid.nl/actueel/nieuws/';
const URL_AOV_OUD = `${B}2025/09/12/wetsvoorstel-voor-basisverzekering-arbeidsongeschiktheid-voor-zelfstandigen-naar-de-raad-van-state`;
const URL_AOV_NIEUW = `${B}2026/03/13/kabinet-komt-met-betaalbare-basisverzekering-voor-zelfstandigen-bij-arbeidsongeschiktheid`;

// --- Echte kennisbank (zelfde tekstuele lader als deterministic-guardrail.test.mjs) ---

const KB_FILES = ['ondernemingsvormen.ts', 'administratie.ts', 'btw.ts', 'inkomstenbelasting.ts', 'bv-dga.ts', 'personeel.ts'];

function extractItems(text) {
  const blocks = text.split(/\n {2}\{\n/).slice(1).map((block) => block.split(/\n {2}\},?\n/)[0]);
  return blocks.map((block) => {
    const id = block.match(/id: '([^']+)'/)?.[1] ?? '';
    const category = block.match(/category: '([^']*)'/)?.[1] ?? '';
    const contentMatch = block.match(/content:\s*\n?\s*'((?:[^'\\]|\\.)*)'/);
    const content = contentMatch ? contentMatch[1].replace(/\\'/g, "'") : '';
    const tagsMatch = block.match(/tags:\s*\[([\s\S]*?)\],\n\s*priority/);
    const tags = tagsMatch ? [...tagsMatch[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")) : [];
    const titleMatch = block.match(/title: '((?:[^'\\]|\\.)*)'/);
    const title = titleMatch ? titleMatch[1].replace(/\\'/g, "'") : '';
    const priority = Number(block.match(/priority: (\d)/)?.[1] ?? 1);
    const deterministicFallback = /deterministicFallback: true/.test(block);
    return { id, title, category, content, tags, priority, deterministicFallback };
  });
}

const KB = KB_FILES.flatMap((file) => extractItems(readFileSync(path.join(ROOT, 'src/data/ai-knowledge', file), 'utf-8')));

// --- Echte artikelen (zelfde lader en artikelstap als source-freshness.test.mjs) ---

const CONTENT_DIR = path.join(ROOT, 'src/content/kenniscentrum');
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
    };
  });
const articleText = (a) => `${a.title} ${a.summary} ${a.category} ${a.tags.join(' ')}`;

function retrieveArticleSources(query, max = 2) {
  const queryTokens = tokenize(query);
  const ranked = rankScoredArticles(
    ARTICLES.filter((a) => !a.hidden)
      .map((article) => ({
        article,
        score: overlapScore(queryTokens, articleText(article)),
        publishedAt: article.publishedAt,
        sourceUrl: article.sourceUrl,
        supersededBy: article.supersededBy,
      }))
      .filter((x) => x.score >= MIN_RELEVANCE_SCORE),
  );
  return ranked.slice(0, max).map(({ article, score }, i) => ({
    id: i + 1,
    name: `Kenniscentrum Avydo (bron: ${article.sourceName})`,
    title: article.title,
    url: article.sourceUrl,
    snippet: `${article.summary} ${article.relevance}`.slice(0, 500),
    publishedAt: article.publishedAt,
    superseded: Boolean(article.supersededBy),
    score,
  }));
}

// Belastingkalender: de deadlines worden in TypeScript opgebouwd; voor de
// scoringsvergelijking volstaat elke bronregel als losse tekst (dekt alle
// woorden waaruit deadline-titels/-omschrijvingen bestaan).
const DEADLINE_LINES = readFileSync(path.join(ROOT, 'src/data/belastingkalender.ts'), 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0);

// Referentie: de exacte-tokenscoring zoals overlapScore() vóór de alias.
function exactOverlap(queryTokens, text) {
  const tokens = new Set(tokenize(text));
  return queryTokens.filter((q) => tokens.has(q)).length;
}

// --- Eenheidstests van de alias ---

test('tokenizer en drempel ongewijzigd: de samenstelling blijft één token, MIN_RELEVANCE_SCORE blijft 2', () => {
  assert.deepEqual(tokenize(AOV_VRAAG), ['zit', ALIAS, 'zelfstandigen']);
  assert.equal(MIN_RELEVANCE_SCORE, 2);
});

test('alias: beide vereiste termen aanwezig (zonder het letterlijke woord) → precies 1 punt', () => {
  assert.equal(overlapScore([ALIAS], 'Basisverzekering bij arbeidsongeschiktheid'), 1);
});

test('alias: alleen "arbeidsongeschiktheid" zonder "basisverzekering" → geen aliaspunt', () => {
  assert.equal(overlapScore([ALIAS], 'Uitkering bij arbeidsongeschiktheid voor zelfstandigen'), 0);
});

test('alias: alleen "basisverzekering" zonder "arbeidsongeschiktheid" → geen aliaspunt', () => {
  assert.equal(overlapScore([ALIAS], 'Een basisverzekering voor zelfstandigen'), 0);
});

test('alias: alleen "verzekering" in de vraag krijgt nooit een aliaspunt', () => {
  assert.equal(overlapScore(['verzekering'], 'Basisverzekering bij arbeidsongeschiktheid'), 0);
  assert.equal(overlapScore(tokenize('Welke verzekering heb ik nodig?'), 'Basisverzekering bij arbeidsongeschiktheid'), 0);
});

test('alias: een andere samenstelling ("arbeidsongeschiktheidsuitkering") krijgt geen aliaspunt', () => {
  assert.equal(overlapScore(['arbeidsongeschiktheidsuitkering'], 'Basisverzekering bij arbeidsongeschiktheid'), 0);
});

test('geen scoreopblazing: één aliasvraagwoord levert maximaal 1 punt, ook als het letterlijke woord én beide termen in de tekst staan', () => {
  assert.equal(overlapScore([ALIAS], 'arbeidsongeschiktheidsverzekering basisverzekering arbeidsongeschiktheid'), 1);
  assert.equal(overlapScore([ALIAS], 'arbeidsongeschiktheidsverzekering'), 1);
  // De vraag bevat alleen de samenstelling: de componenten tellen niet elk apart mee.
  assert.equal(overlapScore(tokenize(AOV_VRAAG), 'Basisverzekering bij arbeidsongeschiktheid'), 1);
  assert.equal(overlapScore(tokenize(AOV_VRAAG), 'Basisverzekering bij arbeidsongeschiktheid voor zelfstandigen'), 2);
});

test('alias werkt alleen op hele tokens: "basisverzekeringen" of een streepjesvariant van de vraag tellen niet als vereiste term', () => {
  assert.equal(overlapScore([ALIAS], 'basisverzekeringen bij arbeidsongeschiktheid'), 0);
  assert.equal(overlapScore(tokenize('arbeidsongeschiktheids-verzekering'), 'Basisverzekering bij arbeidsongeschiktheid'), 0);
});

// --- Positief: het AOV-dossier ---

test(`positief — "${AOV_VRAAG}": beide Rijksoverheid-artikelen, 13-03-2026 vóór 12-09-2025, de oude herkenbaar historisch`, () => {
  const sources = retrieveArticleSources(AOV_VRAAG);
  assert.deepEqual(sources.map((s) => s.url), [URL_AOV_NIEUW, URL_AOV_OUD]);
  assert.deepEqual(sources.map((s) => s.score), [2, 2]);
  assert.equal(sources[0].superseded, false);
  assert.equal(sources[1].superseded, true);
  const prompt = formatSourcesForPrompt(sources);
  assert.ok(prompt.includes('(bron: Rijksoverheid, 13-03-2026)'));
  assert.ok(prompt.includes('(bron: Rijksoverheid, 12-09-2025, historisch)'));
});

test('positief — zonder de alias haalden de AOV-artikelen de drempel niet (alleen "zelfstandigen" matcht exact)', () => {
  const qt = tokenize(AOV_VRAAG);
  for (const url of [URL_AOV_NIEUW, URL_AOV_OUD]) {
    const article = ARTICLES.find((a) => a.sourceUrl === url);
    assert.equal(exactOverlap(qt, articleText(article)), 1);
    assert.equal(overlapScore(qt, articleText(article)), 2);
  }
});

for (const query of [
  'Komt er een verplichte basisverzekering arbeidsongeschiktheid voor zelfstandigen?',
  'Wanneer komt de basisverzekering voor zelfstandigen bij arbeidsongeschiktheid?',
]) {
  test(`positief — bestaande formulering blijft gelijk: "${query}"`, () => {
    const sources = retrieveArticleSources(query);
    assert.deepEqual(sources.map((s) => s.url), [URL_AOV_NIEUW, URL_AOV_OUD]);
    assert.deepEqual(sources.map((s) => s.superseded), [false, true]);
  });
}

// --- Negatief ---

test('negatief — "Krijg ik een arbeidsongeschiktheidsuitkering als zzp\'er?" haalt de basisverzekering-artikelen niet op', () => {
  const urls = retrieveArticleSources("Krijg ik een arbeidsongeschiktheidsuitkering als zzp'er?").map((s) => s.url);
  assert.equal(urls.includes(URL_AOV_NIEUW), false);
  assert.equal(urls.includes(URL_AOV_OUD), false);
});

test('negatief — de alias kan alleen de twee AOV-artikelen raken: geen ander artikel, kennisitem of deadline bevat beide vereiste termen', () => {
  const hasBoth = (text) => {
    const t = new Set(tokenize(text));
    return t.has('arbeidsongeschiktheid') && t.has('basisverzekering');
  };
  assert.deepEqual(
    ARTICLES.filter((a) => !a.hidden && hasBoth(articleText(a))).map((a) => a.sourceUrl).sort(),
    [URL_AOV_OUD, URL_AOV_NIEUW].sort(),
  );
  assert.deepEqual(KB.filter((i) => hasBoth(`${i.title} ${i.tags.join(' ')} ${i.category} ${i.content}`)).map((i) => i.id), []);
  assert.equal(hasBoth(DEADLINE_LINES.join(' ')), false);
});

// --- Kennisitems ---

test('kennisitems — de bestaande tagmatch van "bedrijfsverzekeringen" blijft werken, met dezelfde score en positie', () => {
  const qt = tokenize(AOV_VRAAG);
  const item = KB.find((i) => i.id === 'bedrijfsverzekeringen');
  assert.ok(item.tags.includes(ALIAS));
  const reference = exactOverlap(qt, `${item.title} ${item.tags.join(' ')}`) * 2 + exactOverlap(qt, `${item.category} ${item.content}`);
  assert.equal(scoreKnowledgeItem(qt, item), reference);
  assert.ok(reference >= MIN_RELEVANCE_SCORE);
  assert.deepEqual(retrieveKnowledgeItems(AOV_VRAAG, KB, { maxItems: 2 }).map((i) => i.id), ['bedrijfsverzekeringen']);
  assert.deepEqual(retrieveKnowledgeItems('Wat is een arbeidsongeschiktheidsverzekering?', KB, { maxItems: 2 }).map((i) => i.id), ['bedrijfsverzekeringen']);
});

test('kennisitems — voor de aliasvraag scoort elk kennisitem exact gelijk aan pure exacte-tokenscoring', () => {
  const qt = tokenize(AOV_VRAAG);
  for (const item of KB) {
    const reference = exactOverlap(qt, `${item.title} ${item.tags.join(' ')}`) * 2 + exactOverlap(qt, `${item.category} ${item.content}`);
    assert.equal(scoreKnowledgeItem(qt, item), reference, item.id);
  }
});

// --- Deterministische fallback ---

test('deterministische fallback — de aliasvragen geven geen (nieuw) deterministisch antwoord', () => {
  for (const query of [AOV_VRAAG, 'Wat is een arbeidsongeschiktheidsverzekering?', "Krijg ik een arbeidsongeschiktheidsuitkering als zzp'er?"]) {
    assert.equal(findDeterministicFallbackItem(query, KB), null, query);
  }
});

// --- Regressie: alle bestaande retrievalvragen ---

const EXISTING_QUESTIONS = (() => {
  const questions = new Set();
  const self = path.basename(fileURLToPath(import.meta.url));
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs') && f !== self)) {
    const text = readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of text.matchAll(/['"`]([A-Z][^'"`\n${}]{10,160}\?)['"`]/g)) questions.add(m[1]);
  }
  return [...questions];
})();

test('regressie — de verzameling bestaande retrievalvragen is compleet (minimaal 151) en bevat de aliassleutel niet (alias kan hun scores dus niet raken)', () => {
  assert.ok(EXISTING_QUESTIONS.length >= 151, `slechts ${EXISTING_QUESTIONS.length} vragen gevonden`);
  const withAlias = EXISTING_QUESTIONS.filter((q) => tokenize(q).includes(ALIAS));
  assert.deepEqual(withAlias, []);
});

test('regressie — voor alle bestaande retrievalvragen is elke score gelijk aan pure exacte-tokenscoring (kennisitems, artikelen, deadlines, fallback)', () => {
  const texts = [
    ...KB.flatMap((i) => [`${i.title} ${i.tags.join(' ')}`, `${i.category} ${i.content}`, i.title]),
    ...ARTICLES.map(articleText),
    ...DEADLINE_LINES,
  ];
  let comparisons = 0;
  for (const query of EXISTING_QUESTIONS) {
    const qt = tokenize(query);
    for (const text of texts) {
      assert.equal(overlapScore(qt, text), exactOverlap(qt, text), `${query} | ${text.slice(0, 60)}`);
      comparisons += 1;
    }
  }
  assert.ok(comparisons > 0);
});

test('regressie — bronselectie van kennisitems en artikelen voor alle bestaande retrievalvragen gelijk aan exacte-tokenselectie', () => {
  const exactKnowledge = (query) => {
    const qt = tokenize(query);
    if (qt.length === 0) return [];
    return KB.map((item) => ({ item, score: exactOverlap(qt, `${item.title} ${item.tags.join(' ')}`) * 2 + exactOverlap(qt, `${item.category} ${item.content}`) }))
      .filter((x) => x.score >= MIN_RELEVANCE_SCORE)
      .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority)
      .slice(0, 2)
      .map((x) => x.item.id);
  };
  const exactArticles = (query) => {
    const qt = tokenize(query);
    return rankScoredArticles(
      ARTICLES.filter((a) => !a.hidden)
        .map((a) => ({ a, score: exactOverlap(qt, articleText(a)), publishedAt: a.publishedAt, sourceUrl: a.sourceUrl, supersededBy: a.supersededBy }))
        .filter((x) => x.score >= MIN_RELEVANCE_SCORE),
    )
      .slice(0, 2)
      .map((x) => x.sourceUrl);
  };
  for (const query of EXISTING_QUESTIONS) {
    assert.deepEqual(retrieveKnowledgeItems(query, KB, { maxItems: 2 }).map((i) => i.id), exactKnowledge(query), query);
    assert.deepEqual(retrieveArticleSources(query).map((s) => s.url), exactArticles(query), query);
  }
});
