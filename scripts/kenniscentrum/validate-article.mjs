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

// --- Brongetrouwheid (generiek) ---
//
// Deterministische hulpcontroles naast de prompt (die de inhoudelijke
// sturing draagt). Ze leveren aandachtspunten (warnings) voor de redacteur
// in de Pull Request en blokkeren niet: zonder semantiek is niet zeker vast
// te stellen of een claim of weglating door de bron gedragen wordt (zo is
// "dit is de geldende regel" bij een geverifieerde status juist correct).

// Actualiteits-/statusclaims die alleen mogen als de bron ze zelf doet.
const CURRENCY_CLAIMS = [
  /\bgeldt (?:momenteel|op dit moment|nu|thans)\b/gi,
  /\b(?:is|zijn) (?:momenteel|op dit moment|thans) (?:van kracht|geldig|actueel|van toepassing)\b/gi,
  /\bgeldende (?:regelgeving|wetgeving|regels?)\b/gi,
  /\b(?:is|zijn) (?:nog steeds |nog altijd )?actueel\b/gi,
];

/** Actualiteits-/statusclaims in het artikel die de bron niet zelf maakt. */
export function findUnsupportedCurrencyClaims(articleText, sourceText) {
  const source = normalizeText(sourceText);
  const text = normalizeText(articleText);
  const found = [];
  for (const re of CURRENCY_CLAIMS) {
    for (const m of text.matchAll(re)) {
      // Een ontkenning ("nog geen geldende regel", "niet actueel") is geen claim.
      if (/\b(?:geen|niet)\s+(?:\S+\s+)?$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
      if (!source.includes(m[0]) && !found.includes(m[0])) found.push(m[0]);
    }
  }
  return found;
}

const DETAIL_STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'of', 'van', 'voor', 'met', 'bij', 'op', 'aan', 'in', 'te', 'die', 'dat', 'dit',
  'deze', 'als', 'om', 'naar', 'over', 'uit', 'niet', 'ook', 'wel', 'zijn', 'is', 'wordt', 'worden', 'kan',
  'moet', 'moeten', 'hun', 'zij', 'je', 'u', 'uw', 'er', 'dan', 'wanneer', 'waarvan', 'waarbij', 'mits',
  'tenzij', 'indien', 'alleen', 'hebben', 'heeft', 'jaar', 'per', 'tot', 'nog', 'al', 'meer', 'minder',
]);

// Grove Nederlandse stam: meervoud eraf en dubbele klinkers samen, zodat
// "rechtspersoon"/"rechtspersonen" en "eenmanszaak"/"eenmanszaken" gelijk zijn.
function detailStem(word) {
  let w = word;
  if (w.length > 6 && w.endsWith('en')) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith('s')) w = w.slice(0, -1);
  return w.replace(/([aeou])\1/g, '$1');
}

function significantWords(text) {
  return normalizeText(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !DETAIL_STOPWORDS.has(w))
    .map(detailStem);
}

// Een bijzin/voorwaarde na een zelfstandig naamwoordgroep:
// "<groep> die/waarvan/mits/tenzij/indien/als/wanneer <voorwaarde>".
const QUALIFIER_RE = /(?<![\p{L}\d])([^.;:\n]{6,90}?)\s+(die|waarvan|waarbij|mits|tenzij|indien|als|wanneer|alleen als)\s+([^.;\n]{8,200})/giu;

/**
 * Groepen of regels die in de bron een voorwaarde hebben, maar in het
 * artikel zonder die voorwaarde terugkomen (verbreding).
 */
export function findDroppedQualifiers(articleText, sourceText) {
  const sentences = sentencesOf(articleText).map((s) => new Set(significantWords(s)));
  const out = [];
  for (const line of String(sourceText ?? '').split(/\n+|(?<=[.;])\s+/)) {
    for (const m of line.matchAll(QUALIFIER_RE)) {
      // Een aankondiging van een opsomming ("aan de volgende voorwaarden:")
      // is zelf geen voorwaarde; de opsomming erna wordt los bekeken.
      if (/:\s*$/.test(m[3])) continue;
      const head = significantWords(m[1]).slice(-3);
      const qualifier = [...new Set(significantWords(m[3]))].filter((w) => w.length > 4);
      if (head.length < 2 || qualifier.length < 2) continue;
      const hits = sentences.filter((words) => head.every((w) => words.has(w)));
      if (hits.length === 0) continue;
      // Behouden = minstens de helft van de inhoudswoorden van de voorwaarde
      // staat in dezelfde zin.
      const kept = hits.some((words) => qualifier.filter((w) => words.has(w)).length * 2 >= qualifier.length);
      if (!kept) out.push(`${m[1].trim()} ${m[2]} ${m[3].trim()}`.replace(/^[-•*]\s*/, '').replace(/\s+/g, ' ').slice(0, 160));
    }
  }
  return [...new Set(out)];
}

const LEGAL_REF_RE = /\bartikel\s+\d+[a-z]?(?:[.:]\d+[a-z]?)*(?:\s+lid\s+\d+)?(?:\s+(?:van\s+)?(?:het|de))?\s+(?:burgerlijk wetboek|bw|wet\s+[a-z][a-z -]{2,40}?|awr|awb)\b/gi;
const DEADLINE_RE = /\bbinnen\s+(\d+|een|twee|drie|vier|vijf|zes|acht|tien|twaalf)\s+(dagen|dag|weken|week|maanden|maand|jaar)\b/gi;
// Publieke instanties waar iets wordt aangevraagd, ingediend of gedeponeerd.
const AUTHORITIES = [
  ['rijksdienst voor ondernemend nederland', 'rvo'],
  ['belastingdienst'],
  ['kamer van koophandel', 'kvk'],
  ['uwv'],
  ['douane'],
  ['dienst uitvoering onderwijs', 'duo'],
  ['autoriteit persoonsgegevens'],
  ['autoriteit financiële markten', 'afm'],
  ['de nederlandsche bank', 'dnb'],
  ['gemeente'],
];
const PROCEDURE_RE = /aanvra(?:ag|gen)|aanvraagt|\bvraagt\b[^.]*\baan\b|indienen|ingediend|\b(?:dient|dienen)\b[^.]*\bin\b|deponeren|gedeponeerd|melden|aanmelden|inschrijven/i;

function mentions(text, names) {
  const t = normalizeText(text);
  return names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(t));
}

/**
 * Procedurele details uit de bron die in het artikel ontbreken: wettelijke
 * verwijzingen, termijnen ("binnen 30 dagen") en de instantie waar een
 * aanvraag/deponering loopt.
 */
export function findMissingSourceDetails(articleText, sourceText) {
  const article = normalizeText(articleText);
  const missing = [];
  for (const m of normalizeText(sourceText).matchAll(LEGAL_REF_RE)) {
    const ref = m[0].replace(/\s+/g, ' ');
    const number = ref.match(/artikel\s+\S+/)[0];
    if (!article.includes(number)) missing.push(`wettelijke verwijzing "${ref}"`);
  }
  for (const m of normalizeText(sourceText).matchAll(DEADLINE_RE)) {
    if (!article.includes(m[0])) missing.push(`termijn "${m[0]}"`);
  }
  for (const sentence of sentencesOf(sourceText)) {
    if (!PROCEDURE_RE.test(sentence)) continue;
    for (const names of AUTHORITIES) {
      if (mentions(sentence, names) && !mentions(articleText, names)) missing.push(`instantie "${names[0]}" (${sentence.slice(0, 80).trim()}…)`);
    }
  }
  return [...new Set(missing)];
}

// Zinnen die een groep uitzonderen: "… hoeven niet …", "geldt niet voor …".
const EXCLUSION_RE = /\b(?:hoeft|hoeven|hoef)\b[^.]*\bniet\b|\bniet\b[^.]*\b(?:verplicht|nodig)\b|\bgeldt\b[^.]*\bniet\b|\bvrijgesteld\b|\buitgezonderd\b|\bniet van toepassing\b/i;

/**
 * Gekozen doelgroepen die de bron (of het artikel) in een uitsluitende zin
 * noemt, op basis van de bestaande doelgroeptrefwoorden.
 */
export function findExcludedAudiences(audiences, sourceText, articleText = '') {
  const out = [];
  const sentences = [...sentencesOf(sourceText), ...sentencesOf(articleText)]
    .filter((s) => EXCLUSION_RE.test(s))
    .map((s) => ({ s, words: new Set(significantWords(s)) }));
  for (const audience of audiences ?? []) {
    const keywords = (audienceKeywords[audience] ?? []).map((k) => significantWords(k)).filter((w) => w.length > 0);
    const hit = sentences.find(({ words }) => keywords.some((kw) => kw.every((w) => words.has(w))));
    if (hit) out.push({ audience, sentence: hit.s.slice(0, 140) });
  }
  return out;
}

/**
 * True als de samenvatting een opsomming (4+ onderdelen) bevat die vrijwel
 * geheel al in de artikeltekst staat.
 */
export function summaryRepeatsList(summary, body) {
  const bodyWords = new Set(significantWords(body));
  for (const sentence of sentencesOf(summary)) {
    const items = sentence.split(/,|\s+en\s+|\s+of\s+/).map((p) => significantWords(p)).filter((w) => w.length > 0);
    if (items.length < 4) continue;
    const repeated = items.filter((words) => words.filter((w) => bodyWords.has(w)).length >= Math.ceil(words.length / 2));
    if (repeated.length / items.length >= 0.75) return true;
  }
  return false;
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

  // Brongetrouwheid
  const allText = `${title}\n${summary}\n${body}\n${relevance}`;
  for (const claim of findUnsupportedCurrencyClaims(allText, sourceText)) {
    warnings.push(`statusclaim "${claim}" staat niet zo in de bron`);
  }
  for (const q of findDroppedQualifiers(allText, sourceText)) warnings.push(`voorwaarde uit de bron mogelijk weggevallen: "${q}"`);
  for (const d of findMissingSourceDetails(allText, sourceText)) warnings.push(`detail uit de bron ontbreekt: ${d}`);
  for (const { audience, sentence } of findExcludedAudiences(article.audiences, sourceText, body)) {
    warnings.push(`doelgroep "${audience}" wordt in een uitsluitende zin genoemd: "${sentence}"`);
  }
  if (summaryRepeatsList(summary, body)) warnings.push('samenvatting herhaalt een opsomming uit de artikeltekst');

  if ((article.tags ?? []).length === 0) warnings.push('geen tags');
  if ((article.audiences ?? []).length === 0) warnings.push('geen doelgroep');

  // `overlap` (of null) naast de foutmelding, zodat de redactiestap de bron
  // als "al gedekt" kan vastleggen en het overlappende artikel kan loggen.
  return { ok: errors.length === 0, errors, warnings, overlap: overlap ?? null };
}
