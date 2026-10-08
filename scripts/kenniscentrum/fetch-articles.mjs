#!/usr/bin/env node
/**
 * Dagelijkse Kenniscentrum-run, in twee stappen:
 *
 * 1. Bron-ingestie: haalt nieuwe berichten op uit de geconfigureerde
 *    officiële bronnen (zie sources.config.mjs), filtert op relevantie voor
 *    MKB-ondernemers en legt elk relevant bericht vast als bronrecord in de
 *    bronlaag (src/content/bronnen/, zie source-records.mjs). Een bronbericht
 *    wordt nooit meer rechtstreeks een zichtbaar Kenniscentrum-artikel.
 * 2. Redactie (zie editorial.mjs): kiest uit de bronlaag maximaal twee
 *    onderwerpen, laat daar een eigen Avydo-artikel over schrijven en
 *    controleert dat vóór het in src/content/kenniscentrum/ komt. Nul
 *    artikelen is een normale uitkomst. De GitHub Action zet het resultaat
 *    in een Pull Request; er wordt niets rechtstreeks gepubliceerd.
 *
 * Nooit fabricage: als een bron niet bereikbaar is, geen geldige feed/sitemap
 * levert, of onvoldoende informatie bevat, wordt die bron/dat item simpelweg
 * overgeslagen. Bestaande content blijft altijd staan (fallback = het laatst
 * succesvol opgehaalde resultaat, gecommit in git).
 *
 * Elke bron faalt volledig onafhankelijk: een probleem bij de ene bron mag
 * nooit de andere bronnen blokkeren of de hele run laten mislukken.
 *
 * Gebruik: node scripts/kenniscentrum/fetch-articles.mjs
 * Env: ANTHROPIC_API_KEY — nodig voor de redactiestap; zonder key worden
 *      alleen bronrecords vastgelegd en ontstaat er geen artikel.
 *      KENNISCENTRUM_PR_LIST_FILE (optioneel) — JSON van `gh pr list`, zodat
 *      een bron uit een openstaand of afgewezen voorstel niet opnieuw wordt
 *      gekozen.
 */
import { XMLParser } from 'fast-xml-parser';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sources,
  categoryKeywords,
  audienceKeywords,
  importantKeywords,
  maxArticlesPerRun,
  maxArticlesPerSourcePerRun,
} from './sources.config.mjs';
import { loadKnownSourceUrls, writeSourceRecord } from './source-records.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.KENNISCENTRUM_CONTENT_DIR
  ? path.resolve(process.env.KENNISCENTRUM_CONTENT_DIR)
  : path.resolve(__dirname, '../../src/content/kenniscentrum');
// Bronlaag. Met een eigen KENNISCENTRUM_CONTENT_DIR (tests) standaard een
// submap daarvan, zodat een test nooit in de echte bronlaag schrijft.
const SOURCES_DIR = process.env.KENNISCENTRUM_SOURCES_DIR
  ? path.resolve(process.env.KENNISCENTRUM_SOURCES_DIR)
  : process.env.KENNISCENTRUM_CONTENT_DIR
    ? path.join(CONTENT_DIR, 'bronnen')
    : path.resolve(__dirname, '../../src/content/bronnen');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const FETCH_TIMEOUT_MS = 15000;

function log(...args) {
  console.log(...args);
}

export function stripHtml(input) {
  if (!input) return '';
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(input) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function parseFeedItems(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xmlText);

  // RSS 2.0
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    return arr.map((it) => ({
      title: stripHtml(String(it.title ?? '')),
      link: typeof it.link === 'string' ? it.link : it.link?.['#text'] ?? it.link?.['@_href'] ?? '',
      description: stripHtml(String(it.description ?? it['content:encoded'] ?? '')),
      pubDate: it.pubDate ?? it['dc:date'] ?? null,
    }));
  }

  // Atom
  const atomEntries = doc?.feed?.entry;
  if (atomEntries) {
    const arr = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    return arr.map((it) => {
      let link = '';
      if (typeof it.link === 'string') link = it.link;
      else if (Array.isArray(it.link)) link = it.link.find((l) => l['@_rel'] !== 'self')?.['@_href'] ?? it.link[0]?.['@_href'] ?? '';
      else if (it.link?.['@_href']) link = it.link['@_href'];
      return {
        title: stripHtml(String(it.title ?? '')),
        link,
        description: stripHtml(String(it.summary ?? it.content ?? '')),
        pubDate: it.published ?? it.updated ?? null,
      };
    });
  }

  return null;
}

// Google News-sitemap (xmlns:news): <urlset><url><loc>...</loc>
// <news:news><news:title>...</news:title>
// <news:publication_date>...</news:publication_date></news:news></url>...
// Bevat geen samenvattingstekst — die wordt apart per artikel opgehaald
// (zie fetchArticlePageMeta) zodat we nooit een samenvatting verzinnen.
export function parseSitemapNewsItems(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xmlText);

  const urlset = doc?.urlset?.url;
  if (!urlset) return null;

  const arr = Array.isArray(urlset) ? urlset : [urlset];
  return arr
    .map((u) => {
      const news = u['news:news'];
      const title = news?.['news:title'];
      const pubDate = news?.['news:publication_date'] ?? u.lastmod ?? null;
      const link = typeof u.loc === 'string' ? u.loc : u.loc?.['#text'] ?? '';
      if (!title || !link) return null;
      return { title: stripHtml(String(title)), link, pubDate, description: '' };
    })
    .filter(Boolean);
}

// Haalt de meta-description (of og:description als fallback) op van een
// artikelpagina, als brontekst voor de samenvatting. Nooit fabricage: als
// geen van beide aanwezig is, wordt null teruggegeven en slaat de caller dat
// artikel over.
export function extractMetaDescription(html) {
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  if (!descMatch) return null;
  const decoded = stripHtml(descMatch[1]);
  return decoded || null;
}

// Leest de ministerie-toewijzing van een rijksoverheid.nl-artikelpagina uit
// de echte breadcrumb-link naar /ministeries/<slug> (nooit verzonnen — als
// de link er niet is, wordt null teruggegeven). Gebruikt om publicaties van
// een specifiek ministerie (bv. Financiën) als relevant te kunnen
// markeren, ook wanneer de trefwoordfilter geen treffer geeft.
// Alleen slugs die daadwerkelijk live geverifieerd zijn tegen een echte
// rijksoverheid.nl-artikelpagina staan hier; andere ministeries worden pas
// toegevoegd nadat hun URL-slug op dezelfde manier is bevestigd.
const MINISTRY_NAMES = {
  'ministerie-van-financien': 'Ministerie van Financiën',
};

export function extractMinistryTag(html) {
  const match = html.match(/href="\/ministeries\/([a-z0-9-]+)"/i);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  return MINISTRY_NAMES[slug] ?? null;
}

// Nodig voor bronnen waarvan de discovery zelf geen titel levert (de
// Rijksoverheid topic-API levert alleen loc+lastmod door) — de <title> van
// de artikelpagina zelf, met de vaste site-naam-suffix verwijderd (nooit
// onderdeel van de artikeltitel zelf). Geeft null als er geen <title> is
// (nooit een gegokte titel).
export function extractPageTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  const title = stripHtml(match[1]).replace(/\s*\|\s*Rijksoverheid\.nl\s*$/i, '').trim();
  return title || null;
}

// --- Rijksoverheid: hoofdtekst van een nieuwsbericht (2026-10-07) ---
//
// De artikelpagina wordt al opgehaald (zie fetchArticlePageMeta); tot nu toe
// werd alleen de meta-description bewaard. Deze extractie haalt uit DIEZELFDE
// HTML de hoofdtekst, zonder extra request en zonder nieuwe dependency.
//
// Gebaseerd op een read-only audit van 176 echte rijksoverheid.nl-
// nieuwsberichten (opgehaald vanaf de GitHub-runner, 2026-10-06; ruwe HTML
// was vanuit de ontwikkelomgeving niet bereikbaar). Op tekstniveau bleek de
// structuur in 176/176 gelijk:
//   ... "Vul in wat u zoekt" <titel> "Nieuwsbericht DD-MM-JJJJ | UU:MM"
//   <hoofdtekst> ["Documenten" + bijlagen]
//   "Heeft deze informatie u geholpen? Ja Nee" "Meer over dit onderwerp" ...
//   "Hoort bij" ... vaste footer ("... Terug naar boven").
// De extractie werkt daarom op die tekstmarkers (tags ertussen toegestaan)
// en op generieke inhoudselementen (<p>, <h2>, <h3>, <li>), niet op
// class-namen die niet geverifieerd konden worden. Lukt dat niet volledig
// betrouwbaar, dan null: de caller valt dan terug op de bestaande summary.

const RIJKSOVERHEID_BODY_MAX_LENGTH = 8000;
const RIJKSOVERHEID_BODY_MIN_LENGTH = 400;
const RIJKSOVERHEID_BODY_MIN_PARAGRAPHS = 2;
// Een "inhoudelijke alinea" is een <p> met minstens zoveel tekens; korte
// <p>'s (labels, losse woorden) tellen niet mee voor de drempel.
const RIJKSOVERHEID_BODY_MIN_PARAGRAPH_LENGTH = 40;

// Witruimte, harde spaties en tags tussen de delen van een marker.
const HTML_GAP = '(?:\\s|&nbsp;|&#160;|<[^>]*>)*';
// Paginatype + datum + tijd. Vereist expliciet "Nieuwsbericht": een ander
// paginatype (toespraak, publicatie, ...) levert dus geen startmarker op.
const RIJKSOVERHEID_BODY_START = new RegExp(
  `Nieuwsbericht${HTML_GAP}\\d{2}-\\d{2}-\\d{4}${HTML_GAP}(?:\\||&#124;|&#x7c;)${HTML_GAP}\\d{2}:\\d{2}`,
  'i',
);
const RIJKSOVERHEID_BODY_END = /Heeft(?:\s|&nbsp;)+deze(?:\s|&nbsp;)+informatie(?:\s|&nbsp;)+u(?:\s|&nbsp;)+geholpen/i;
// Kopje van het bijlagenblok; in de audit stond dit blok altijd als laatste
// vóór de eindmarker, dus alles vanaf dit kopje valt weg.
const RIJKSOVERHEID_DOCUMENTS_HEADING = />\s*(?:Documenten|Bijlagen|Downloads)\s*</i;
const RIJKSOVERHEID_BOILERPLATE = /Vul in wat u zoekt|Heeft deze informatie|Terug naar boven|Ga direct naar inhoud/i;
// Niet-inhoudelijke blokken die vóór alles worden verwijderd. Vooral
// <script> is essentieel: Next.js zet de volledige paginatekst ook in een
// script-payload, die anders als (dubbele) startmarker zou kunnen tellen.
const NON_CONTENT_BLOCKS = /<(script|style|noscript|template|svg|figure|iframe)\b[\s\S]*?<\/\1\s*>/gi;

const NAMED_HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  euro: '€', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', deg: '°', sect: '§', copy: '©', reg: '®', shy: '',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', auml: 'ä',
  iacute: 'í', iuml: 'ï', oacute: 'ó', ouml: 'ö', uacute: 'ú', uuml: 'ü', ccedil: 'ç',
  Eacute: 'É', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü',
};

// Eén enkele pass (geen dubbele decodering: "&amp;lt;" wordt "&lt;", niet "<").
function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return code === 160 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED_HTML_ENTITIES[entity] ?? match;
  });
}

// Tekst van één inhoudselement: tags weg, entiteiten gedecodeerd, witruimte
// genormaliseerd, en daarna < en > weer als entiteit zodat er nooit
// letterlijke HTML in de markdown-body belandt.
function rijksoverheidBlockText(innerHtml) {
  return decodeHtmlEntities(innerHtml.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Regels die in markdown iets anders zouden betekenen dan tekst (kop,
// thematische breuk / frontmatter-scheiding) krijgen een backslash-escape.
function neutralizeMarkdownLine(line) {
  return /^(?:#|-{3,}|\*{3,}|_{3,}|={3,}|<)/.test(line) ? `\\${line}` : line;
}

// Afkortingen waarna een punt geen zinseinde is.
const SENTENCE_END_ABBREVIATION = /(?:^|\s)(?:bijv|bv|o\.a|m\.b\.t|i\.p\.v|d\.w\.z|nr|art|ca|incl|excl|zgn|e\.d|t\.o\.v|mr|dr|drs|ir|prof)\.$/i;

// Kapt af op het laatste zinseinde vóór `max`; voegt niets toe. null als er
// geen bruikbaar zinseinde is.
function truncateAtSentenceBoundary(text, max) {
  if (text.length <= max) return text;
  const sentenceEnd = /[.!?][”"’)]?(?=\s|$)/g;
  let cut = -1;
  let match;
  while ((match = sentenceEnd.exec(text)) && match.index + match[0].length <= max) {
    const end = match.index + match[0].length;
    if (!SENTENCE_END_ABBREVIATION.test(text.slice(Math.max(0, end - 12), end))) cut = end;
  }
  return cut > 0 ? text.slice(0, cut).trimEnd() : null;
}

/**
 * Hoofdtekst van een rijksoverheid.nl-nieuwsbericht als schone markdown-
 * tekst (alinea's gescheiden door een lege regel, lijstitems als "- ..."),
 * of null als die niet betrouwbaar te extraheren is. Zie de toelichting
 * hierboven voor markers en drempels.
 * @param {string} html
 * @returns {string | null}
 */
export function extractRijksoverheidArticleBody(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(NON_CONTENT_BLOCKS, ' ');

  const start = cleaned.match(RIJKSOVERHEID_BODY_START);
  if (!start) return null;
  const afterStart = cleaned.slice(start.index + start[0].length);
  const end = afterStart.match(RIJKSOVERHEID_BODY_END);
  if (!end) return null;
  let region = afterStart.slice(0, end.index);
  const documents = region.match(RIJKSOVERHEID_DOCUMENTS_HEADING);
  if (documents) region = region.slice(0, documents.index + 1);

  const blocks = [];
  for (const m of region.matchAll(/<(p|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const text = rijksoverheidBlockText(m[2]);
    if (!text) continue;
    const tag = m[1].toLowerCase();
    blocks.push({ tag, line: neutralizeMarkdownLine(tag === 'li' ? `- ${text}` : text) });
  }

  const body = truncateAtSentenceBoundary(blocks.map((b) => b.line).join('\n\n'), RIJKSOVERHEID_BODY_MAX_LENGTH);
  if (!body || body.length < RIJKSOVERHEID_BODY_MIN_LENGTH) return null;
  if (RIJKSOVERHEID_BOILERPLATE.test(body)) return null;
  // Inhoudelijke alinea's tellen over wat ná het afkappen overblijft (een
  // afgekapte laatste alinea telt mee voor het behouden deel).
  let paragraphs = 0;
  let pos = 0;
  for (const b of blocks) {
    if (pos >= body.length) break;
    const kept = Math.min(b.line.length, body.length - pos);
    if (b.tag === 'p' && kept >= RIJKSOVERHEID_BODY_MIN_PARAGRAPH_LENGTH) paragraphs += 1;
    pos += b.line.length + 2;
  }
  if (paragraphs < RIJKSOVERHEID_BODY_MIN_PARAGRAPHS) return null;
  return body;
}

// --- Belastingdienst en KVK: hoofdtekst van de bronpagina (2026-10-08) ---
//
// Generieke, behoudende extractie voor bronnen zonder vaste tekstmarkers
// zoals Rijksoverheid ze heeft. Werkt uitsluitend binnen het <main>-element,
// ná de <h1>, en stopt bij de eerste feedback-/deelvraag. Navigatie,
// zijbalken, formulieren en kop-/voetteksten vallen vooraf weg, net als
// lijstitems die alleen uit een link bestaan (menu's, "zie ook").
// Dezelfde drempels als bij Rijksoverheid: te weinig tekst of te weinig
// inhoudelijke alinea's = null. Dan is er geen betrouwbare brontekst en
// komt de bron niet in aanmerking voor een Avydo-artikel (er wordt nooit
// op basis van alleen de korte omschrijving geschreven).
// Let op: de HTML van belastingdienst.nl en kvk.nl kon vanuit de
// ontwikkelomgeving niet worden opgehaald; de opbrengst per run staat
// daarom in de log ("hoofdtekst N tekens" / "geen betrouwbare hoofdtekst").
const MAIN_CONTENT_EXCLUDED_BLOCKS = /<(nav|aside|header|footer|form|button|dialog)\b[\s\S]*?<\/\1\s*>/gi;
const MAIN_CONTENT_END = /Heeft(?:\s|&nbsp;)+deze(?:\s|&nbsp;)+informatie|Was(?:\s|&nbsp;)+deze(?:\s|&nbsp;)+(?:informatie|pagina)|Deel(?:\s|&nbsp;)+deze(?:\s|&nbsp;)+pagina|Vond(?:\s|&nbsp;)+je(?:\s|&nbsp;)+dit/i;
const LINK_ONLY_LIST_ITEM = /^\s*<a\b[^>]*>[\s\S]*?<\/a>\s*$/i;

/**
 * Hoofdtekst van een bronpagina (Belastingdienst, KVK) als markdown-tekst,
 * of null als die niet betrouwbaar te extraheren is.
 * @param {string} html
 * @returns {string | null}
 */
export function extractMainContentBody(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(NON_CONTENT_BLOCKS, ' ');
  const main = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  if (!main) return null;
  let region = main[1].replace(MAIN_CONTENT_EXCLUDED_BLOCKS, ' ');
  const h1 = region.match(/<\/h1\s*>/i);
  if (h1) region = region.slice(h1.index + h1[0].length);
  const end = region.match(MAIN_CONTENT_END);
  if (end) region = region.slice(0, end.index);

  const blocks = [];
  for (const m of region.matchAll(/<(p|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const tag = m[1].toLowerCase();
    if (tag === 'li' && LINK_ONLY_LIST_ITEM.test(m[2])) continue;
    const text = rijksoverheidBlockText(m[2]);
    if (!text) continue;
    blocks.push({ tag, line: neutralizeMarkdownLine(tag === 'li' ? `- ${text}` : text) });
  }

  const body = truncateAtSentenceBoundary(blocks.map((b) => b.line).join('\n\n'), RIJKSOVERHEID_BODY_MAX_LENGTH);
  if (!body || body.length < RIJKSOVERHEID_BODY_MIN_LENGTH) return null;
  const paragraphs = blocks.filter((b) => b.tag === 'p' && b.line.length >= RIJKSOVERHEID_BODY_MIN_PARAGRAPH_LENGTH).length;
  if (paragraphs < RIJKSOVERHEID_BODY_MIN_PARAGRAPHS) return null;
  return body;
}

// Haalt een bronpagina op en geeft de hoofdtekst terug, of null (pagina niet
// bereikbaar of tekst niet betrouwbaar te extraheren). Nooit een fout.
async function fetchSourcePageBody(url) {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    return extractMainContentBody(await res.text());
  } catch {
    return null;
  }
}

// `extractBody` (alleen voor de Rijksoverheid-bron) haalt uit dezelfde HTML
// ook de hoofdtekst; geen extra request. Een fout in de extractie maakt
// alleen `body` null, nooit de rest van de metadata.
async function fetchArticlePageMeta(url, { extractBody = false } = {}) {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return { title: null, description: null, ministry: null, body: null };
    const html = await res.text();
    let body = null;
    if (extractBody) {
      try {
        body = extractRijksoverheidArticleBody(html);
      } catch {
        body = null;
      }
    }
    return { title: extractPageTitle(html), description: extractMetaDescription(html), ministry: extractMinistryTag(html), body };
  } catch {
    return { title: null, description: null, ministry: null, body: null };
  }
}

// Enkele korte trefwoorden kunnen via de kale substring-check hieronder per
// ongeluk binnen een heel ander woord matchen (bijv. 'nba' binnen
// "openbaar"/"openbare"/"openbaarheid" — ontdekt via een live Rijksoverheid-
// productierun, 2026-10-01: 3 van de 5 gepubliceerde artikelen kwamen
// uitsluitend hierdoor door, zie git-historie). Voor die specifieke
// trefwoorden wordt een woordgrens-bewuste match gebruikt i.p.v. kale
// substring-matching, zodat "NBA" als losstaande term nog wel telt maar
// "openbaar(e)(heid)" niet meer. Bewust een kleine, expliciete lijst i.p.v.
// dit voor alle trefwoorden te doen: meerdere bestaande trefwoorden (bijv.
// 'boekhoud') zijn juist OPZETTELIJK bedoeld als voorvoegsel-match (vangt
// ook boekhouding/boekhouden/boekhouder) en zouden door een generieke
// woordgrens-eis stukgaan — zie fetch-articles.test.mjs voor de
// regressietests die dat bevestigen.
// Dezelfde botsing dook opnieuw op bij een read-only audit van de
// productierun van 2026-10-01 (20 nieuw gepubliceerde artikelen): 'kor'
// matchte binnen "lerarentekort"/"woningtekort"/"in het kort", 'maatschap'
// binnen "maatschappij" en 'fusie' binnen "kernfusie". Zelfde oplossing,
// zelfde patroon.
const WORD_BOUNDARY_KEYWORDS = new Set(['nba', 'kor', 'maatschap', 'fusie']);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(lowerText, keyword) {
  if (WORD_BOUNDARY_KEYWORDS.has(keyword)) {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(lowerText);
  }
  return lowerText.includes(keyword);
}

const NO_EXCLUDED_KEYWORDS = new Set();

// `excludeKeywords` laat een aanroeper één of meer trefwoorden buiten de
// telling houden zonder categoryKeywords zelf aan te passen — gebruikt door
// processSitemapSource (zie corroborationRequiredKeywords in
// sources.config.mjs) om te bepalen of een treffer ook zonder een specifiek
// trefwoord (bijv. 'prinsjesdag') overeind blijft. Standaard leeg: bestaand
// gedrag van alle andere aanroepers (pickCategory, de RSS-bronnen, KVK's
// classifyKvkRelevance) blijft ongewijzigd.
export function scoreCategories(text, excludeKeywords = NO_EXCLUDED_KEYWORDS) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (excludeKeywords.has(kw)) continue;
      if (keywordMatches(lower, kw)) score += 1;
    }
    if (score > 0) scores[category] = score;
  }
  return scores;
}

// ministryBypass (zie processSitemapSource) is een bewust vangnet voor
// keyword-arme maar inhoudelijk relevante Financiën-artikelen: elk artikel
// met de Financiën-breadcrumb wordt normaal gesproken relevant geacht, ook
// zonder categoryKeyword-treffer. Een read-only audit van de productierun
// van 2026-10-01 liet zien dat dit ook zuiver consumentengerichte Toeslagen-
// berichten (bijv. zorgtoeslag voor huishoudens, zonder enig fiscaal/
// ondernemerssignaal) automatisch doorliet. Deze smalle, expliciete lijst
// schakelt uitsluitend de ministryBypass zelf uit voor zo'n artikel — de
// gewone categoryKeywords-/audienceSignals-relevantie (scoreCategories
// hierboven) is hier volledig los van en blijft ongewijzigd: een artikel
// dat toevallig ook 'zorgtoeslag' noemt maar daarnaast een echt fiscaal
// trefwoord bevat, blijft gewoon relevant via dat trefwoord.
const MINISTRY_BYPASS_EXCLUDED_TERMS = [
  'zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget',
];

function hasMinistryBypassExcludedTerm(lowerText) {
  return MINISTRY_BYPASS_EXCLUDED_TERMS.some((term) => keywordMatches(lowerText, term));
}

// Aanvulling op de ministryBypass (zie hierboven): naast de bestaande
// negatieve uitsluitingslijst is er nu ook een positieve eis. Een
// inhoudelijke audit van 30 echte Financiën-artikelen (2026-10-01) liet
// zien dat ministryMatch zonder verdere eis te breed is — 13 van de 23
// artikelen die uitsluitend via ministryMatch relevant werden, waren
// inhoudelijk een false positive (interne Belastingdienst-ICT,
// cybersecurity, herdenkingsmunten, staatsdeelnemingen, consumenten-
// hypotheeknormen). De twee daadwerkelijk relevante uitzonderingen in die
// audit ("Kabinet zet met belastingwijzigingen 2026 stappen naar een beter
// belastingstelsel" en "Start internetconsultatie belastingmaatregelen om
// startups en scale-ups te ondersteunen") bevatten beide, ondanks het
// ontbreken van een categoryKeywords-treffer, wél het woordstam 'belasting'
// resp. 'fiscaal' — geen van de onderzochte ruisgevallen deed dat. Deze
// smalle, declaratieve lijst eist daarom dat de tekst zelf één van deze
// twee stammen bevat, los van (en aanvullend op) de bestaande
// MINISTRY_BYPASS_EXCLUDED_TERMS-uitsluiting hierboven, die intact blijft.
// 'fisca' (niet 'fiscaal') zodat zowel 'fiscaal' als de attributieve vorm
// 'fiscale' (bijv. "fiscale maatregel") matchen — 'fiscaal' zelf is geen
// substring van 'fiscale'.
const MINISTRY_BYPASS_REQUIRED_TERMS = ['belasting', 'fisca'];

// 'belasting' als kale substring matcht ook binnen 'Belastingdienst' — de
// organisatienaam, niet een inhoudelijk fiscaal signaal. Twee van de
// onderzochte ruisgevallen ("Digitale autonomie prioriteit voor
// Belastingdienst", "Dataomgeving Belastingdienst bleef jarenlang buiten
// beeld") noemen uitsluitend de organisatie, zonder zelf over een
// belastingregel te gaan — exact dezelfde soort onbedoelde substring-
// botsing als bij 'nba' binnen 'openbaar' (zie WORD_BOUNDARY_KEYWORDS
// hierboven). Een woordgrens-eis zou hier niet werken (die zou ook
// 'belastingen'/'belastingmaatregelen' breken, die juist wél moeten
// matchen), dus wordt de organisatienaam specifiek uit de tekst verwijderd
// vóórdat op de stam wordt gecontroleerd.
function hasMinistryBypassRequiredTerm(lowerText) {
  const withoutMinistryOrganizationNames = lowerText.replaceAll('belastingdienst', '');
  return MINISTRY_BYPASS_REQUIRED_TERMS.some((term) => keywordMatches(withoutMinistryOrganizationNames, term));
}

// Bron-gescopete term-regels (zie relevanceSignals/exclusionRules in
// sources.config.mjs). Witruimte wordt genormaliseerd zodat meerwoordige
// termen ook matchen bij dubbele spaties in de brontekst.
function normalizeForTermRules(text) {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function matchesTermRule(normalizedText, rule) {
  const all = rule.all ?? [];
  const any = rule.any ?? [];
  if (all.length === 0 && any.length === 0) return false;
  if (!all.every((term) => normalizedText.includes(term))) return false;
  return any.length === 0 || any.some((term) => normalizedText.includes(term));
}

export function matchesRelevanceSignal(text, rules = []) {
  const normalized = normalizeForTermRules(text);
  return rules.some((rule) => matchesTermRule(normalized, rule));
}

// De `category`-hint van de eerste relevanceSignals-regel mét hint die op
// deze tekst matcht (zelfde matcher als matchesRelevanceSignal), of
// undefined. Zie recordSourceItem: alleen gebruikt zonder categoryKeywords-treffer.
export function findRelevanceSignalCategory(text, rules = []) {
  const normalized = normalizeForTermRules(text);
  return rules.find((rule) => rule.category && matchesTermRule(normalized, rule))?.category;
}

export function matchesExclusionRule(title, text, rules = []) {
  const normalizedTitle = normalizeForTermRules(title);
  const normalizedText = normalizeForTermRules(text);
  return rules.some((rule) => {
    if (!matchesTermRule(rule.scope === 'title' ? normalizedTitle : normalizedText, rule)) return false;
    return !(rule.unlessAny ?? []).some((term) => normalizedText.includes(term));
  });
}

export function pickCategory(text, defaultCategory) {
  const scores = scoreCategories(text);
  const entries = Object.entries(scores);
  if (entries.length === 0) return defaultCategory;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// Bepaalt voor welke doelgroepen (zzp, bv-dga, werkgever, starter,
// mkb-ondernemer) een artikel relevant is, puur op basis van
// trefwoordtreffers in titel + samenvatting (zie audienceKeywords). Een
// artikel kan meerdere doelgroepen krijgen, of geen enkele — nooit geraden.
export function pickAudiences(text) {
  const lower = text.toLowerCase();
  const matches = [];
  for (const [audience, keywords] of Object.entries(audienceKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) matches.push(audience);
  }
  return matches;
}

export function pickPriority(text, pubDate) {
  const lower = text.toLowerCase();
  if (importantKeywords.some((kw) => lower.includes(kw))) return 'belangrijk';
  if (pubDate) {
    const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 14) return 'actueel';
  }
  return 'praktisch';
}

// Legt één relevant bronbericht vast als bronrecord (verwerkingsstatus
// 'kandidaat'). Gedeeld door de RSS-, sitemap- en KVK-paden, zodat
// categorisering en vastleggen identiek verlopen, ongeacht bron-type.
// `categoryHint` (optioneel, alleen vanuit de relevantiepoort van
// processSitemapSource): categorie van het signaal dat het bericht relevant
// maakte. Volgorde: categoryKeywords-treffer → categoryHint → defaultCategory.
//
// Datums: `item.pubDate` is bij RSS en de Rijksoverheid-API de
// publicatiedatum van de bron. Bij KVK (`item.lastModified`) is het de
// "laatst gewijzigd"-datum uit de sitemap; die telt nooit als nieuwsdatum
// en dus ook niet mee voor prioriteit 'actueel'.
function recordSourceItem(item, source, categoryHint) {
  const combinedText = `${item.title} ${item.description}`;
  const sourcePublishedAt = item.pubDate ? new Date(item.pubDate) : null;
  const sourceLastModified = item.lastModified ? new Date(item.lastModified) : null;
  if (sourcePublishedAt && Number.isNaN(sourcePublishedAt.getTime())) return null;
  if (sourceLastModified && Number.isNaN(sourceLastModified.getTime())) return null;
  if (!sourcePublishedAt && !sourceLastModified) return null;

  const category = pickCategory(combinedText, categoryHint ?? source.defaultCategory) ?? 'Fiscale actualiteit';
  return writeSourceRecord(SOURCES_DIR, {
    sourceUrl: item.link,
    sourceName: source.name,
    title: item.title,
    description: item.description,
    body: item.body ?? undefined,
    sourcePublishedAt: sourcePublishedAt ?? undefined,
    sourceLastModified: sourceLastModified ?? undefined,
    fetchedAt: new Date(),
    category,
    priority: pickPriority(combinedText, sourcePublishedAt),
    audiences: pickAudiences(combinedText),
    processingStatus: 'kandidaat',
  });
}

// Stadia: opgehaald -> succesvol geparsed -> relevant -> vastgelegd in de
// bronlaag. Elke bron rapporteert deze vier tellingen, ongeacht type.
// `reasons` is een los, bron-type-specifiek object met tellers die optellen
// tot `fetched` (zie elke process*Source-functie voor de exacte velden) —
// puur observability, bepaalt geen enkel gedrag.
function newStageCounters() {
  return { fetched: 0, parsed: 0, relevant: 0, recorded: 0 };
}

// --- Observability-helpers (geen invloed op filtering/selectie) ---
//
// Compacte, begrensde titel-steekproef per afwijzingsreden: maximaal
// REJECTION_SAMPLE_LIMIT titels per reden worden onthouden, zodat een run
// met honderden afwijzingen van dezelfde reden niet tot een enorme log
// leidt (expliciete eis). De tellingen zelf (stages.reasons) zijn altijd
// volledig/exact; alleen de voorbeeldtitels in de log zijn begrensd.
const REJECTION_SAMPLE_LIMIT = 5;

function addRejectionSample(samples, reason, title) {
  if (!title) return;
  if (!samples[reason]) samples[reason] = [];
  if (samples[reason].length < REJECTION_SAMPLE_LIMIT) samples[reason].push(title);
}

// Eén compacte regel met alle niet-nul tellers uit stages.reasons.
function logReasonBreakdown(stages) {
  const entries = Object.entries(stages.reasons ?? {}).filter(([, v]) => v > 0);
  if (entries.length === 0) return;
  log(`  Afwijzingen → ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')}`);
}

// Per reden met voorbeelden: maximaal REJECTION_SAMPLE_LIMIT titels, alleen
// voor redenen die daadwerkelijk voorkwamen.
function logRejectionSamples(samples) {
  for (const [reason, titles] of Object.entries(samples)) {
    if (!titles || titles.length === 0) continue;
    log(`    voorbeelden (${reason}): ${titles.map((t) => `"${t}"`).join(', ')}`);
  }
}

export async function processRssSource(source, existingUrls, remainingBudget) {
  const stages = newStageCounters();
  // Dekt exact de bestaande skip-punten in de loop hieronder — geen enkel
  // nieuw skip-criterium, alleen zichtbaar maken welk bestaand criterium
  // een item blokkeert.
  stages.reasons = { missingFields: 0, duplicate: 0, shortDescription: 0, irrelevant: 0, notEvaluated: 0 };
  const samples = {};

  let res;
  try {
    res = await fetchWithTimeout(source.feedUrl, FETCH_TIMEOUT_MS);
  } catch (err) {
    log(`  FOUT: kon feed niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
    return { added: 0, seen: 0, ok: false, stages };
  }
  if (!res.ok) {
    log(`  FOUT: HTTP ${res.status} bij ophalen feed. Bron overgeslagen.`);
    return { added: 0, seen: 0, ok: false, stages };
  }

  const xmlText = await res.text();
  let items;
  try {
    items = parseFeedItems(xmlText);
  } catch (err) {
    log(`  FOUT: kon feed niet parsen als RSS/Atom (${err.message}). Bron overgeslagen.`);
    return { added: 0, seen: 0, ok: false, stages };
  }
  if (!items) {
    log('  FOUT: onherkenbaar feedformaat (geen RSS- of Atom-items gevonden). Bron overgeslagen.');
    return { added: 0, seen: 0, ok: false, stages };
  }

  stages.fetched = items.length;
  log(`  ${items.length} item(s) in feed`);
  let added = 0;
  let sourceCount = 0;
  let itemsEvaluated = 0;

  for (const item of items) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
    itemsEvaluated += 1;
    if (!item.title || !item.link) {
      stages.reasons.missingFields += 1;
      continue;
    }
    if (existingUrls.has(item.link)) {
      stages.reasons.duplicate += 1;
      continue;
    }
    if (!item.description || item.description.length < 20) {
      // Onvoldoende broninformatie om een eigen samenvatting op te baseren.
      stages.reasons.shortDescription += 1;
      addRejectionSample(samples, 'shortDescription', item.title);
      continue;
    }
    stages.parsed += 1;

    if (source.requireKeywordMatch) {
      const scores = scoreCategories(`${item.title} ${item.description}`);
      if (Object.keys(scores).length === 0) {
        stages.reasons.irrelevant += 1;
        addRejectionSample(samples, 'irrelevant', item.title);
        continue;
      }
    }
    stages.relevant += 1;

    // De feed bevat alleen een korte omschrijving; de volledige tekst komt
    // van de bronpagina zelf (zie extractMainContentBody). Lukt dat niet,
    // dan wordt de bron zonder hoofdtekst vastgelegd en komt hij niet in
    // aanmerking voor een Avydo-artikel.
    const body = await fetchSourcePageBody(item.link);
    const recordId = recordSourceItem({ ...item, body }, source);
    if (!recordId) continue;

    existingUrls.add(item.link);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.recorded += 1;
    log(`  + bron ${recordId}${body ? ` (hoofdtekst ${body.length} tekens)` : ' (geen betrouwbare hoofdtekst)'}`);
  }
  // Items die nooit zijn bekeken omdat het bron- of totaalbudget al vóór
  // die iteratie op was (zie de break hierboven) — NIET hetzelfde als
  // "afgewezen": over deze items is simpelweg geen relevantie-oordeel
  // geveld. Geen gedragswijziging: dezelfde items werden ook vóór deze
  // wijziging al nooit bekeken, dit maakt dat alleen zichtbaar.
  stages.reasons.notEvaluated = items.length - itemsEvaluated;

  log(`  ${added} nieuwe bron(nen) vastgelegd`);
  logReasonBreakdown(stages);
  logRejectionSamples(samples);
  return { added, seen: items.length, ok: true, stages };
}

// --- Rijksoverheid: topic-API (POST /api/search) ---
//
// Discovery voor de Rijksoverheid-bron, voor een vast aantal bewust
// geselecteerde onderwerpen (zie sources.config.mjs). Live
// read-only onderzoek (zie git-historie) bevestigde de daadwerkelijk
// werkende requestState/queryConfig-structuur hieronder via een echte,
// opnieuw gecapturede browser-request — niet zelf verzonnen of uit het
// geheugen gereconstrueerd (een eerdere reconstructie-poging gaf HTTP 400
// "Invalid search request"). De ?hash=-queryparameter die de browser
// meestuurt is bevestigd een cache-sleutel, geen beveiliging: drie
// varianten (originele hash / geen hash / een willekeurige hash) gaven
// allemaal HTTP 200 met identieke resultaten, dus wordt hij hier
// weggelaten i.p.v. hard te coderen als geheim.
const RIJKSOVERHEID_TOPIC_API_URL = 'https://www.rijksoverheid.nl/api/search';
const RIJKSOVERHEID_TOPIC_RESULTS_PER_PAGE = 10;
// Veilige standaardwaarden, alleen gebruikt als een bron geen eigen
// maxPagesPerTopic/maxArticlesPerTopicPerRun instelt (zie
// sources.config.mjs) — voorkomt dat een ontbrekende configuratiewaarde
// stilzwijgend tot nul iteraties leidt.
const RIJKSOVERHEID_TOPIC_API_DEFAULT_MAX_PAGES_PER_TOPIC = 5;
const RIJKSOVERHEID_TOPIC_API_DEFAULT_MAX_ARTICLES_PER_TOPIC_PER_RUN = 20;

// result_fields/facets/sortList zijn 1-op-1 overgenomen uit de live
// gecapturede request (zie git-historie), bewust niet vereenvoudigd. De
// sort_date/activity_start_date facet-ranges zijn statisch overgenomen uit
// het capture-moment: dit zijn uitsluitend facet-bucketgrenzen (voor een
// UI-widget die hier niet gebruikt wordt), geen filter — ze hebben geen
// invloed op wélke resultaten worden teruggegeven, dus veroudering van deze
// vaste datums is hier onschadelijk.
export function buildRijksoverheidTopicSearchBody(topic, current) {
  return {
    requestState: {
      current,
      filters: [
        { field: 'topic', values: [topic], type: 'all' },
        { field: 'content_type', values: ['pro:newsDocument'], type: 'all' },
      ],
      resultsPerPage: RIJKSOVERHEID_TOPIC_RESULTS_PER_PAGE,
      searchTerm: '',
      sortDirection: '',
      sortField: '',
      sortList: [],
    },
    queryConfig: {
      filters: [{ field: 'content_type', values: ['pro:newsDocument'], type: 'all' }],
      result_fields: {
        author: { raw: {} },
        url: { raw: {} },
        page_title: { raw: {} },
        meta_description: { raw: {}, snippet: { size: 140, fallback: true } },
        sort_date: { raw: {} },
        information_type: { raw: {} },
        activity_start_date: { raw: {} },
        activity_end_date: { raw: {} },
        activity_type: { raw: {} },
        activity_location_title: { raw: {} },
        activity_location_description: { raw: {} },
        activity_organiser: { raw: {} },
        activity_show_time: { raw: {} },
        image_url: { raw: {} },
        edition_summary: { raw: {} },
      },
      disjunctiveFacets: ['information_type', 'activity_type', 'ministry'],
      facets: {
        ministry: { type: 'value', size: 100 },
        information_type: { type: 'value', size: 100 },
        activity_type: { type: 'value', size: 100 },
        sort_date: {
          type: 'range',
          ranges: [
            { from: '2026-09-29T00:00:00.000Z', to: '2026-10-06T23:59:59.999Z', name: 'past007Days' },
            { from: '2026-09-06T00:00:00.000Z', to: '2026-10-06T23:59:59.999Z', name: 'past030Days' },
            { from: '2025-10-06T00:00:00.000Z', to: '2026-10-06T23:59:59.999Z', name: 'past365Days' },
          ],
        },
        activity_start_date: {
          type: 'range',
          ranges: [
            { to: '2026-10-06T00:00:00.000Z', name: 'allPastPeriod' },
            { from: '2026-10-06T00:00:00.000Z', name: 'allFuturePeriod' },
          ],
        },
      },
      sortList: [{ field: 'sort_date', direction: 'desc' }],
    },
  };
}

async function postJsonWithTimeout(url, bodyObj, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)',
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(bodyObj),
    });
  } finally {
    clearTimeout(timer);
  }
}

// Haalt kandidaat-URL's op via de Rijksoverheid topic-API voor elk
// geconfigureerd onderwerp. Levert {loc, lastmod}-kandidaten op, zodat
// processSitemapSource ze via exact dezelfde route (relevantie, deduplicatie, publicatie) kan
// verwerken — deze functie levert uitsluitend kandidaten, nooit een directe
// publish-beslissing.
//
// Paginering (requestState.current, 1-indexed) stopt zodra een pagina
// minder dan RIJKSOVERHEID_TOPIC_RESULTS_PER_PAGE resultaten teruggeeft
// (laatste pagina), of bij het bereiken van maxPagesPerTopic/
// maxArticlesPerTopicPerRun — altijd een harde bovengrens, zodat een
// onverwachte of foutieve API-response nooit tot een oneindige lus kan
// leiden. Eén falend of onverwacht geformatteerd topic-verzoek slaat alleen
// dat topic over en blokkeert de andere topics niet.
export async function fetchRijksoverheidTopicApiUrls(topics, options = {}) {
  const maxPagesPerTopic = options.maxPagesPerTopic ?? RIJKSOVERHEID_TOPIC_API_DEFAULT_MAX_PAGES_PER_TOPIC;
  const maxArticlesPerTopicPerRun = options.maxArticlesPerTopicPerRun ?? RIJKSOVERHEID_TOPIC_API_DEFAULT_MAX_ARTICLES_PER_TOPIC_PER_RUN;
  const allEntries = [];

  for (const topic of topics) {
    const topicEntries = [];
    let pagesFetched = 0;
    for (let current = 1; current <= maxPagesPerTopic; current++) {
      let res;
      try {
        res = await postJsonWithTimeout(RIJKSOVERHEID_TOPIC_API_URL, buildRijksoverheidTopicSearchBody(topic, current), FETCH_TIMEOUT_MS);
      } catch (err) {
        log(`  topic "${topic}": FOUT bij ophalen pagina ${current} (${err.message}), overige topics gaan door.`);
        break;
      }
      pagesFetched += 1;
      if (!res.ok) {
        log(`  topic "${topic}": HTTP ${res.status} bij pagina ${current}, stoppen met dit topic.`);
        break;
      }
      let data;
      try {
        data = await res.json();
      } catch (err) {
        log(`  topic "${topic}": onverwachte (niet-JSON) response bij pagina ${current}, stoppen met dit topic.`);
        break;
      }
      const rawResults = data?.rawResponse?.rawResults;
      if (!Array.isArray(rawResults) || rawResults.length === 0) break;

      for (const r of rawResults) {
        const rawUrl = r?.url?.raw;
        if (!rawUrl) continue;
        const loc = rawUrl.startsWith('http') ? rawUrl : `https://www.rijksoverheid.nl${rawUrl}`;
        topicEntries.push({ loc, lastmod: r?.sort_date?.raw ?? null });
        if (topicEntries.length >= maxArticlesPerTopicPerRun) break;
      }
      if (topicEntries.length >= maxArticlesPerTopicPerRun) break;
      if (rawResults.length < RIJKSOVERHEID_TOPIC_RESULTS_PER_PAGE) break; // laatste pagina
    }
    log(`  topic: ${topic} | pagina's opgehaald: ${pagesFetched} | API-kandidaten: ${topicEntries.length}`);
    allEntries.push(...topicEntries);
  }

  const uniqueByUrl = new Map();
  let duplicatesAcrossTopics = 0;
  for (const e of allEntries) {
    if (uniqueByUrl.has(e.loc)) {
      duplicatesAcrossTopics += 1;
      continue;
    }
    uniqueByUrl.set(e.loc, e);
  }
  log(`  nieuwe kandidaten over alle topics samen: ${uniqueByUrl.size} (${duplicatesAcrossTopics} dubbel(e) tussen topics verwijderd)`);
  const deduped = [...uniqueByUrl.values()];
  deduped.sort((a, b) => {
    const da = a.lastmod ? Date.parse(a.lastmod) : 0;
    const db = b.lastmod ? Date.parse(b.lastmod) : 0;
    return db - da;
  });
  return deduped;
}

// Veiligheidsgrens op het aantal daadwerkelijk opgehaalde artikelpagina's
// per run, zelfde motivatie als KVK_MAX_PAGE_FETCHES_PER_RUN hieronder: de
// topic-API kan over alle topics samen honderden kandidaat-URL's opleveren,
// en zonder grens zou een run met veel irrelevante kandidaten onnodig veel
// pagina's kunnen opvragen vóór het budget/limiet stopt.
const RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN = 100;

// Trekt kalendermaanden af in UTC, met clamping op de laatste dag van de
// doelmaand (31 maart − 1 maand = 28/29 februari, niet 3 maart).
function subtractMonthsUtc(date, months) {
  const monthIndex = date.getUTCMonth() - months;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year, month, Math.min(date.getUTCDate(), lastDayOfMonth),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(),
  ));
}

// Leeftijdsgrens voor bronnen met `maxAgeMonths` (zie sources.config.mjs).
// true = kandidaat valt buiten de grens. Grensgedrag:
//  - precies op de grens (exact maxAgeMonths oud) telt als binnen de grens:
//    alleen strikt ouder wordt afgewezen;
//  - ontbrekende/ongeldige datum telt als buiten de grens — zelfde conventie
//    als recordSourceItem, dat nooit een bron zonder geldige datum vastlegt;
//  - een toekomstige datum is niet "ouder dan" de grens en telt als binnen.
export function isOutsideMaxAge(pubDate, maxAgeMonths, now) {
  if (!pubDate) return true;
  const published = new Date(pubDate);
  if (Number.isNaN(published.getTime())) return true;
  return published.getTime() < subtractMonthsUtc(now, maxAgeMonths).getTime();
}

// `now` is alleen injecteerbaar voor deterministische tests; productie
// gebruikt de standaardwaarde (moment van de run).
export async function processSitemapSource(source, existingUrls, remainingBudget, now = new Date()) {
  const stages = newStageCounters();
  // Zelfde principe als processRssSource: dekt exact de bestaande
  // skip-punten hieronder, geen nieuw skip-criterium.
  stages.reasons = { missingFields: 0, duplicate: 0, tooOld: 0, metadataRejected: 0, irrelevant: 0, notEvaluated: 0 };
  const samples = {};

  let items;
  if (source.type === 'rijksoverheid-topic-api') {
    let entries;
    try {
      entries = await fetchRijksoverheidTopicApiUrls(source.topics, {
        maxPagesPerTopic: source.maxPagesPerTopic,
        maxArticlesPerTopicPerRun: source.maxArticlesPerTopicPerRun,
      });
    } catch (err) {
      log(`  FOUT: kon topic-API niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
      return { added: 0, seen: 0, ok: false, stages };
    }
    // Title/description: null/leeg -> wordt van de artikelpagina zelf
    // gehaald (zie fetchArticlePageMeta hieronder). De topic-API levert uitsluitend kandidaat-URL's, de
    // bestaande article-fetch blijft verantwoordelijk voor de uiteindelijke
    // titel/samenvatting/ministerie.
    items = entries.map((e) => ({ title: null, link: e.loc, pubDate: e.lastmod, description: '' }));
    log(`  ${items.length} nieuwsartikel-URL('s) gevonden via de topic-API (gededupliceerd over ${source.topics.length} topic(s))`);
  } else {
    let res;
    try {
      res = await fetchWithTimeout(source.sitemapUrl, FETCH_TIMEOUT_MS);
    } catch (err) {
      log(`  FOUT: kon sitemap niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
      return { added: 0, seen: 0, ok: false, stages };
    }
    if (!res.ok) {
      log(`  FOUT: HTTP ${res.status} bij ophalen sitemap. Bron overgeslagen.`);
      return { added: 0, seen: 0, ok: false, stages };
    }
    const xmlText = await res.text();
    try {
      items = parseSitemapNewsItems(xmlText);
    } catch (err) {
      log(`  FOUT: kon sitemap niet parsen (${err.message}). Bron overgeslagen.`);
      return { added: 0, seen: 0, ok: false, stages };
    }
    if (!items) {
      log('  FOUT: onherkenbare sitemap (geen news:news-items gevonden). Bron overgeslagen.');
      return { added: 0, seen: 0, ok: false, stages };
    }
    log(`  ${items.length} item(s) in sitemap`);
  }

  stages.fetched = items.length;
  let added = 0;
  let sourceCount = 0;
  let itemsEvaluated = 0;
  let pageFetches = 0;
  // Hoofdtekst-extractie (zie extractRijksoverheidArticleBody) uitsluitend
  // voor de Rijksoverheid-bron; tellers alleen voor de logregel per run.
  const extractBody = source.type === 'rijksoverheid-topic-api';
  const bodyStats = { extracted: 0, fallback: 0 };
  // Een bron kan de gedeelde limiet per run zelf overschrijven (zie
  // maxArticlesPerSourcePerRun op de Rijksoverheid-bron in
  // sources.config.mjs); zonder eigen waarde geldt de gedeelde limiet.
  const sourceLimit = source.maxArticlesPerSourcePerRun ?? maxArticlesPerSourcePerRun;

  for (const item of items) {
    if (remainingBudget.count <= 0 || sourceCount >= sourceLimit) break;
    if (pageFetches >= RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN) {
      log(`  grens van ${RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN} opgehaalde pagina's per run bereikt, stoppen (overige kandidaten volgen in een volgende run).`);
      break;
    }
    itemsEvaluated += 1;
    // Title is bij de sitemap-index-variant pas na de paginafetch bekend
    // (zie hierboven) — alleen link is op dit punt een harde eis.
    if (!item.link) {
      stages.reasons.missingFields += 1;
      continue;
    }
    if (existingUrls.has(item.link)) {
      stages.reasons.duplicate += 1;
      continue;
    }
    // Alleen voor bronnen met `maxAgeMonths` (momenteel uitsluitend
    // rijksoverheid-topic-api): vóór de paginafetch, zodat een te oude
    // kandidaat niet verder wordt geëvalueerd.
    if (source.maxAgeMonths && isOutsideMaxAge(item.pubDate, source.maxAgeMonths, now)) {
      stages.reasons.tooOld += 1;
      addRejectionSample(samples, 'tooOld', item.link);
      continue;
    }

    // Sitemap-items hebben geen samenvattingstekst (en bij de
    // sitemap-index-variant ook geen titel): de artikelpagina zelf wordt
    // opgehaald voor de meta-description, titel (indien nog onbekend) en,
    // indien geconfigureerd, de ministerie-toewijzing. Een probleem bij één
    // artikel (pagina niet bereikbaar, geen description) slaat alleen dat
    // artikel over, niet de hele bron.
    pageFetches += 1;
    const { title: fetchedTitle, description, ministry, body } = await fetchArticlePageMeta(item.link, { extractBody });
    const title = item.title || fetchedTitle;
    if (!title || !description || description.length < 20) {
      log(`  - overgeslagen (geen betrouwbare titel/samenvattingstekst op bron-pagina): ${item.link}`);
      stages.reasons.metadataRejected += 1;
      addRejectionSample(samples, 'metadataRejected', title ?? item.link);
      continue;
    }
    const enrichedItem = { ...item, title, description, body };
    stages.parsed += 1;

    let categoryHint;
    if (source.requireKeywordMatch) {
      const combinedText = `${enrichedItem.title} ${enrichedItem.description}`;
      const scores = scoreCategories(combinedText);
      // ministryMatch geeft NIET automatisch relevantie aan puur
      // consumentengerichte Toeslagen-berichten (zie
      // MINISTRY_BYPASS_EXCLUDED_TERMS hierboven), en eist daarnaast
      // positief dat de tekst zelf een fiscale stam bevat (zie
      // MINISTRY_BYPASS_REQUIRED_TERMS hierboven) — dit raakt uitsluitend
      // de ministryBypass zelf, niet `scores`/`audienceMatch` hieronder:
      // een artikel dat toevallig ook zo'n term noemt maar daarnaast een
      // echt categoryKeyword/audienceSignal bevat, blijft gewoon relevant
      // via dat andere signaal.
      const ministryMatch =
        source.ministryBypass &&
        ministry === source.ministryBypass &&
        !hasMinistryBypassExcludedTerm(combinedText.toLowerCase()) &&
        hasMinistryBypassRequiredTerm(combinedText.toLowerCase());
      // Smalle, expliciete aanvulling op categoryKeywords (zie
      // rijksoverheidAudienceSignals in sources.config.mjs) — alleen voor
      // bronnen die zelf `audienceSignals` instellen (momenteel uitsluitend
      // rijksoverheid-topic-api). Bepaalt alleen OF een item relevant is, net
      // als ministryBypass hierboven; de categorie zelf blijft uitsluitend
      // via categoryKeywords/pickCategory in recordSourceItem bepaald.
      const audienceMatch = source.audienceSignals?.some((kw) => combinedText.toLowerCase().includes(kw));
      // Smal, bron-gescoped positief signaal (zie relevanceSignals in
      // sources.config.mjs, momenteel alleen rijksoverheid-topic-api) —
      // los van categoryKeywords en zonder de ministryBypass te versoepelen.
      const signalMatch = matchesRelevanceSignal(combinedText, source.relevanceSignals);
      let relevant = Object.keys(scores).length > 0 || ministryMatch || audienceMatch || signalMatch;
      // Sommige trefwoorden (zie corroborationRequiredKeywords in
      // sources.config.mjs — momenteel 'prinsjesdag' voor Rijksoverheid)
      // zijn op zichzelf te breed om als enig relevantiesignaal te gelden:
      // een read-only audit van de productierun van 2026-10-01 liet zien
      // dat 6 van de 10 nieuwe Rijksoverheid-artikelen uitsluitend via dit
      // ene trefwoord doorkwamen, zonder enig ander fiscaal signaal (o.a.
      // Bonaire-kosten-levensonderhoud, Oekraïne/ontwikkelingssamenwerking,
      // infrastructuur). Zo'n trefwoord telt daarom alleen mee als er ook
      // een ander signaal is: een categorie-treffer die niet uitsluitend
      // van dit trefwoord afhangt, een ministryMatch of een audienceMatch.
      // 'belastingplan' en alle overige trefwoorden staan niet in deze set
      // en blijven dus zelfstandig voldoende.
      if (relevant && source.corroborationRequiredKeywords?.length) {
        const scoresWithoutCorroborationKeywords = scoreCategories(
          combinedText,
          new Set(source.corroborationRequiredKeywords),
        );
        const hasOtherSignal =
          Object.keys(scoresWithoutCorroborationKeywords).length > 0 || ministryMatch || audienceMatch || signalMatch;
        if (!hasOtherSignal) relevant = false;
      }
      // Bron-gescopete uitsluitingen (zie exclusionRules in
      // sources.config.mjs): gaan vóór elk positief signaal, omdat de audit
      // liet zien dat deze false positives zowel via categoryKeywords
      // ('box 3' in een IT-bericht) als via ministryBypass binnenkwamen.
      if (relevant && matchesExclusionRule(enrichedItem.title, combinedText, source.exclusionRules)) relevant = false;
      if (!relevant) {
        stages.reasons.irrelevant += 1;
        addRejectionSample(samples, 'irrelevant', title);
        continue;
      }
      // Categorie-hint uitsluitend van een signaal dat dit artikel
      // daadwerkelijk relevant maakte; wint nooit van een
      // categoryKeywords-treffer (zie recordSourceItem).
      categoryHint =
        (signalMatch ? findRelevanceSignalCategory(combinedText, source.relevanceSignals) : undefined) ??
        (audienceMatch ? source.audienceSignalsCategory : undefined);
    }
    stages.relevant += 1;

    const recordId = recordSourceItem(enrichedItem, source, categoryHint);
    if (!recordId) continue;

    existingUrls.add(item.link);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.recorded += 1;
    log(`  + bron ${recordId}`);
    if (extractBody) {
      if (body) bodyStats.extracted += 1;
      else bodyStats.fallback += 1;
      log(body ? `    body extracted (${body.length} tekens)` : '    body extraction failed (bron zonder hoofdtekst vastgelegd)');
    }
  }
  // Zie de toelichting bij processRssSource: items die vóór hun beurt al
  // niet meer bekeken werden doordat het budget op was. Geen
  // gedragswijziging, alleen zichtbaar gemaakt.
  stages.reasons.notEvaluated = items.length - itemsEvaluated;

  log(`  ${added} nieuwe bron(nen) vastgelegd`);
  if (extractBody && added > 0) log(`  Body-extractie: ${bodyStats.extracted} extracted, ${bodyStats.fallback} failed`);
  logReasonBreakdown(stages);
  logRejectionSamples(samples);
  return { added, seen: items.length, ok: true, stages };
}

// --- KVK: sitemap_index.xml -> documents-*.xml ---
//
// KVK publiceert geen RSS/nieuws-sitemap (zie sources.config.mjs voor de
// onderzoeksgeschiedenis). Wel bevat de publieke sitemap_index.xml een
// reeks documents-*.xml-sub-sitemaps met alle content-URL's + <lastmod>
// (bevestigd via een tijdelijke, geïsoleerde GitHub Actions-proef: 10
// sub-sitemaps, 1.837 URL's, allemaal met geldige <lastmod>). Dit bevat
// alle KVK-content door elkaar (ook handelsregister-/productpagina's,
// evenementen, persberichten) — filtering gebeurt daarom in twee stappen,
// zie selectKvkCandidates hieronder.

// Zet een KVK-URL-pad om naar leesbare tekst, voor de relevantie-vóórfilter
// (vóór de artikelpagina zelf wordt opgehaald is alleen de URL bekend).
export function kvkSlugToText(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.replace(/[/-]+/g, ' ').trim();
  } catch {
    return '';
  }
}

// Haalt sitemap_index.xml op en volgt elke documents-*.xml-sub-sitemap die
// daarin genoemd wordt (aantal/naamgeving ligt niet vast, dus niet
// hardcoded). Verzamelt alle <url><loc>+<lastmod>-paren. lastmod is een
// "laatst gewijzigd"-signaal, geen bewezen publicatiedatum — zie
// sourceLastModified-opmerking bij processKvkSource.
export async function fetchKvkDocumentUrls(sitemapIndexUrl) {
  const indexRes = await fetchWithTimeout(sitemapIndexUrl, FETCH_TIMEOUT_MS);
  if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status} bij sitemap_index.xml`);
  const indexXml = await indexRes.text();
  const subSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const documentSitemaps = subSitemaps.filter((u) => /\/documents-\d+\.xml$/i.test(u));
  if (documentSitemaps.length === 0) {
    throw new Error('geen documents-*.xml-sitemaps gevonden in sitemap_index.xml');
  }

  const entries = [];
  for (const sitemapUrl of documentSitemaps) {
    let res;
    try {
      res = await fetchWithTimeout(sitemapUrl, FETCH_TIMEOUT_MS);
    } catch {
      continue; // één falende sub-sitemap mag de andere niet blokkeren
    }
    if (!res.ok) continue;
    const xml = await res.text();
    const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    for (const block of blocks) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null;
      if (loc) entries.push({ loc, lastmod });
    }
  }
  return entries;
}

// Procedure-/formulier-/product-/servicesignalen. De eerste KVK-dry-run liet
// o.a. "Formulier 1: Eenmanszaak inschrijven", "Jaarrekeningen opvragen",
// "Convenant Douane" en "Autorisaties voor Handelsregister" door: deze
// pagina's bevatten toevallig dezelfde categoryKeywords als echte
// kennisartikelen (bijv. "eenmanszaak", "jaarrekening"), maar zijn
// formulieren/procedures/diensten, geen inhoudelijke artikelen. Dezelfde
// `.includes()`-aanpak als scoreCategories, maar als negatieve lijst: een
// treffer hier sluit de kandidaat uit, ongeacht een categoryKeywords-match.
// Stam-vormen (bijv. "inschrij" i.p.v. alleen "inschrijven") dekken zowel
// werkwoords- als zelfstandignaamwoordvormen ("inschrijven", "inschrijving",
// "inschrijfformulier").
export const kvkProcedureKeywords = [
  'formulier',
  'inschrij', // inschrijven, inschrijving, inschrijfformulier, ...
  'uitschrij', // uitschrijven, uitschrijving, uitschrijfformulier, ...
  'afspraak maken',
  'convenant',
  'rekentool',
  'rekenmodule',
  'autorisatie', // autorisatie, autorisaties
  'opvragen', // dry-run 2: "Jaarrekeningen opvragen"
  'opvraag', // opvraagprocedure, opvraagformulier, ... — NB: "opvraag" (dubbele a) is geen substring van "opvragen" (enkele a), vandaar beide vormen apart
  'deponeringsprocedure', // de inhoudelijke "deponeren jaarrekening"-artikelen gebruiken dit woord niet
  'aanvragen',
  'uittreksel',
  'machtig', // machtiging, machtigen, gemachtigde
];

export function isKvkProcedurePage(text) {
  const lower = text.toLowerCase();
  return kvkProcedureKeywords.some((kw) => lower.includes(kw));
}

// Eerste padsegment van een KVK-URL (bijv. "deponeren" voor
// kvk.nl/deponeren/jaarrekening-deponeren/), gedeeld door de hub-/dienst-/
// productpagina-detectie hieronder én door de dry-run-rapportage
// (dry-run-kvk.mjs) om kandidaten per sectie te kunnen tellen.
export function kvkFirstPathSegment(url) {
  try {
    const { pathname } = new URL(url);
    const [firstSegment] = pathname.split('/').filter(Boolean);
    return (firstSegment ?? '').toLowerCase();
  } catch {
    return '';
  }
}

// Hub-/overzichtspagina's (bijv. /onderwerp/prinsjesdag/) zijn geen concreet
// kennisartikel maar een verzameling verwijzingen naar andere pagina's.
// Generiek op het eerste padsegment, niet op een exacte URL-lijst — zodat
// vergelijkbare hub-secties automatisch meegenomen worden.
const KVK_HUB_PATH_SEGMENTS = new Set(['onderwerp', 'onderwerpen']);

export function isKvkHubPage(url) {
  return KVK_HUB_PATH_SEGMENTS.has(kvkFirstPathSegment(url));
}

// --- KVK-dienst-/productpagina's (dry-run 3 -> 4) ---
//
// Dry-run 3 liet zien dat "jaarrekening" als sterk signaal ook KVK's eigen
// deponerings-/bestel-/perspagina's naar tier 'hoog' tilde (bijv.
// "Jaarrekening deponeren bedrijfsklasse groot", "KVK Dataservice
// Jaarrekeningen", "Presskit KVK - Beeldbank") — dit zijn procedure-,
// product- of mediapagina's, geen accountancy-inhoud. Bewust GEEN blokkade
// van het woord "jaarrekening" zelf: inhoudelijke artikelen als
// "Jaarrekening wel of niet deponeren?" of "Waaruit bestaat de
// jaarrekening?" moeten gewoon door kunnen blijven gaan. Daarom twee
// aparte, specifiekere signalen:
//
// 1. Padniveau: /producten-bestellen/ en /pers/ zijn, op basis van alle tot
//    nu toe geziene voorbeelden, uitsluitend commerciële product-/dataservice-
//    resp. pers-/mediapagina's — hier is nog geen enkel inhoudelijk
//    accountancy-artikel in aangetroffen, dus een hard padniveau-blok is
//    verantwoord. /deponeren/ bevat WEL een mix van procedure- én
//    inhoudelijke pagina's en wordt daarom NIET als geheel geblokkeerd.
// 2. Titelniveau: specifieke, administratieve/procedurele termen
//    ("bedrijfsklasse", "uiterste termijn/datum", "handleiding", de kale
//    actie-titel "jaarrekening(en) deponeren" zonder toelichting) die
//    wijzen op KVK's eigen proces i.p.v. uitleg over de jaarrekening zelf.
//
// Dry-run 4 (ronde 4 -> 5): deze titelcheck liep aanvankelijk over
// titel + samenvatting samen, waardoor drie inhoudelijke /deponeren/-
// artikelen ("Waaruit bestaat de jaarrekening?", "Een XBRL-jaarrekening
// opstellen en deponeren", "Zelf deponeren van je jaarrekening") onterecht
// werden afgewezen omdat hun meta description toevallig een van deze
// termen bevatte (bijv. "handleiding" of "jaarrekening deponeren" in een
// zin). isKvkServiceOrProductPage mag daarom NOOIT de samenvatting
// ontvangen — alleen URL en titel/H1, die de auteur daadwerkelijk zelf
// heeft gekozen en dus een betrouwbaarder signaal zijn.
const KVK_SERVICE_PATH_SEGMENTS = new Set(['producten-bestellen', 'pers']);

export function isKvkServiceOrProductPath(url) {
  return KVK_SERVICE_PATH_SEGMENTS.has(kvkFirstPathSegment(url));
}

export const kvkServiceOrProductKeywords = [
  'bedrijfsklasse',
  'uiterste termijn',
  'uiterste datum',
  'handleiding',
  'jaarrekening deponeren', // kale actie-titel zonder toelichting, bijv. "Jaarrekeningen deponeren"
  'jaarrekeningen deponeren',
  'open dataset',
  'open data',
  'dataservice',
  'bestellen',
  'presskit',
  'beeldbank',
  'persmateriaal',
  'mediamateriaal',
];

// `title` moet de paginatitel/H1 zijn (of, in de URL-vóórfilter, de
// URL-slug-tekst) — NOOIT de samenvatting/meta description. Zie de
// toelichting hierboven.
export function isKvkServiceOrProductPage(url, title) {
  if (isKvkServiceOrProductPath(url)) return true;
  const lower = normalizeKvkText(title);
  return kvkServiceOrProductKeywords.some((kw) => lower.includes(normalizeKvkText(kw)));
}

// --- Redactionele relevantielaag (dry-run 2 -> 3) ---
//
// De eerste twee dry-runs lieten zien dat categoryKeywords/scoreCategories
// alléén onvoldoende is: een los trefwoord als "belasting" of "eenmanszaak"
// komt evengoed voor in een algemene KVK-pagina (bijv. "Hoe werkt een
// faillissement?", "Wat is een rechtsvorm?") als in een echt fiscaal/
// accountancy-artikel. Deze laag combineert drie soorten signalen bovenop
// de bestaande categoryKeywords-match, zonder die te vervangen.

// Specifieke, hoge-precisie fiscale/accountancy-termen: komen vrijwel nooit
// voor in een algemene KVK-pagina, wél in een echt kennisartikel.
export const kvkStrongFiscalKeywords = [
  'btw-aangifte', 'kleineondernemersregeling', 'eu-kor', 'omzetbelasting',
  'naheffingsaanslag', 'btw-tarie', 'btw-regel', 'vennootschapsbelasting', 'vpb', // "btw-tarie" dekt zowel btw-tarief als btw-tarieven
  'box 2', 'box 3', 'dividendbelasting', 'dividend', 'gebruikelijk loon', 'dga',
  'loonheffing', 'werkgeversheffing', 'jaarrekening', 'belastingplan', 'belastingtarie', // "belastingtarie" dekt zowel belastingtarief als belastingtarieven
  'inkomstenbelasting', 'fiscale gevolgen', 'fiscale wijziging', 'fiscaal voordeel',
  'schijnzelfstandigheid', 'dba', 'zzp-wetgeving', 'administratieplicht',
  'boekhouden', 'boekhouding',
];

// Signalen die wijzen op een vergelijkende/keuze-insteek bij een
// rechtsvorm-onderwerp (i.t.t. een pure, algemene definitie- of basispagina
// zoals "Wat is een rechtsvorm?").
export const kvkComparisonKeywords = [
  'versus', ' of bv', ' of een bv', ' of eenmanszaak', 'vergelijk', 'verschil tussen',
  'voor- en nadelen', 'overstap van', 'overstap naar', 'omzetten naar',
  'wisselen van rechtsvorm', 'welke rechtsvorm', 'rechtsvorm kiezen',
  'kies je rechtsvorm', 'kies je je rechtsvorm',
];

// Algemene KVK-onderwerpen die structureel NIET automatisch relevant zijn
// voor een accountancy-/belastingadvieskantoor, tenzij er ook een sterk
// fiscaal signaal (kvkStrongFiscalKeywords) of vergelijkende insteek
// (kvkComparisonKeywords) aanwezig is. Voorbeelden uit dry-run 2: "Hoe werkt
// een faillissement?", "Schulden oplossen bij een eenmanszaak",
// "Financiering bedrijfsovername", "Faillissementsfraude".
export const kvkGeneralTopicKeywords = [
  'faillissement', 'schulden oplossen', 'financiering', 'bedrijfsovername',
  'risico', 'bedrijfsinformatie', 'boekhoudsoftware', 'dataset', 'open data',
  'trendrapport', 'conjunctuur', 'ondernemersvertrouwen', 'ondernemerssentiment',
  'starters en stoppers', 'onderzoek onder ondernemers',
];

// Titels die louter een basisdefinitie geven ("Wat is een rechtsvorm?",
// "Wat is de EU-KOR?") — op zichzelf geen signaal vóór of tegen relevantie,
// maar in combinatie met het ontbreken van een sterk/vergelijkend signaal
// wijst dit op een algemene basispagina (zie classifyKvkRelevance).
export function isKvkPureDefinitionTitle(title) {
  return /^wat is (een|de|het)\b/i.test(title.trim());
}

const KVK_RECHTSVORM_CATEGORY = 'Ondernemen & rechtsvormen';

// Combineert categoryKeywords/scoreCategories met de drie signalen hierboven
// tot een redactionele tier: 'hoog' (duidelijk relevant voor Avydo),
// 'twijfel' (alleen een brede trefwoordtreffer, geen sterk fiscaal signaal —
// menselijke beoordeling aanbevolen) of 'afgewezen'. Een sterk signaal of
// vergelijkende insteek overstemt altijd een demotie-signaal (bijv. een
// artikel over de fiscale gevolgen van een bedrijfsovername blijft
// bruikbaar, ondanks het woord "bedrijfsovername").
// kvkSlugToText zet "-" om naar spaties (zie hierboven), dus een hyphen in
// een trefwoord (bijv. "btw-aangifte") zou op URL-slug-niveau nooit matchen
// zonder normalisatie. Vervangt "-" door een spatie aan beide kanten van de
// vergelijking, zodat "btw-aangifte" (echte titel) en "btw aangifte doen"
// (URL-slug) allebei herkend worden.
function normalizeKvkText(text) {
  return text.toLowerCase().replace(/-/g, ' ');
}

export function classifyKvkRelevance(text) {
  const lower = normalizeKvkText(text);
  const hasStrong = kvkStrongFiscalKeywords.some((kw) => lower.includes(normalizeKvkText(kw)));
  const hasComparison = kvkComparisonKeywords.some((kw) => lower.includes(normalizeKvkText(kw)));
  const hasGeneralTopic = kvkGeneralTopicKeywords.some((kw) => lower.includes(normalizeKvkText(kw)));
  const isPureDefinition = isKvkPureDefinitionTitle(text);
  const categoryScores = scoreCategories(text);
  const matchedCategories = Object.keys(categoryScores);

  if (matchedCategories.length === 0) {
    return { tier: 'afgewezen', reason: 'geen treffer op een bestaande Kenniscentrum-categorie' };
  }
  if (isPureDefinition && !hasStrong && !hasComparison) {
    return { tier: 'afgewezen', reason: 'algemene definitie-/basispagina zonder fiscale verdieping of vergelijking' };
  }
  if (hasGeneralTopic && !hasStrong && !hasComparison) {
    return { tier: 'afgewezen', reason: 'algemeen KVK-onderwerp zonder aantoonbare fiscale/accountancy-insteek' };
  }
  if (hasStrong) {
    return { tier: 'hoog', reason: 'sterk fiscaal/accountancy-trefwoord gevonden' };
  }
  if (hasComparison) {
    return { tier: 'hoog', reason: 'inhoudelijke vergelijking/keuze tussen rechtsvormen met fiscale relevantie' };
  }
  const onlyRechtsvormMatch = matchedCategories.every((c) => c === KVK_RECHTSVORM_CATEGORY);
  if (onlyRechtsvormMatch) {
    return { tier: 'afgewezen', reason: 'algemene rechtsvorm-pagina (bv/eenmanszaak/vof/maatschap) zonder vergelijking of fiscale verdieping' };
  }
  return { tier: 'twijfel', reason: 'alleen een brede trefwoordtreffer, geen sterk fiscaal signaal — handmatige beoordeling aanbevolen' };
}

// Extra waarborg tegen onbetrouwbare extractie (zie de "Presskit KVK -
// Beeldbank"-casus uit dry-run 3): die pagina kreeg tier 'hoog' puur via de
// samenvatting, terwijl de titel zelf geen enkel fiscaal/categorie-signaal
// bevatte — een aanwijzing dat de samenvatting-fallback in
// extractKvkArticleFields (eerste substantiële <p>) niet-gerelateerde
// pagina-/navigatietekst kan hebben opgepikt. Een "hoog"-classificatie die
// uitsluitend op de samenvatting steunt, zonder dat de titel zelf ook maar
// één signaal geeft, wordt daarom teruggezet naar 'twijfel' i.p.v. blind
// vertrouwd. Raakt alleen tier 'hoog'; 'twijfel' en 'afgewezen' blijven
// zoals ze waren.
export function downgradeIfTitleHasNoSignal(title, classification) {
  if (classification.tier !== 'hoog') return classification;
  const normalizedTitle = normalizeKvkText(title);
  const titleHasSignal = Object.keys(scoreCategories(title)).length > 0
    || kvkStrongFiscalKeywords.some((kw) => normalizedTitle.includes(normalizeKvkText(kw)))
    || kvkComparisonKeywords.some((kw) => normalizedTitle.includes(normalizeKvkText(kw)));
  if (titleHasSignal) return classification;
  return {
    tier: 'twijfel',
    reason: 'alleen de samenvatting bevat een signaal, niet de titel zelf — mogelijk onbetrouwbare extractie, handmatige beoordeling aanbevolen',
  };
}

const KVK_TIER_ORDER = { hoog: 0, twijfel: 1 };

// Zuiver filter-/selectiepad, gedeeld door de productie-run (processKvkSource)
// en het aparte dry-run-script (dry-run-kvk.mjs): dedupliceert op URL,
// sorteert op lastmod (meest recent eerst), past het URL-vormfilter toe
// (bevestigde artikel-URL's volgen het patroon kvk.nl/<categorie>/<slug>/,
// precies twee padsegmenten, geen hub-/overzichtspagina zoals
// /onderwerp/...), daarna de procedure-/formuliersignaal- en de dienst-/
// productpagina-uitsluiting (isKvkServiceOrProductPage) en de redactionele
// relevantiefilter (classifyKvkRelevance) op de URL-slug, en ten slotte een
// rangschikking vóór er ook maar één pagina wordt opgehaald:
// eerst tier 'hoog', dan 'twijfel', met lastmod als tie-breaker binnen een
// tier. Hergebruikt bewust dezelfde categoryKeywords/scoreCategories als de
// andere bronnen — geen tweede, parallel filtersysteem.
export function selectKvkCandidates(entries, existingUrls) {
  const uniqueByUrl = new Map();
  for (const e of entries) {
    if (!uniqueByUrl.has(e.loc)) uniqueByUrl.set(e.loc, e);
  }
  const deduped = [...uniqueByUrl.values()];

  deduped.sort((a, b) => {
    const da = a.lastmod ? Date.parse(a.lastmod) : 0;
    const db = b.lastmod ? Date.parse(b.lastmod) : 0;
    return db - da;
  });

  const afterUrlFilter = deduped.filter((e) => {
    if (isKvkHubPage(e.loc)) return false;
    try {
      const { pathname } = new URL(e.loc);
      const segments = pathname.split('/').filter(Boolean);
      return segments.length === 2;
    } catch {
      return false;
    }
  });

  const afterRelevanceFilter = afterUrlFilter.filter((e) => {
    const text = kvkSlugToText(e.loc);
    if (isKvkProcedurePage(text)) return false;
    if (isKvkServiceOrProductPage(e.loc, text)) return false;
    return classifyKvkRelevance(text).tier !== 'afgewezen';
  });

  const afterDedupAgainstExisting = afterRelevanceFilter.filter((e) => !existingUrls.has(e.loc));

  const ranked = [...afterDedupAgainstExisting].sort((a, b) => {
    const tierA = KVK_TIER_ORDER[classifyKvkRelevance(kvkSlugToText(a.loc)).tier] ?? 1;
    const tierB = KVK_TIER_ORDER[classifyKvkRelevance(kvkSlugToText(b.loc)).tier] ?? 1;
    if (tierA !== tierB) return tierA - tierB;
    const da = a.lastmod ? Date.parse(a.lastmod) : 0;
    const db = b.lastmod ? Date.parse(b.lastmod) : 0;
    return db - da;
  });

  return { deduped, afterUrlFilter, afterRelevanceFilter, afterDedupAgainstExisting, ranked };
}

// Zuiver (geen netwerk): onderzoekt de HTML van een KVK-artikelpagina op een
// betrouwbare titel en samenvatting. De <title> van KVK-pagina's wordt niet
// betrouwbaar per pagina gerenderd (bevestigd tijdens onderzoek) en wordt
// daarom NOOIT gebruikt. De zichtbare <h1> is wel de daadwerkelijke
// artikelkop. Als titel of samenvatting niet betrouwbaar te vinden zijn,
// wordt null teruggegeven (geen gegokte titel/summary) en slaat de caller
// dat artikel over.
export function extractKvkArticleFields(html) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match ? stripHtml(h1Match[1]) : null;
  if (!title || title.length < 5) return null;

  let description = extractMetaDescription(html);
  if (!description || description.length < 20) {
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((t) => t.length > 60);
    description = paragraphs[0] ?? null;
  }
  if (!description || description.length < 20) return null;

  return { title, description };
}

export async function fetchKvkArticleMeta(url) {
  let res;
  try {
    res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  const fields = extractKvkArticleFields(html);
  if (!fields) return null;
  let body = null;
  try {
    body = extractMainContentBody(html);
  } catch {
    body = null;
  }
  return { ...fields, body };
}

// --- Overlapcontrole met de bestaande Avydo-kennisbank ---
//
// Puur tekstueel/trefwoord-gebaseerd (Jaccard-overlap over betekenisvolle
// woorden in de titel) — geen AI/embeddings, geen externe aanroep. Alleen
// bedoeld om dubbele varianten van hetzelfde onderwerp te voorkomen, niet
// als vervanging van categoryKeywords/classifyKvkRelevance.

const KVK_OVERLAP_STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'of', 'van', 'voor', 'met', 'bij', 'op', 'aan', 'is', 'zijn',
  'wat', 'hoe', 'je', 'jouw', 'uw', 'u', 'dit', 'die', 'dat', 'als', 'om', 'te', 'in',
  'naar', 'over', 'uit', 'niet', 'zo', 'werkt', 'wordt', 'worden', 'kan', 'kunt', 'moet',
  'moeten', 'welke', 'wanneer', 'deze', 'dan', 'ook', 'per',
]);

// Grove, veilige stam-normalisatie voor Nederlandse meervouden (bijv.
// "ondernemer"/"ondernemers", "artikel"/"artikelen"), zodat de Jaccard-
// overlap niet onterecht laag uitvalt puur door enkelvoud/meervoud. Bewust
// conservatief (alleen op langere woorden): onregelmatige meervouden
// (loon/lonen) worden gemist, wat voor deze losse overlap-heuristiek
// acceptabel is.
function kvkWordStem(word) {
  if (word.length > 6 && word.endsWith('en')) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function kvkSignificantWords(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KVK_OVERLAP_STOPWORDS.has(w))
    .map(kvkWordStem);
}

// Minimale Jaccard-overlap (gedeelde woorden / unie van woorden) tussen een
// KVK-kandidaat-titel en een bestaande artikeltitel om als "overlap" te
// gelden. Bewust ruim ingesteld: liever een kandidaat onterecht als
// twijfelgeval rapporteren dan stilzwijgend een inhoudelijke dubbeling
// publiceren.
export const KVK_OVERLAP_JACCARD_THRESHOLD = 0.4;

// Leest titel, categorie en bron-URL van alle bestaande (Avydo-)artikelen,
// als basis voor de overlapcontrole hieronder en in de redactiestap.
export function loadExistingArticlesMeta(contentDir = CONTENT_DIR) {
  if (!existsSync(contentDir)) return [];
  const articles = [];
  for (const file of readdirSync(contentDir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(path.join(contentDir, file), 'utf8');
    const title = text.match(/^title:\s*"((?:[^"\\]|\\.)*)"/m)?.[1]?.replace(/\\"/g, '"');
    const category = text.match(/^category:\s*"([^"]*)"/m)?.[1] ?? null;
    const sourceUrl = text.match(/^sourceUrl:\s*"([^"]*)"/m)?.[1] ?? null;
    if (!title) continue;
    articles.push({ file, title, category, sourceUrl });
  }
  return articles;
}

// Vergelijkt alleen binnen dezelfde categorie (voorkomt toevallige overlap
// tussen totaal verschillende onderwerpen) en geeft de sterkst overlappende
// bestaande artikel terug, of null als niets de drempel haalt.
export function findOverlappingArticle(candidateTitle, candidateCategory, existingArticles) {
  const candidateWords = new Set(kvkSignificantWords(candidateTitle));
  if (candidateWords.size === 0) return null;

  let best = null;
  for (const article of existingArticles) {
    if (candidateCategory && article.category && article.category !== candidateCategory) continue;
    const existingWords = new Set(kvkSignificantWords(article.title));
    if (existingWords.size === 0) continue;
    const intersectionSize = [...candidateWords].filter((w) => existingWords.has(w)).length;
    const unionSize = new Set([...candidateWords, ...existingWords]).size;
    const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
    if (jaccard >= KVK_OVERLAP_JACCARD_THRESHOLD && (!best || jaccard > best.jaccard)) {
      best = { file: article.file, title: article.title, jaccard };
    }
  }
  return best;
}

// Veiligheidsgrens op het aantal daadwerkelijk opgehaalde artikelpagina's
// per run: de sitemap bevat ~1.800 URL's, en zonder grens zou een eerste
// run (vóór dedup tegen bestaande content opbouwt) in theorie honderden
// pagina's kunnen opvragen. Ruim boven maxArticlesPerSourcePerRun, zodat dit
// in de praktijk alleen bij die eerste/lege run ooit relevant wordt. Ook
// hergebruikt door dry-run-kvk.mjs, zodat de dry-run dezelfde grens
// aanhoudt als de productie-run.
export const KVK_MAX_PAGE_FETCHES_PER_RUN = 50;

export async function processKvkSource(source, existingUrls, remainingBudget) {
  const stages = newStageCounters();

  let entries;
  try {
    entries = await fetchKvkDocumentUrls(source.sitemapIndexUrl);
  } catch (err) {
    log(`  FOUT: kon KVK-sitemaps niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
    return { added: 0, seen: 0, ok: false, stages };
  }

  stages.fetched = entries.length;
  log(`  ${entries.length} URL-entries in documents-*.xml-sitemaps`);

  const { afterUrlFilter, afterRelevanceFilter, ranked } = selectKvkCandidates(entries, existingUrls);
  log(`  ${afterUrlFilter.length} na URL-/hub-vormfilter, ${afterRelevanceFilter.length} na redactionele relevantiefilter, ${ranked.length} gerangschikt en klaar om op te halen`);

  // Observability-tellers voor de bestaande KVK-filterpipeline (zie boven):
  // de filterlogica zelf (selectKvkCandidates, isKvkProcedurePage,
  // isKvkServiceOrProductPage, classifyKvkRelevance,
  // downgradeIfTitleHasNoSignal, findOverlappingArticle) blijft ongewijzigd —
  // hier wordt alleen geteld/gelogd wat die functies al beslissen.
  stages.reasons = {
    afterUrlHubFilter: afterUrlFilter.length,
    editorialCandidates: ranked.length,
    pageFetches: 0,
    parseFailures: 0,
    procedureServiceRejected: 0,
    relevanceRejected: 0,
    titleSignalDowngraded: 0,
    overlapRejected: 0,
    notFetchedDueToLimit: 0,
  };
  const samples = {};

  const existingArticlesMeta = loadExistingArticlesMeta();

  let added = 0;
  let sourceCount = 0;
  let pagesFetched = 0;

  for (const candidate of ranked) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
    if (pagesFetched >= KVK_MAX_PAGE_FETCHES_PER_RUN) {
      log(`  grens van ${KVK_MAX_PAGE_FETCHES_PER_RUN} opgehaalde pagina's per run bereikt, stoppen (overige kandidaten volgen in een volgende run).`);
      break;
    }
    pagesFetched += 1;

    const meta = await fetchKvkArticleMeta(candidate.loc);
    if (!meta) {
      log(`  - overgeslagen (geen betrouwbare titel/samenvatting op pagina): ${candidate.loc}`);
      stages.reasons.parseFailures += 1;
      addRejectionSample(samples, 'parseFailures', candidate.loc);
      continue;
    }
    stages.parsed += 1;

    // lastmod is "laatst gewijzigd", geen bewezen publicatiedatum (zie
    // sources.config.mjs): vastgelegd als sourceLastModified, nooit als
    // publicatiedatum van de bron.
    const item = { title: meta.title, description: meta.description, body: meta.body, link: candidate.loc, lastModified: candidate.lastmod };
    const combinedText = `${item.title} ${item.description}`;

    if (isKvkProcedurePage(combinedText)) {
      log(`  - overgeslagen (formulier-/product-/procedure-/servicepagina, geen kennisartikel): ${candidate.loc}`);
      stages.reasons.procedureServiceRejected += 1;
      addRejectionSample(samples, 'procedureServiceRejected', meta.title);
      continue;
    }
    // Alleen de titel (nooit de samenvatting) — zie toelichting bij
    // isKvkServiceOrProductPage hierboven.
    if (isKvkServiceOrProductPage(candidate.loc, meta.title)) {
      log(`  - overgeslagen (KVK-dienst-/productpagina, geen accountancy-inhoud): ${candidate.loc}`);
      stages.reasons.procedureServiceRejected += 1;
      addRejectionSample(samples, 'procedureServiceRejected', meta.title);
      continue;
    }

    let classification = classifyKvkRelevance(combinedText);
    const tierBeforeDowngrade = classification.tier;
    classification = downgradeIfTitleHasNoSignal(meta.title, classification);
    if (classification.tier !== tierBeforeDowngrade) {
      // Informationeel: telt niet exclusief, het item kan nog steeds
      // "relevant" worden (lager tier) of hieronder alsnog afgewezen worden.
      stages.reasons.titleSignalDowngraded += 1;
    }
    if (classification.tier === 'afgewezen') {
      log(`  - overgeslagen (${classification.reason}): ${candidate.loc}`);
      stages.reasons.relevanceRejected += 1;
      addRejectionSample(samples, 'relevanceRejected', meta.title);
      continue;
    }

    const category = pickCategory(combinedText, source.defaultCategory) ?? source.defaultCategory;
    const overlap = findOverlappingArticle(meta.title, category, existingArticlesMeta);
    if (overlap) {
      log(`  - overgeslagen (overlap met bestaand artikel "${overlap.title}", ${overlap.file}): ${candidate.loc}`);
      stages.reasons.overlapRejected += 1;
      addRejectionSample(samples, 'overlapRejected', meta.title);
      continue;
    }
    stages.relevant += 1;

    const recordId = recordSourceItem(item, source);
    if (!recordId) continue;

    existingUrls.add(candidate.loc);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.recorded += 1;
    log(`  + bron ${recordId}${meta.body ? ` (hoofdtekst ${meta.body.length} tekens)` : ' (geen betrouwbare hoofdtekst)'}`);
  }

  stages.reasons.pageFetches = pagesFetched;
  stages.reasons.notFetchedDueToLimit = ranked.length - pagesFetched;

  log(`  ${added} nieuwe bron(nen) vastgelegd`);
  logReasonBreakdown(stages);
  logRejectionSamples(samples);
  return { added, seen: entries.length, ok: true, stages };
}

async function processSource(source, existingUrls, remainingBudget) {
  log(`\n=== ${source.name} (${source.id}) ===`);
  if (!source.enabled) {
    log('  overgeslagen (uitgeschakeld in sources.config.mjs)');
    return { added: 0, seen: 0, ok: true, stages: newStageCounters() };
  }

  let result;
  if (source.type === 'kvk-sitemap') {
    result = await processKvkSource(source, existingUrls, remainingBudget);
  } else if (source.type === 'sitemap' || source.type === 'rijksoverheid-topic-api') {
    result = await processSitemapSource(source, existingUrls, remainingBudget);
  } else {
    result = await processRssSource(source, existingUrls, remainingBudget);
  }

  const s = result.stages;
  log(`  Bron → opgehaald: ${s.fetched} → succesvol geparsed: ${s.parsed} → relevant: ${s.relevant} → vastgelegd: ${s.recorded}`);
  return result;
}

async function main() {
  const now = new Date();
  log(`Kenniscentrum: run gestart (${now.toISOString()})`);

  // Stap 1: bron-ingestie naar de bronlaag.
  const existingUrls = loadKnownSourceUrls({ sourcesDir: SOURCES_DIR, contentDir: CONTENT_DIR });
  log(`${existingUrls.size} bekende bron-URL('s) (bronlaag + Avydo-artikelen)`);

  const remainingBudget = { count: maxArticlesPerRun };
  const results = [];
  for (const source of sources) {
    const result = await processSource(source, existingUrls, remainingBudget);
    results.push({ id: source.id, name: source.name, ...result });
  }

  const totalRecorded = results.reduce((sum, r) => sum + r.added, 0);
  const failedSources = results.filter((r) => !r.ok);

  log('\n=== Bron-ingestie ===');
  for (const r of results) {
    log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id}: ${r.added} nieuw / ${r.seen} gezien (opgehaald ${r.stages.fetched}, geparsed ${r.stages.parsed}, relevant ${r.stages.relevant}, vastgelegd ${r.stages.recorded})`);
  }
  log(`Totaal nieuwe bronrecords: ${totalRecorded}`);
  if (failedSources.length > 0) {
    log(`${failedSources.length} bron(nen) waren niet bereikbaar of leverden geen geldige feed/sitemap.`);
  }

  // Stap 2: redactie (selectie → Avydo-artikel → validatie). Dynamisch
  // geïmporteerd: editorial.mjs gebruikt zelf helpers uit dit bestand.
  log('\n=== Redactie ===');
  const { runEditorialPipeline, readPendingSourceUrls } = await import('./editorial.mjs');
  const editorial = await runEditorialPipeline({
    contentDir: CONTENT_DIR,
    sourcesDir: SOURCES_DIR,
    now,
    apiKey: ANTHROPIC_API_KEY,
    pendingSourceUrls: readPendingSourceUrls(process.env.KENNISCENTRUM_PR_LIST_FILE),
    log,
  });

  // Machine-leesbaar resultaat voor de GitHub Action (job summary en de
  // beslissing of er een Pull Request komt).
  writeFileSync(
    path.resolve(__dirname, '../../.kenniscentrum-run-result.json'),
    JSON.stringify({
      totalRecorded,
      articlesCreated: editorial.created.length,
      editorial: editorial.summary,
      results,
      ranAt: now.toISOString(),
    }, null, 2),
  );
  if (editorial.pullRequest) {
    writeFileSync(path.resolve(__dirname, '../../.kenniscentrum-pr.md'), editorial.pullRequest.body);
    writeFileSync(path.resolve(__dirname, '../../.kenniscentrum-pr-title.txt'), editorial.pullRequest.title);
  }

  // Nooit falen op bron- of redactieproblemen: dat is afgehandeld gedrag.
  // Zonder geslaagd artikel komt er simpelweg geen Pull Request.
  process.exit(0);
}

// Alleen automatisch uitvoeren wanneer dit bestand direct wordt gedraaid
// (node fetch-articles.mjs), niet wanneer het als module wordt geïmporteerd
// (bv. door tests).
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error('Onverwachte fout in fetch-articles.mjs:', err);
    // Niet hard falen: zonder resultaat komt er geen Pull Request, en de
    // live content blijft ongewijzigd.
    process.exit(0);
  });
}
