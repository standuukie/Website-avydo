// Dagelijkse onderwerpselectie: kiest uit de bronlaag maximaal twee
// bronrecords waarover Avydo een eigen artikel schrijft. Nul is een normale
// uitkomst; er wordt nooit een onderwerp gekozen om een aantal te halen.
//
// Volgorde van voorkeur:
//   1. actueel nieuws: Belastingdienst/Rijksoverheid, bron hooguit
//      ACTUEEL_MAX_AGE_DAYS oud;
//   2. nieuwe of aangekondigde regelgeving: een wetgevings-/wijzigingssignaal
//      in de bron, met een recente bron (hooguit REGELGEVING_MAX_AGE_DAYS) of
//      een toekomstige ingangsdatum in de brontekst — zo kan ook een ouder
//      bericht kandidaat zijn als de wijziging nog moet ingaan;
//   3. blijvend geldende uitleg (KVK, redactionele tier 'hoog'): alleen als
//      1 en 2 niets opleveren, en dan hooguit één.
// Een KVK-lastmod telt nooit als nieuwsdatum.
//
// Geen embeddings: overlap met bestaande Avydo-artikelen gaat via dezelfde
// titel-Jaccard als bij de KVK-import (findOverlappingArticle), aangevuld
// met een controle op jaargebonden onderwerpen (findSameOrNewerYearArticle).
import { classifyKvkRelevance, findOverlappingArticle, kvkSignificantWords } from './fetch-articles.mjs';
import { SourceUrlSet } from './source-records.mjs';

export const MAX_TOPICS_PER_RUN = 2;
export const MAX_EVERGREEN_TOPICS_PER_RUN = 1;
// Minimale lengte van de opgehaalde brontekst. Zonder volledige brontekst
// wordt er niet geschreven (de korte omschrijving alleen is te weinig).
export const MIN_SOURCE_TEXT_LENGTH = 600;
export const ACTUEEL_MAX_AGE_DAYS = 14;
export const REGELGEVING_MAX_AGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// Signalen van (aangekondigde) wet- en regelgeving of een wijziging.
const REGELGEVING_SIGNAL = /wetsvoorstel|wetswijziging|nieuwe wet|internetconsultatie|consultatie|belastingplan|aangenomen|in werking|inwerkingtreding|treedt .{0,40}in werking|gaat gelden|wordt verplicht|verplicht per|per 1 [a-z]+ 20\d\d|vanaf 1 [a-z]+ 20\d\d|met ingang van|afgeschaft|afschaffing|verhoging|verlaging|maatregel|voornemen|kabinet wil/i;

// --- Jaargebonden onderwerpen (tarieven, cijfers, bedragen per jaar) ---
//
// Een bron met een jaartal in de titel ("Belastingtarieven en cijfers van
// 2025") is een jaarlijkse actualisatie. Bestaat er al een Avydo-artikel over
// hetzelfde onderwerp voor datzelfde of een later jaar, dan is de bron
// verouderd of dubbel. De titel-Jaccard mist dat (andere formulering, het
// jaartal zelf telt mee), dus hier: jaartallen eruit, en de onderwerpwoorden
// van de bron moeten (vrijwel) allemaal in de titel van het bestaande
// artikel voorkomen. Categorie telt niet mee: hetzelfde jaarlijkse onderwerp
// kan onder een andere categorie zijn ingedeeld.
export const SAME_TOPIC_WORD_COVERAGE = 0.75;
const YEAR_IN_TEXT = /\b(20\d{2})\b/g;

function yearsIn(text) {
  return [...String(text ?? '').matchAll(YEAR_IN_TEXT)].map((m) => Number(m[1]));
}

function topicWords(text) {
  return new Set(kvkSignificantWords(String(text ?? '').replace(YEAR_IN_TEXT, ' ')).filter((w) => !/^\d+$/.test(w)));
}

/**
 * Bestaand Avydo-artikel over hetzelfde jaargebonden onderwerp voor hetzelfde
 * of een later jaar dan de bron, of null. Alleen voor bronnen met een
 * jaartal in de titel.
 */
export function findSameOrNewerYearArticle(title, avydoArticles) {
  const years = yearsIn(title);
  if (years.length === 0) return null;
  const sourceYear = Math.max(...years);
  const words = topicWords(title);
  if (words.size < 2) return null;
  for (const article of avydoArticles) {
    const articleYears = yearsIn(article.title);
    if (articleYears.length === 0 || Math.max(...articleYears) < sourceYear) continue;
    const articleWords = topicWords(article.title);
    const covered = [...words].filter((w) => articleWords.has(w)).length;
    if (covered / words.size >= SAME_TOPIC_WORD_COVERAGE) return { ...article, year: Math.max(...articleYears), sourceYear };
  }
  return null;
}

function daysBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

/**
 * Eerste datum in de tekst die ná `now` ligt en wordt ingeleid als
 * ingangsdatum ("per 1 januari 2027", "vanaf 2028", "met ingang van 1 juli
 * 2027"), of null.
 * @param {string} text
 * @param {Date} now
 * @returns {Date | null}
 */
export function findFutureEffectiveDate(text, now) {
  const re = new RegExp(`\\b(?:per|vanaf|met ingang van|ingaat op|in werking op)\\s+(?:(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+)?(20\\d{2})\\b`, 'gi');
  for (const m of String(text ?? '').matchAll(re)) {
    const year = Number(m[3]);
    const month = m[2] ? MONTHS.indexOf(m[2].toLowerCase()) : 0;
    const day = m[1] ? Number(m[1]) : 1;
    const date = new Date(Date.UTC(year, month, day));
    if (date.getTime() > now.getTime()) return date;
  }
  return null;
}

function sourceDate(record) {
  const value = record.sourcePublishedAt ?? record.sourceLastModified;
  return value ? new Date(value) : null;
}

/**
 * Bepaalt of een bronrecord geschikt is en in welke voorkeursgroep.
 * @returns {{ eligible: true, tier: 1|2|3, kind: 'toelichting'|'gids', reason: string }
 *   | { eligible: false, permanent: boolean, reason: string }}
 */
export function classifyCandidate(record, { now, avydoArticles }) {
  const text = `${record.title ?? ''}\n${record.description ?? ''}\n${record.body ?? ''}`;
  if (!record.body || record.body.length < MIN_SOURCE_TEXT_LENGTH) {
    return { eligible: false, permanent: true, reason: 'onvoldoende opgehaalde brontekst om een artikel op te baseren' };
  }
  const overlap = findOverlappingArticle(record.title, record.category, avydoArticles);
  if (overlap) {
    return { eligible: false, permanent: true, reason: `onderwerp al behandeld in Avydo-artikel "${overlap.title}" (${overlap.file})` };
  }
  const yearly = findSameOrNewerYearArticle(record.title, avydoArticles);
  if (yearly) {
    const why = yearly.year > yearly.sourceYear ? `verouderd: er is al een Avydo-artikel voor ${yearly.year}` : `dubbel: er is al een Avydo-artikel voor ${yearly.year}`;
    return { eligible: false, permanent: true, reason: `jaargebonden onderwerp over ${yearly.sourceYear}, ${why} ("${yearly.title}", ${yearly.file})` };
  }

  const futureDate = findFutureEffectiveDate(text, now);
  const regelgeving = REGELGEVING_SIGNAL.test(text);

  if (record.sourceName === 'KVK') {
    if (regelgeving && futureDate) {
      return { eligible: true, tier: 2, kind: 'toelichting', reason: `aangekondigde wijziging per ${futureDate.toISOString().slice(0, 10)} (KVK)` };
    }
    const kvkTier = classifyKvkRelevance(`${record.title} ${record.description ?? ''}`).tier;
    if (kvkTier === 'hoog') {
      return { eligible: true, tier: 3, kind: 'gids', reason: 'blijvend relevante uitleg voor ondernemers (KVK, tier hoog)' };
    }
    return { eligible: false, permanent: true, reason: 'KVK-pagina zonder sterk fiscaal signaal of aangekondigde wijziging' };
  }

  const published = sourceDate(record);
  if (!published) return { eligible: false, permanent: true, reason: 'geen publicatiedatum van de bron' };
  const ageDays = daysBetween(now, published);
  if (ageDays < -1) return { eligible: false, permanent: true, reason: 'publicatiedatum van de bron ligt in de toekomst' };

  if (ageDays <= ACTUEEL_MAX_AGE_DAYS) {
    return { eligible: true, tier: 1, kind: 'toelichting', reason: `actueel bericht (${Math.max(0, Math.round(ageDays))} dag(en) oud)` };
  }
  if (regelgeving && (ageDays <= REGELGEVING_MAX_AGE_DAYS || futureDate)) {
    const why = futureDate ? `ingangsdatum ${futureDate.toISOString().slice(0, 10)} ligt nog in de toekomst` : `recent (${Math.round(ageDays)} dagen oud)`;
    return { eligible: true, tier: 2, kind: 'toelichting', reason: `nieuwe of aangekondigde regelgeving; ${why}` };
  }
  // Ouder nieuws zonder toekomstige ingangsdatum wordt alleen maar ouder.
  return { eligible: false, permanent: true, reason: 'niet meer actueel en geen aangekondigde wijziging' };
}

function rankKey(entry) {
  const date = sourceDate(entry.record);
  return [entry.tier, entry.record.priority === 'belangrijk' ? 0 : 1, -(date ? date.getTime() : 0)];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * @param {Array<object>} records bronrecords (alle statussen)
 * @param {{ now: Date, avydoArticles: Array<{file: string, title: string, category: string|null, sourceUrl: string|null}>,
 *   pendingSourceUrls?: Iterable<string>, max?: number }} options
 * @returns {{ selected: Array<{record, tier, kind, reason}>, rejected: Array<{record, reason}>,
 *   deferred: Array<{record, reason}>, noTopicReason: string | null }}
 */
export function selectTopics(records, { now, avydoArticles, pendingSourceUrls = [], max = MAX_TOPICS_PER_RUN }) {
  const pending = new SourceUrlSet(pendingSourceUrls);
  const covered = new SourceUrlSet(avydoArticles.map((a) => a.sourceUrl).filter(Boolean));
  const eligible = [];
  const rejected = [];
  const deferred = [];

  for (const record of records) {
    if (record.processingStatus !== 'kandidaat') continue;
    if (covered.has(record.sourceUrl)) {
      rejected.push({ record, reason: 'bron is al de basis van een Avydo-artikel' });
      continue;
    }
    if (pending.has(record.sourceUrl)) {
      deferred.push({ record, reason: 'bron zit al in een openstaand of afgewezen redactievoorstel (Pull Request)' });
      continue;
    }
    const c = classifyCandidate(record, { now, avydoArticles });
    if (c.eligible) eligible.push({ record, tier: c.tier, kind: c.kind, reason: c.reason });
    else if (c.permanent) rejected.push({ record, reason: c.reason });
    else deferred.push({ record, reason: c.reason });
  }

  eligible.sort((a, b) => compareKeys(rankKey(a), rankKey(b)));

  const selected = [];
  const pick = (entry) => {
    // Twee kandidaten over hetzelfde onderwerp: alleen de eerste.
    const asArticles = selected.map((s) => ({ file: s.record.id ?? s.record.sourceUrl, title: s.record.title, category: s.record.category }));
    const overlap = findOverlappingArticle(entry.record.title, entry.record.category, asArticles);
    if (overlap) {
      deferred.push({ record: entry.record, reason: `zelfde onderwerp als de eerder gekozen bron "${overlap.title}"` });
      return;
    }
    selected.push(entry);
  };

  for (const entry of eligible.filter((e) => e.tier < 3)) {
    if (selected.length >= max) {
      deferred.push({ record: entry.record, reason: 'dagelijks maximum bereikt; kan in een volgende run alsnog gekozen worden' });
      continue;
    }
    pick(entry);
  }
  const actueelCount = selected.length;
  for (const entry of eligible.filter((e) => e.tier === 3)) {
    if (actueelCount > 0 || selected.length >= Math.min(max, MAX_EVERGREEN_TOPICS_PER_RUN)) {
      deferred.push({ record: entry.record, reason: 'blijvende uitleg; alleen gekozen op een dag zonder actueel onderwerp' });
      continue;
    }
    pick(entry);
  }

  let noTopicReason = null;
  if (selected.length === 0) {
    noTopicReason = eligible.length === 0
      ? 'geen bron voldoet vandaag aan de eisen (actualiteit, brontekst, geen overlap)'
      : 'alle geschikte bronnen vielen af op overlap met elkaar';
  }
  return { selected, rejected, deferred, noTopicReason };
}
