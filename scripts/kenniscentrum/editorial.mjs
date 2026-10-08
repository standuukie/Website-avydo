// Redactiestap van de dagelijkse Kenniscentrum-run:
//
//   bronlaag → selectie (select-topics.mjs) → Avydo-artikel (AI, hieronder)
//   → vaste validatie (validate-article.mjs) → artikel + bijgewerkt bronrecord
//
// Alleen een artikel dat alle controles doorstaat wordt geschreven. De
// GitHub Action zet het resultaat in een Pull Request; zonder geslaagd
// artikel komt er geen Pull Request.
//
// De AI-aanroep bouwt voort op de eerdere aiSummary(): dezelfde directe
// Messages API-aanroep, maar met een verplichte tool en JSON-schema
// (hetzelfde patroon als src/lib/ai-providers/anthropic.ts), zodat de output
// gestructureerd is in plaats van uit vrije tekst gevist.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadExistingArticlesMeta, slugify } from './fetch-articles.mjs';
import { readSourceRecords, updateSourceRecord } from './source-records.mjs';
import { selectTopics } from './select-topics.mjs';
import { validateAvydoArticle, CATEGORIES, AUDIENCES, ARTICLE_STATUSES } from './validate-article.mjs';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const API_TIMEOUT_MS = 90000;
const SOURCE_CHECK_TIMEOUT_MS = 15000;
// Bovengrens op de brontekst in de prompt (de extractie kapt al af op 8000).
const MAX_SOURCE_CHARS = 9000;

export const PR_SOURCE_MARKER = 'kenniscentrum-bron';

// --- Openstaande of afgewezen redactievoorstellen ---

/**
 * Bron-URL's uit eerdere redactie-PR's die niet zijn gemerged (open of
 * gesloten). Een gesloten PR is een menselijke afwijzing: die bron wordt
 * niet opnieuw voorgesteld. Gemergde PR's staan al in de repository.
 * @param {string | undefined} file JSON van `gh pr list --json headRefName,body,mergedAt`
 */
export function readPendingSourceUrls(file) {
  if (!file || !existsSync(file)) return [];
  let prs;
  try {
    prs = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  return parsePendingSourceUrls(prs);
}

export function parsePendingSourceUrls(prs) {
  const urls = [];
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (pr.mergedAt) continue;
    if (!String(pr.headRefName ?? '').startsWith('kenniscentrum/')) continue;
    for (const m of String(pr.body ?? '').matchAll(new RegExp(`<!-- ${PR_SOURCE_MARKER}: (\\S+) -->`, 'g'))) urls.push(m[1]);
  }
  return urls;
}

// --- Prompt en AI-aanroep ---

const ARTICLE_TOOL = {
  name: 'avydo_artikel',
  description: 'Lever het Avydo-artikel op, of geef aan dat de bron onvoldoende informatie bevat.',
  input_schema: {
    type: 'object',
    properties: {
      voldoendeInformatie: { type: 'boolean', description: 'false als de brontekst te weinig concrete informatie bevat voor een betrouwbaar artikel' },
      redenOnvoldoende: { type: 'string', description: 'Alleen bij voldoendeInformatie=false: waarom.' },
      title: { type: 'string', description: 'Eigen titel, 30-90 tekens, niet de brontitel.' },
      summary: { type: 'string', description: 'Eigen samenvatting in 1-2 zinnen, 80-300 tekens.' },
      body: { type: 'string', description: 'Artikeltekst in markdown met ## tussenkoppen, zonder # hoofdtitel en zonder links.' },
      relevance: { type: 'string', description: '"Wat betekent dit voor u?": 1-3 zinnen; de eerste zin draagt de kern.' },
      status: { type: 'string', enum: ['geen', ...ARTICLE_STATUSES], description: 'Fase volgens de bron; "geen" voor geldende, gewone informatie.' },
      category: { type: 'string', enum: CATEGORIES },
      audiences: { type: 'array', items: { type: 'string', enum: AUDIENCES } },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
    required: ['voldoendeInformatie', 'title', 'summary', 'body', 'relevance', 'status', 'category', 'audiences', 'tags'],
  },
};

function formatDate(value) {
  if (!value) return 'onbekend';
  return new Date(value).toISOString().slice(0, 10);
}

export function buildArticlePrompt(record, kind, now) {
  const sourceText = String(record.body ?? '').slice(0, MAX_SOURCE_CHARS);
  const soort = kind === 'gids'
    ? 'een blijvend bruikbare uitleg (gids) voor ondernemers'
    : 'een actueel nieuws-/wijzigingsartikel (toelichting)';
  return `Je bent redacteur van het Kenniscentrum van Avydo Accountants & Belastingadviseurs. Schrijf ${soort} op basis van UITSLUITEND de officiële bron hieronder. Vandaag is ${formatDate(now)}.

Het is een eigen Avydo-artikel, geen samenvatting of kopie van de bron: leg in eigen woorden en in begrijpelijk Nederlands (u-vorm) uit
- wat er gebeurt of wat de regel is;
- waarom dit relevant is en voor wie;
- wat ondernemers moeten weten of doen;
- wat de huidige status is.
Gebruik duidelijke tussenkoppen (##). Kort is goed als de bron weinig zegt; minimaal ongeveer 150 woorden.

STRIKTE REGELS
- Gebruik alleen informatie uit de brontekst. Voeg geen algemene kennis toe alsof die uit de bron komt.
- Noem geen bedragen, percentages, datums of jaartallen die niet letterlijk in de brontekst staan.
- Een voorstel, consultatie of voornemen is geen geldende regel: benoem de fase expliciet ("het kabinet wil", "voorgesteld", "nog niet van kracht").
- Een toekomstige wijziging beschrijf je in de toekomende tijd ("gaat gelden per ..."), nooit als iets dat al geldt.
- Presenteer gevolgen niet als feit als de bron dat niet zegt; formuleer voorzichtig ("kan gevolgen hebben voor").
- Geen links, geen HTML, geen hoofdtitel (#) in de tekst.
- Kies status "geen" alleen voor gewone, geldende informatie.
- Bevat de bron te weinig concrete informatie: zet voldoendeInformatie op false.

BRON
Organisatie: ${record.sourceName}
Titel van de bron: ${record.title}
Publicatiedatum: ${formatDate(record.sourcePublishedAt)}${record.sourceLastModified ? `\nLaatst gewijzigd: ${formatDate(record.sourceLastModified)}` : ''}
URL: ${record.sourceUrl}

BRONTEKST
${sourceText}`;
}

/**
 * Laat het Avydo-artikel schrijven. Geeft { ok: true, article } of
 * { ok: false, reason } — nooit een exception.
 */
export async function generateAvydoArticle(record, kind, { apiKey, now, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  if (!apiKey) return { ok: false, reason: 'ANTHROPIC_API_KEY ontbreekt; geen artikel gegenereerd' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        tools: [ARTICLE_TOOL],
        tool_choice: { type: 'tool', name: ARTICLE_TOOL.name },
        messages: [{ role: 'user', content: buildArticlePrompt(record, kind, now) }],
      }),
    });
    if (!res.ok) return { ok: false, reason: `AI-aanroep mislukt (HTTP ${res.status})` };
    const data = await res.json();
    const input = data?.content?.find((c) => c.type === 'tool_use' && c.name === ARTICLE_TOOL.name)?.input;
    if (!input || typeof input !== 'object') return { ok: false, reason: 'AI-respons bevat geen gestructureerd artikel' };
    if (input.voldoendeInformatie !== true) {
      return { ok: false, reason: `bron bevat onvoldoende informatie${input.redenOnvoldoende ? `: ${input.redenOnvoldoende}` : ''}` };
    }
    return {
      ok: true,
      article: {
        title: String(input.title ?? '').trim(),
        summary: String(input.summary ?? '').trim(),
        body: String(input.body ?? '').trim(),
        relevance: String(input.relevance ?? '').trim(),
        status: input.status === 'geen' ? undefined : input.status,
        category: input.category,
        audiences: Array.isArray(input.audiences) ? [...new Set(input.audiences)] : [],
        tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6) : [],
      },
    };
  } catch (err) {
    return { ok: false, reason: `AI-aanroep mislukt (${err.name === 'AbortError' ? 'time-out' : err.message})` };
  } finally {
    clearTimeout(timer);
  }
}

// --- Bronlink-controle ---

export async function checkSourceReachable(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- Artikel schrijven ---

// JSON-strings zijn geldige YAML-strings tussen dubbele aanhalingstekens.
const q = (value) => JSON.stringify(String(value));

export function renderArticleMarkdown(article, record, kind, now) {
  const lines = [
    '---',
    `title: ${q(article.title)}`,
    `category: ${q(article.category)}`,
    `priority: ${q(record.priority ?? 'praktisch')}`,
    `publishedAt: ${now.toISOString()}`,
    `sourceName: ${q(record.sourceName)}`,
    `sourceUrl: ${q(record.sourceUrl)}`,
  ];
  if (record.sourcePublishedAt) lines.push(`sourcePublishedAt: ${new Date(record.sourcePublishedAt).toISOString()}`);
  lines.push(
    `summary: ${q(article.summary)}`,
    `relevance: ${q(article.relevance)}`,
    `tags: [${article.tags.map(q).join(', ')}]`,
    `audiences: [${article.audiences.map(q).join(', ')}]`,
    'featured: false',
    'hidden: false',
    'aiAssisted: true',
  );
  if (article.status) lines.push(`status: ${q(article.status)}`);
  lines.push(`avydoContent: ${q(kind)}`, '---', '', article.body.trim(), '');
  return lines.join('\n');
}

export function articleSlug(article, now, contentDir) {
  const base = `${now.toISOString().slice(0, 10)}-${slugify(article.title)}`;
  let slug = base;
  for (let n = 2; existsSync(path.join(contentDir, `${slug}.md`)); n += 1) slug = `${base}-${n}`;
  return slug;
}

// --- Pull Request-tekst ---

const STATUS_TEXT = {
  voorstel: 'voorstel', consultatie: 'consultatie', voornemen: 'voornemen', aangenomen: 'aangenomen, nog niet in werking',
  'van-kracht': 'van kracht', historisch: 'historisch', herzien: 'herzien', 'deels-geschrapt': 'deels geschrapt',
};

export function buildPullRequest(created, summary, now) {
  const date = now.toISOString().slice(0, 10);
  const title = created.length === 1
    ? `Kenniscentrum: Avydo-artikel "${created[0].article.title}"`
    : `Kenniscentrum: ${created.length} Avydo-artikelen (${date})`;
  const parts = [
    `Automatisch redactievoorstel voor het Kenniscentrum van ${date}.`,
    '',
    '> Deze artikelen zijn automatisch door de Avydo-redactiepipeline geschreven op basis van één officiële bron per artikel, en daarna met vaste controles gevalideerd. **Lees ze na vóór het mergen**: pas na de merge staan ze live.',
    '',
  ];
  for (const c of created) {
    parts.push(
      `## ${c.article.title}`,
      '',
      `- **Bestand:** \`src/content/kenniscentrum/${c.slug}.md\``,
      `- **Soort:** ${c.kind === 'gids' ? 'gids (blijvende uitleg)' : 'toelichting (actueel / wijziging)'}`,
      `- **Officiële bron:** ${c.record.sourceName} — [${c.record.title}](${c.record.sourceUrl})`,
      `- **Datum bron:** ${c.record.sourcePublishedAt ? formatDate(c.record.sourcePublishedAt) : c.record.sourceLastModified ? `laatst gewijzigd ${formatDate(c.record.sourceLastModified)}` : 'onbekend'}`,
      `- **Waarom gekozen:** ${c.reason}`,
      `- **Status:** ${c.article.status ? STATUS_TEXT[c.article.status] : 'geen (gewone, geldende informatie)'}`,
      `- **Categorie / doelgroepen:** ${c.article.category} / ${c.article.audiences.join(', ') || '—'}`,
      `- **Validatie:** alle vaste controles geslaagd${c.validation.warnings.length ? ` (aandachtspunten: ${c.validation.warnings.join('; ')})` : ''}`,
      '',
      `<!-- ${PR_SOURCE_MARKER}: ${c.record.sourceUrl} -->`,
      '',
    );
  }
  parts.push(
    '## Controles',
    '',
    'Bron officieel en bereikbaar · eigen titel (niet de brontitel) · samenvatting, tussenkoppen en duiding aanwezig · bedragen, percentages, datums en jaartallen komen in de brontekst voor · status past bij de bron (een voorstel staat niet als geldende regel) · geen overlap met bestaande Avydo-artikelen.',
    '',
    `Selectie deze run: ${summary.candidates} kandidaat/kandidaten bekeken, ${summary.selected} gekozen, ${summary.failed.length} niet doorgegaan.`,
  );
  if (summary.failed.length) {
    parts.push('', 'Niet doorgegaan:', ...summary.failed.map((f) => `- ${f.title}: ${f.reason}`));
  }
  return { title, body: `${parts.join('\n')}\n` };
}

// --- Orkestratie ---

/**
 * @returns {Promise<{ created: Array<object>, summary: object, pullRequest: {title: string, body: string} | null }>}
 */
export async function runEditorialPipeline({
  contentDir, sourcesDir, now = new Date(), apiKey, pendingSourceUrls = [], log = () => {},
  model = process.env.KENNISCENTRUM_MODEL || DEFAULT_MODEL, fetchImpl = fetch,
}) {
  const records = readSourceRecords(sourcesDir);
  const avydoArticles = loadExistingArticlesMeta(contentDir);
  const { selected, rejected, deferred, noTopicReason } = selectTopics(records, { now, avydoArticles, pendingSourceUrls });
  const candidates = records.filter((r) => r.processingStatus === 'kandidaat').length;

  // Blijvend ongeschikte kandidaten worden afgewezen (met reden), zodat ze
  // niet elke run opnieuw beoordeeld worden.
  for (const { record, reason } of rejected) {
    updateSourceRecord(sourcesDir, record.sourceUrl, { processingStatus: 'afgewezen', rejectionReason: reason });
  }
  log(`${candidates} kandidaat-bron(nen); ${selected.length} gekozen, ${rejected.length} afgewezen, ${deferred.length} uitgesteld`);
  for (const { record, reason } of rejected) log(`  - afgewezen: ${record.title} — ${reason}`);
  for (const { record, reason } of deferred) log(`  · uitgesteld: ${record.title} — ${reason}`);

  const created = [];
  const failed = [];
  for (const { record, kind, tier, reason } of selected) {
    log(`  > gekozen (groep ${tier}, ${kind}): ${record.title} — ${reason}`);
    const sourceReachable = await checkSourceReachable(record.sourceUrl, fetchImpl);
    const generated = await generateAvydoArticle(record, kind, { apiKey, now, model, fetchImpl });
    if (!generated.ok) {
      log(`    geen artikel: ${generated.reason}`);
      failed.push({ title: record.title, reason: generated.reason });
      continue;
    }
    const validation = validateAvydoArticle(generated.article, record, { now, avydoArticles, sourceReachable });
    if (!validation.ok) {
      log(`    validatie mislukt, geen publicatievoorstel:\n${validation.errors.map((e) => `      · ${e}`).join('\n')}`);
      failed.push({ title: record.title, reason: `validatie mislukt: ${validation.errors.join('; ')}` });
      continue;
    }
    mkdirSync(contentDir, { recursive: true });
    const slug = articleSlug(generated.article, now, contentDir);
    writeFileSync(path.join(contentDir, `${slug}.md`), renderArticleMarkdown(generated.article, record, kind, now), 'utf8');
    updateSourceRecord(sourcesDir, record.sourceUrl, { processingStatus: 'verwerkt', avydoSlug: slug, rejectionReason: undefined });
    avydoArticles.push({ file: `${slug}.md`, title: generated.article.title, category: generated.article.category, sourceUrl: record.sourceUrl });
    created.push({ slug, record, kind, reason, article: generated.article, validation });
    log(`    + artikel ${slug}.md`);
  }

  if (created.length === 0) {
    log(`Geen artikel vandaag: ${noTopicReason ?? 'geen van de gekozen onderwerpen leverde een gevalideerd artikel op'}.`);
  }
  const summary = {
    candidates,
    selected: selected.length,
    rejected: rejected.length,
    deferred: deferred.length,
    created: created.map((c) => ({ slug: c.slug, title: c.article.title, sourceUrl: c.record.sourceUrl, kind: c.kind, status: c.article.status ?? null })),
    failed,
    noArticleReason: created.length === 0 ? (noTopicReason ?? 'generatie of validatie mislukt') : null,
  };
  return { created, summary, pullRequest: created.length > 0 ? buildPullRequest(created, summary, now) : null };
}
