// Bronlaag van het Kenniscentrum (src/content/bronnen/).
//
// Een officieel bronbericht (Belastingdienst, Rijksoverheid, KVK) is geen
// zichtbaar Kenniscentrum-artikel meer, maar een bronrecord: één JSON-bestand
// per bron-URL. Zichtbaar zijn alleen de Avydo-artikelen in
// src/content/kenniscentrum/; die verwijzen via `sourceUrl` naar hun bron.
// Het bronrecord verwijst terug via `avydoSlug`.
//
// `sourceUrl` blijft de sleutel voor deduplicatie, nu genormaliseerd
// (normalizeSourceUrl), zodat bijvoorbeeld een trailing slash of http/https
// geen tweede bron oplevert.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Verwerkingsstatus van een bronrecord. */
export const PROCESSING_STATUSES = ['kandidaat', 'verwerkt', 'afgewezen'];

/**
 * Vergelijkingssleutel voor een bron-URL: https, host in kleine letters,
 * zonder fragment, standaardpoort of afsluitende slash. De opgeslagen
 * `sourceUrl` zelf blijft ongewijzigd; dit is alleen de sleutel.
 * @param {string} url
 * @returns {string}
 */
export function normalizeSourceUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  if (parsed.port === '443' || parsed.port === '80') parsed.port = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
}

/**
 * Set van bron-URL's die altijd op de genormaliseerde sleutel vergelijkt.
 * Drop-in vervanging voor de Set die de import-functies als `existingUrls`
 * krijgen (has/add).
 */
export class SourceUrlSet extends Set {
  constructor(urls = []) {
    super();
    for (const url of urls) this.add(url);
  }

  add(url) {
    return super.add(normalizeSourceUrl(url));
  }

  has(url) {
    return super.has(normalizeSourceUrl(url));
  }
}

/** Bestandsnaam (zonder .json) van een bronrecord: datum + titel, net als de artikelen. */
export function sourceRecordId(title, date) {
  const datePart = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString().slice(0, 10) : 'zonder-datum';
  const titlePart = String(title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${datePart}-${titlePart || 'bron'}`;
}

/**
 * Leest alle bronrecords uit `dir`. Elk record krijgt `id` (bestandsnaam
 * zonder .json) mee.
 * @param {string} dir
 */
export function readSourceRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ id: file.replace(/\.json$/, ''), ...JSON.parse(readFileSync(path.join(dir, file), 'utf8')) }));
}

// Vaste veldvolgorde, zodat een bijgewerkt record een kleine, leesbare diff geeft.
const RECORD_FIELDS = [
  'sourceUrl', 'sourceName', 'title', 'description', 'body',
  'sourcePublishedAt', 'sourceLastModified', 'fetchedAt',
  'category', 'priority', 'audiences',
  'processingStatus', 'rejectionReason', 'avydoSlug',
];

function serializeRecord(record) {
  const out = {};
  for (const key of RECORD_FIELDS) {
    const value = record[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Schrijft een bronrecord. Bestaat er al een record met dezelfde
 * (genormaliseerde) sourceUrl, dan wordt dát bestand bijgewerkt; anders
 * komt er een nieuw bestand (met volgnummer bij een naamsbotsing).
 * @returns {string} id van het geschreven record
 */
export function writeSourceRecord(dir, record) {
  if (!record.sourceUrl) throw new Error('bronrecord zonder sourceUrl');
  if (!PROCESSING_STATUSES.includes(record.processingStatus)) {
    throw new Error(`ongeldige verwerkingsstatus: ${record.processingStatus}`);
  }
  mkdirSync(dir, { recursive: true });
  const key = normalizeSourceUrl(record.sourceUrl);
  const existing = readSourceRecords(dir).find((r) => normalizeSourceUrl(r.sourceUrl) === key);
  let id = record.id ?? existing?.id;
  if (!id) {
    const base = sourceRecordId(record.title, record.sourcePublishedAt ?? record.sourceLastModified ?? record.fetchedAt);
    id = base;
    for (let n = 2; existsSync(path.join(dir, `${id}.json`)); n += 1) id = `${base}-${n}`;
  }
  writeFileSync(path.join(dir, `${id}.json`), serializeRecord(record), 'utf8');
  return id;
}

/** Werkt alleen de opgegeven velden van een bestaand record bij. */
export function updateSourceRecord(dir, sourceUrl, changes) {
  const key = normalizeSourceUrl(sourceUrl);
  const existing = readSourceRecords(dir).find((r) => normalizeSourceUrl(r.sourceUrl) === key);
  if (!existing) throw new Error(`geen bronrecord voor ${sourceUrl}`);
  const merged = { ...existing, ...changes };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete merged[k];
  writeSourceRecord(dir, merged);
  return merged;
}

/**
 * Alle bekende bron-URL's: uit de bronlaag én uit de Avydo-artikelen.
 * Basis voor de deduplicatie van de import.
 */
export function loadKnownSourceUrls({ sourcesDir, contentDir }) {
  const urls = new SourceUrlSet();
  for (const record of readSourceRecords(sourcesDir)) urls.add(record.sourceUrl);
  if (existsSync(contentDir)) {
    for (const file of readdirSync(contentDir)) {
      if (!file.endsWith('.md')) continue;
      const match = readFileSync(path.join(contentDir, file), 'utf8').match(/^sourceUrl:\s*"([^"]*)"/m);
      if (match) urls.add(match[1]);
    }
  }
  return urls;
}
