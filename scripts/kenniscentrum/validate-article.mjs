// Vaste, niet-AI-controles op een gegenereerd Avydo-artikel, vóór er een
// publicatievoorstel (Pull Request) komt. Doel: evidente fouten en
// verzonnen feiten tegenhouden, geen volledige semantische factcheck.
// Elke fout in `errors` blokkeert; `warnings` komen alleen in het voorstel.
import { categoryKeywords, audienceKeywords } from './sources.config.mjs';
import { findOverlappingArticle } from './fetch-articles.mjs';
import { normalizeSourceUrl, SourceUrlSet } from './source-records.mjs';
import { hasOwnRelevance } from '../../src/lib/news-presentation.mjs';

export const CATEGORIES = Object.keys(categoryKeywords);
export const AUDIENCES = Object.keys(audienceKeywords);
// Gelijk aan articleStatuses in src/content/config.ts (bewaakt door een test).
export const ARTICLE_STATUSES = ['voorstel', 'consultatie', 'voornemen', 'aangenomen', 'van-kracht', 'historisch', 'herzien', 'deels-geschrapt'];
export const OFFICIAL_SOURCES = {
  Belastingdienst: 'belastingdienst.nl',
  Rijksoverheid: 'rijksoverheid.nl',
  KVK: 'kvk.nl',
};

export const MIN_BODY_LENGTH = 700;
export const MIN_BODY_HEADINGS = 2;
// Vanaf deze titel-overlap met de brontitel is de titel geen eigen titel.
export const SOURCE_TITLE_SIMILARITY_LIMIT = 0.75;

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTH_RE = MONTHS.join('|');

// --- Tekstnormalisatie ---

function normalizeText(text) {
  return String(text ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// "1.250.000" → "1250000", "2,5" → "2.5", "21" → "21".
function canonicalNumber(raw) {
  let n = raw.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(n)) n = n.replace(',', '.');
  return n.replace(/\.0+$/, '');
}

const AMOUNT_RE = /€\s?(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s?(?:euro\b|miljoen\b|miljard\b)/gi;
const PERCENT_RE = /(\d[\d.,]*\d|\d)\s?(?:%|procent\b)/gi;
const DATE_RE = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`, 'gi');
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;

/** Feiten (bedragen, percentages, datums, jaartallen) in een tekst. */
export function extractFacts(text) {
  const t = normalizeText(text);
  const amounts = new Set();
  for (const m of t.matchAll(AMOUNT_RE)) amounts.add(canonicalNumber(m[1] ?? m[2]));
  const percentages = new Set();
  for (const m of t.matchAll(PERCENT_RE)) percentages.add(canonicalNumber(m[1]));
  const dates = new Set();
  for (const m of t.matchAll(DATE_RE)) dates.add(`${Number(m[1])} ${m[2]}`);
  const years = new Set();
  for (const m of t.matchAll(YEAR_RE)) years.add(m[1]);
  return { amounts, percentages, dates, years };
}

// Alle getallen in de bron (ook zonder €/%), zodat "1.500 euro" in de bron
// en "€ 1.500" in het artikel als hetzelfde bedrag gelden.
function allNumbers(text) {
  const out = new Set();
  for (const m of normalizeText(text).matchAll(/\d[\d.,]*\d|\d/g)) out.add(canonicalNumber(m[0]));
  return out;
}

/**
 * Bedragen, percentages, datums en jaartallen in het artikel die niet in de
 * brontekst voorkomen.
 */
export function findUnsupportedFacts(articleText, sourceText) {
  const a = extractFacts(articleText);
  const s = extractFacts(sourceText);
  const sourceNumbers = allNumbers(sourceText);
  const sourceNormalized = normalizeText(sourceText);
  const missing = [];
  for (const v of a.amounts) if (!s.amounts.has(v) && !sourceNumbers.has(v)) missing.push(`bedrag ${v}`);
  for (const v of a.percentages) if (!s.percentages.has(v)) missing.push(`percentage ${v}%`);
  for (const v of a.dates) if (!s.dates.has(v) && !sourceNormalized.includes(v)) missing.push(`datum ${v}`);
  for (const v of a.years) if (!s.years.has(v)) missing.push(`jaartal ${v}`);
  return missing;
}

// --- Titel ---

function titleWords(text) {
  return new Set(
    normalizeText(text)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

export function titleSimilarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  return intersection / new Set([...wa, ...wb]).size;
}

// --- Status ---

const TENTATIVE_STATUSES = new Set(['voorstel', 'consultatie', 'voornemen']);
const TENTATIVE_WORDS = /voorstel|voorgesteld|consultatie|voornemen|\bplan\b|plannen|\bwil\b|willen|nog niet|nog geen|wetsvoorstel|als het parlement|na goedkeuring|zou|zouden/i;
const IN_FORCE_CLAIM = /\b(?:is|zijn) (?:nu |inmiddels |al )?van kracht\b|\bgeldt (?:al|inmiddels|sinds)\b|\bis ingegaan\b|\bzijn ingegaan\b|\bis in werking getreden\b|\bzijn in werking getreden\b/i;
const SOURCE_TENTATIVE = /wetsvoorstel|internetconsultatie|voornemen|kabinet wil|voorgesteld/i;
const SOURCE_DEFINITIVE = /aangenomen|in werking getreden|van kracht|staatsblad|geldt sinds|is ingegaan|geldt vanaf|gaat in op/i;
const PAST_OR_PRESENT_FORCE = /\bsinds\b|\bis ingegaan\b|\bzijn ingegaan\b|\bgeldt al\b|\bis in werking getreden\b|\bgold\b/i;

function sentencesOf(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Datums in een zin die na `now` liggen (met expliciet jaar). */
function futureDatesIn(sentence, now) {
  const out = [];
  const re = new RegExp(`\\b(?:(\\d{1,2})\\s+(${MONTH_RE})\\s+)?(20\\d{2})\\b`, 'gi');
  for (const m of sentence.matchAll(re)) {
    const date = new Date(Date.UTC(Number(m[3]), m[2] ? MONTHS.indexOf(m[2].toLowerCase()) : 0, m[1] ? Number(m[1]) : 1));
    if (date.getTime() > now.getTime()) out.push(m[0]);
  }
  return out;
}

export function checkStatus(article, sourceText, now) {
  const errors = [];
  const fullText = `${article.title}\n${article.summary}\n${article.body}\n${article.relevance}`;
  if (article.status !== undefined && !ARTICLE_STATUSES.includes(article.status)) {
    errors.push(`ongeldige status "${article.status}"`);
  }
  if (TENTATIVE_STATUSES.has(article.status)) {
    if (!TENTATIVE_WORDS.test(fullText)) errors.push(`status "${article.status}", maar de tekst benoemt nergens dat het (nog) een voorstel/plan is`);
    const claim = fullText.match(IN_FORCE_CLAIM);
    if (claim) errors.push(`status "${article.status}", maar de tekst presenteert het als geldend ("${claim[0]}")`);
  }
  if ((article.status === undefined || article.status === 'van-kracht') && SOURCE_TENTATIVE.test(sourceText) && !SOURCE_DEFINITIVE.test(sourceText)) {
    errors.push('de bron beschrijft een voorstel, consultatie of voornemen, maar het artikel heeft geen voorlopige status');
  }
  for (const sentence of sentencesOf(fullText)) {
    const future = futureDatesIn(sentence, now);
    if (future.length > 0 && PAST_OR_PRESENT_FORCE.test(sentence)) {
      errors.push(`toekomstige datum (${future[0]}) beschreven alsof die al geldt: "${sentence.slice(0, 140)}"`);
    }
  }
  return errors;
}

function dutchDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// --- Hoofdcontrole ---

/**
 * @param {{title: string, summary: string, body: string, relevance: string, status?: string,
 *   category: string, audiences: string[], tags: string[]}} article
 * @param {{sourceUrl: string, sourceName: string, title: string, description?: string, body?: string,
 *   sourcePublishedAt?: string}} record
 * @param {{ now: Date, avydoArticles: Array<{file: string, title: string, category: string|null, sourceUrl: string|null}>,
 *   sourceReachable: boolean }} context
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateAvydoArticle(article, record, { now, avydoArticles, sourceReachable }) {
  const errors = [];
  const warnings = [];
  // De publicatiedatum van het bronbericht is zelf een feit uit de bron
  // ("op 1 oktober 2026 ging ... in consultatie").
  const sourceText = `${record.title ?? ''}\n${record.description ?? ''}\n${record.body ?? ''}\n${dutchDate(record.sourcePublishedAt)}`;

  // Bron
  const expectedHost = OFFICIAL_SOURCES[record.sourceName];
  if (!expectedHost) errors.push(`geen officiële bronnaam ("${record.sourceName}")`);
  let host = '';
  try {
    host = new URL(record.sourceUrl).hostname.toLowerCase();
  } catch {
    errors.push(`ongeldige bron-URL "${record.sourceUrl}"`);
  }
  if (host && expectedHost && host !== expectedHost && !host.endsWith(`.${expectedHost}`)) {
    errors.push(`bron-URL ${host} hoort niet bij ${record.sourceName}`);
  }
  if (sourceReachable !== true) errors.push('bron-URL was tijdens deze run niet bereikbaar');

  // Artikel
  const title = String(article.title ?? '').trim();
  if (title.length < 15 || title.length > 110) errors.push(`titel heeft een onlogische lengte (${title.length} tekens)`);
  if (normalizeText(title) === normalizeText(record.title)) errors.push('titel is gelijk aan de brontitel');
  else if (titleSimilarity(title, record.title) >= SOURCE_TITLE_SIMILARITY_LIMIT) errors.push('titel is vrijwel gelijk aan de brontitel');
  const summary = String(article.summary ?? '').trim();
  if (summary.length < 60 || summary.length > 400) errors.push(`samenvatting heeft een onlogische lengte (${summary.length} tekens)`);
  if (/(…|\.\.\.)$/.test(summary)) errors.push('samenvatting is afgekapt');
  const body = String(article.body ?? '');
  if (body.trim().length < MIN_BODY_LENGTH) errors.push(`artikeltekst te kort (${body.trim().length} tekens, minimaal ${MIN_BODY_LENGTH})`);
  const headings = body.match(/^## \S.*$/gm) ?? [];
  if (headings.length < MIN_BODY_HEADINGS) errors.push(`te weinig tussenkoppen (${headings.length}, minimaal ${MIN_BODY_HEADINGS})`);
  if (/^# /m.test(body)) errors.push('artikeltekst bevat een eigen hoofdtitel (#)');
  if (/<[a-z][\s\S]*?>/i.test(body)) errors.push('artikeltekst bevat HTML');
  for (const url of body.match(/https?:\/\/[^\s)]+/g) ?? []) {
    if (normalizeSourceUrl(url) !== normalizeSourceUrl(record.sourceUrl)) errors.push(`artikeltekst linkt naar een andere bron (${url})`);
  }
  const relevance = String(article.relevance ?? '').trim();
  if (!hasOwnRelevance(relevance) || relevance.length < 60) errors.push('"Wat betekent dit voor u?" ontbreekt of is te kort');
  if (!CATEGORIES.includes(article.category)) errors.push(`ongeldige categorie "${article.category}"`);
  for (const a of article.audiences ?? []) if (!AUDIENCES.includes(a)) errors.push(`ongeldige doelgroep "${a}"`);
  if ((article.tags ?? []).some((t) => typeof t !== 'string' || t.trim() === '')) errors.push('lege tag');

  // Datums
  if (record.sourcePublishedAt && new Date(record.sourcePublishedAt).getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    errors.push('publicatiedatum van de bron ligt in de toekomst');
  }

  // Feiten
  const unsupported = findUnsupportedFacts(`${title}\n${summary}\n${body}\n${relevance}`, sourceText);
  for (const fact of unsupported) errors.push(`${fact} staat niet in de brontekst`);

  // Status
  errors.push(...checkStatus({ ...article, title, summary, body, relevance }, sourceText, now));

  // Duplicaat
  if (new SourceUrlSet(avydoArticles.map((a) => a.sourceUrl).filter(Boolean)).has(record.sourceUrl)) {
    errors.push('er bestaat al een Avydo-artikel op basis van deze bron');
  }
  const overlap = findOverlappingArticle(title, article.category, avydoArticles);
  if (overlap) errors.push(`overlapt met bestaand Avydo-artikel "${overlap.title}" (${overlap.file})`);

  if ((article.tags ?? []).length === 0) warnings.push('geen tags');
  if ((article.audiences ?? []).length === 0) warnings.push('geen doelgroep');

  // `overlap` (of null) naast de foutmelding, zodat de redactiestap de bron
  // als "al gedekt" kan vastleggen en het overlappende artikel kan loggen.
  return { ok: errors.length === 0, errors, warnings, overlap: overlap ?? null };
}
