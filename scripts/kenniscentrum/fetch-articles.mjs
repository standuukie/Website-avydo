#!/usr/bin/env node
/**
 * Haalt nieuwe artikelen op uit de geconfigureerde bronnen (RSS-feeds en
 * Google News-sitemaps, zie sources.config.mjs), filtert op relevantie voor
 * MKB-ondernemers, genereert een korte eigen samenvatting + "wat betekent
 * dit voor jou"-tekst, en schrijft nieuwe items weg als content-bestanden in
 * src/content/kenniscentrum/.
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
 * Env: ANTHROPIC_API_KEY (optioneel) — indien gezet, wordt Claude Haiku
 *      gebruikt voor een betere samenvatting/relevantie-tekst. Zonder deze
 *      key valt het script terug op een extractieve samenvatting (de eigen
 *      tekst van de bron) + een sjabloon-tekst per categorie.
 */
import { XMLParser } from 'fast-xml-parser';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.KENNISCENTRUM_CONTENT_DIR
  ? path.resolve(process.env.KENNISCENTRUM_CONTENT_DIR)
  : path.resolve(__dirname, '../../src/content/kenniscentrum');
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

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
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

function yamlEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function loadExistingSourceUrls() {
  const urls = new Set();
  if (!existsSync(CONTENT_DIR)) return urls;
  for (const file of readdirSync(CONTENT_DIR)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const match = text.match(/^sourceUrl:\s*"([^"]*)"/m);
    if (match) urls.add(match[1]);
  }
  return urls;
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

// Nodig voor bronnen waarvan de sitemap zelf geen titel levert (alleen
// loc+lastmod, zie fetchRijksoverheidGeneralSitemapUrls) — de <title> van
// de artikelpagina zelf, met de vaste site-naam-suffix verwijderd (nooit
// onderdeel van de artikeltitel zelf). Geeft null als er geen <title> is
// (nooit een gegokte titel).
export function extractPageTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  const title = stripHtml(match[1]).replace(/\s*\|\s*Rijksoverheid\.nl\s*$/i, '').trim();
  return title || null;
}

async function fetchArticlePageMeta(url) {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return { title: null, description: null, ministry: null };
    const html = await res.text();
    return { title: extractPageTitle(html), description: extractMetaDescription(html), ministry: extractMinistryTag(html) };
  } catch {
    return { title: null, description: null, ministry: null };
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
const WORD_BOUNDARY_KEYWORDS = new Set(['nba']);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(lowerText, keyword) {
  if (WORD_BOUNDARY_KEYWORDS.has(keyword)) {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(lowerText);
  }
  return lowerText.includes(keyword);
}

export function scoreCategories(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (keywordMatches(lower, kw)) score += 1;
    }
    if (score > 0) scores[category] = score;
  }
  return scores;
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

// Herzien op 2026-10-01, in lijn met de nieuwe categorie-indeling (zie
// src/content/config.ts en categoryKeywords in sources.config.mjs).
const RELEVANCE_TEMPLATES = {
  'Fiscale actualiteit': 'Dit kan gevolgen hebben voor uw fiscale positie of aangifte. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  Inkomstenbelasting: 'Dit kan gevolgen hebben voor uw aangifte inkomstenbelasting. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  Btw: 'Dit kan gevolgen hebben voor uw btw-aangifte of -administratie. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'BV & DGA': 'Als DGA of BV kan dit gevolgen hebben voor uw fiscale positie. Bespreek met uw adviseur of dit voor uw situatie relevant is.',
  Vennootschapsbelasting: 'Dit kan gevolgen hebben voor de vennootschapsbelasting van uw BV. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'Personeel & loonheffingen': 'Voor werkgevers met personeel kan dit gevolgen hebben voor de loonadministratie of arbeidsvoorwaarden. Controleer wat dit concreet voor uw organisatie betekent.',
  'Administratie & jaarrekening': 'Dit kan relevant zijn voor uw jaarrekening of financiële administratie. Bespreek met uw accountant of dit gevolgen heeft voor uw onderneming.',
  'Ondernemen & rechtsvormen': 'Dit kan relevant zijn voor uw onderneming of rechtsvorm. Bekijk de volledige publicatie om te bepalen of actie nodig is.',
};

function extractiveSummary(item) {
  const summary = item.description ? truncate(item.description, 280) : truncate(item.title, 280);
  return { summary, aiAssisted: false };
}

async function aiSummary(item, category) {
  const prompt = `Je schrijft voor het Kenniscentrum van Avydo, een Nederlands accountantskantoor. Gebruik UITSLUITEND onderstaande brontekst. Verzin geen feiten, cijfers, data, bedragen of regels die niet letterlijk in de brontekst staan.

Titel: ${item.title}
Bron: ${item.description}

Geef terug als JSON met exact deze velden, geen andere tekst:
{"summary": "een objectieve samenvatting van 1-2 zinnen, uitsluitend gebaseerd op de brontekst", "relevance": "1-2 zinnen die uitleggen wat dit in algemene zin kan betekenen voor een Nederlandse MKB-ondernemer, voorzichtig geformuleerd (\"kan gevolgen hebben voor\", niet \"is altijd voordelig\"), zonder nieuwe feiten toe te voegen die niet uit de brontekst blijken"}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Geen JSON in AI-respons');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.summary || !parsed.relevance) throw new Error('Onvolledige AI-respons');
    return { summary: parsed.summary, relevance: parsed.relevance, aiAssisted: true };
  } catch (err) {
    log(`    AI-samenvatting mislukt (${err.message}), val terug op extractieve samenvatting.`);
    const { summary } = extractiveSummary(item);
    return { summary, relevance: RELEVANCE_TEMPLATES[category] ?? RELEVANCE_TEMPLATES['Fiscale actualiteit'], aiAssisted: false };
  }
}

function writeArticle({ title, category, priority, publishedAt, sourceName, sourceUrl, summary, relevance, audiences, aiAssisted }) {
  const dateStr = publishedAt.toISOString().slice(0, 10);
  let baseSlug = `${dateStr}-${slugify(title)}`;
  let filename = `${baseSlug}.md`;
  let n = 2;
  while (existsSync(path.join(CONTENT_DIR, filename))) {
    filename = `${baseSlug}-${n}.md`;
    n += 1;
  }

  const frontmatter = [
    '---',
    `title: "${yamlEscape(title)}"`,
    `category: "${category}"`,
    `priority: "${priority}"`,
    `publishedAt: ${publishedAt.toISOString()}`,
    `sourceName: "${yamlEscape(sourceName)}"`,
    `sourceUrl: "${yamlEscape(sourceUrl)}"`,
    `summary: "${yamlEscape(summary)}"`,
    `relevance: "${yamlEscape(relevance)}"`,
    'tags: []',
    `audiences: [${audiences.map((a) => `"${a}"`).join(', ')}]`,
    'featured: false',
    'hidden: false',
    `aiAssisted: ${aiAssisted}`,
    `fetchedAt: ${new Date().toISOString()}`,
    '---',
    '',
    summary,
    '',
  ].join('\n');

  mkdirSync(CONTENT_DIR, { recursive: true });
  writeFileSync(path.join(CONTENT_DIR, filename), frontmatter, 'utf8');
  return filename;
}

// Verwerkt één ruw item (na parsing, vóór relevantie/schrijven) dat al een
// niet-lege description heeft. Gedeeld door de RSS- en sitemap-paden zodat
// categorisering/samenvatting/schrijven identiek verloopt, ongeacht bron-type.
async function publishItem(item, source) {
  const combinedText = `${item.title} ${item.description}`;
  const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
  if (Number.isNaN(publishedAt.getTime())) return null;

  const category = pickCategory(combinedText, source.defaultCategory) ?? 'Fiscale actualiteit';
  const priority = pickPriority(combinedText, publishedAt);
  const audiences = pickAudiences(combinedText);

  let summaryData;
  if (ANTHROPIC_API_KEY) {
    summaryData = await aiSummary(item, category);
  } else {
    const { summary } = extractiveSummary(item);
    summaryData = { summary, relevance: RELEVANCE_TEMPLATES[category] ?? RELEVANCE_TEMPLATES['Fiscale actualiteit'], aiAssisted: false };
  }

  return writeArticle({
    title: item.title,
    category,
    priority,
    publishedAt,
    sourceName: source.name,
    sourceUrl: item.link,
    summary: summaryData.summary,
    relevance: summaryData.relevance,
    audiences,
    aiAssisted: summaryData.aiAssisted,
  });
}

// Stadia zoals gevraagd: opgehaald -> succesvol geparsed -> relevant ->
// gepubliceerd. Elke bron rapporteert deze vier tellingen, ongeacht type.
// `reasons` is een los, bron-type-specifiek object met tellers die optellen
// tot `fetched` (zie elke process*Source-functie voor de exacte velden) —
// puur observability, bepaalt geen enkel gedrag.
function newStageCounters() {
  return { fetched: 0, parsed: 0, relevant: 0, published: 0 };
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

    const filename = await publishItem(item, source);
    if (!filename) continue;

    existingUrls.add(item.link);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.published += 1;
    log(`  + ${filename}`);
  }
  // Items die nooit zijn bekeken omdat het bron- of totaalbudget al vóór
  // die iteratie op was (zie de break hierboven) — NIET hetzelfde als
  // "afgewezen": over deze items is simpelweg geen relevantie-oordeel
  // geveld. Geen gedragswijziging: dezelfde items werden ook vóór deze
  // wijziging al nooit bekeken, dit maakt dat alleen zichtbaar.
  stages.reasons.notEvaluated = items.length - itemsEvaluated;

  log(`  ${added} nieuw artikel(en) toegevoegd`);
  logReasonBreakdown(stages);
  logRejectionSamples(samples);
  return { added, seen: items.length, ok: true, stages };
}

// --- Rijksoverheid: sitemap.xml (index) -> genummerde algemene
// sub-sitemaps (/sitemap/N.xml) ---
//
// Live onderzoek (2026-10-01, tijdelijke alleen-lezen GitHub Actions
// dry-run, zie git-historie) stelde vast dat rijksoverheid.nl/sitemap.xml
// zelf een sitemap-index is die, naast news/sitemap.xml (het eerder
// gebruikte, qua formaat tot ~2 dagen beperkte Google News-sitemap) en
// videos/sitemap.xml, verwijst naar een reeks genummerde, algemene
// sub-sitemaps zonder die beperking. Elk <url>-blok daarin bevat alleen
// loc+lastmod (geen titel) — zie fetchArticlePageMeta/extractPageTitle
// voor de titel-extractie van de artikelpagina zelf. Zelfde aanpak als
// fetchKvkDocumentUrls hieronder: niet-bereikbare sub-sitemaps blokkeren
// de andere niet, resultaat gededupliceerd en op lastmod (meest recent
// eerst) gesorteerd, zodat het run-budget bij voorkeur actueel nieuws
// bereikt vóór oudere content.
export async function fetchRijksoverheidGeneralSitemapUrls(sitemapIndexUrl, articleUrlPattern) {
  const indexRes = await fetchWithTimeout(sitemapIndexUrl, FETCH_TIMEOUT_MS);
  if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status} bij ${sitemapIndexUrl}`);
  const indexXml = await indexRes.text();
  const subSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const generalSitemaps = subSitemaps.filter((u) => /\/sitemap\/\d+\.xml$/i.test(u));
  if (generalSitemaps.length === 0) {
    throw new Error('geen genummerde algemene sub-sitemaps gevonden in sitemap.xml');
  }

  const entries = [];
  for (const sitemapUrl of generalSitemaps) {
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
      if (loc && loc.includes(articleUrlPattern)) entries.push({ loc, lastmod });
    }
  }

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
  return deduped;
}

// Veiligheidsgrens op het aantal daadwerkelijk opgehaalde artikelpagina's
// per run, zelfde motivatie als KVK_MAX_PAGE_FETCHES_PER_RUN hieronder: de
// genummerde sub-sitemaps bevatten samen een paar honderd nieuwsartikel-
// URL's, en zonder grens zou een run met veel irrelevante kandidaten
// onnodig veel pagina's kunnen opvragen vóór het budget/limiet stopt.
const RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN = 50;

export async function processSitemapSource(source, existingUrls, remainingBudget) {
  const stages = newStageCounters();
  // Zelfde principe als processRssSource: dekt exact de bestaande
  // skip-punten hieronder, geen nieuw skip-criterium.
  stages.reasons = { missingFields: 0, duplicate: 0, metadataRejected: 0, irrelevant: 0, notEvaluated: 0 };
  const samples = {};

  let items;
  if (source.sitemapIndexUrl) {
    let entries;
    try {
      entries = await fetchRijksoverheidGeneralSitemapUrls(source.sitemapIndexUrl, source.articleUrlPattern ?? '/actueel/nieuws/');
    } catch (err) {
      log(`  FOUT: kon sitemap-index niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
      return { added: 0, seen: 0, ok: false, stages };
    }
    // title: null -> wordt per kandidaat van de artikelpagina zelf gehaald
    // (zie fetchArticlePageMeta hieronder), de sub-sitemaps zelf leveren
    // alleen loc+lastmod.
    items = entries.map((e) => ({ title: null, link: e.loc, pubDate: e.lastmod, description: '' }));
    log(`  ${items.length} nieuwsartikel-URL('s) gevonden in de algemene sub-sitemaps (gededupliceerd, meest recent eerst)`);
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

  for (const item of items) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
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

    // Sitemap-items hebben geen samenvattingstekst (en bij de
    // sitemap-index-variant ook geen titel): de artikelpagina zelf wordt
    // opgehaald voor de meta-description, titel (indien nog onbekend) en,
    // indien geconfigureerd, de ministerie-toewijzing. Een probleem bij één
    // artikel (pagina niet bereikbaar, geen description) slaat alleen dat
    // artikel over, niet de hele bron.
    pageFetches += 1;
    const { title: fetchedTitle, description, ministry } = await fetchArticlePageMeta(item.link);
    const title = item.title || fetchedTitle;
    if (!title || !description || description.length < 20) {
      log(`  - overgeslagen (geen betrouwbare titel/samenvattingstekst op bron-pagina): ${item.link}`);
      stages.reasons.metadataRejected += 1;
      addRejectionSample(samples, 'metadataRejected', title ?? item.link);
      continue;
    }
    const enrichedItem = { ...item, title, description };
    stages.parsed += 1;

    if (source.requireKeywordMatch) {
      const combinedText = `${enrichedItem.title} ${enrichedItem.description}`;
      const scores = scoreCategories(combinedText);
      const ministryMatch = source.ministryBypass && ministry === source.ministryBypass;
      // Smalle, expliciete aanvulling op categoryKeywords (zie
      // rijksoverheidAudienceSignals in sources.config.mjs) — alleen voor
      // bronnen die zelf `audienceSignals` instellen (momenteel uitsluitend
      // rijksoverheid-nieuws). Bepaalt alleen OF een item relevant is, net
      // als ministryBypass hierboven; de categorie zelf blijft uitsluitend
      // via categoryKeywords/pickCategory in publishItem bepaald.
      const audienceMatch = source.audienceSignals?.some((kw) => combinedText.toLowerCase().includes(kw));
      if (Object.keys(scores).length === 0 && !ministryMatch && !audienceMatch) {
        stages.reasons.irrelevant += 1;
        addRejectionSample(samples, 'irrelevant', title);
        continue;
      }
    }
    stages.relevant += 1;

    const filename = await publishItem(enrichedItem, source);
    if (!filename) continue;

    existingUrls.add(item.link);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.published += 1;
    log(`  + ${filename}`);
  }
  // Zie de toelichting bij processRssSource: items die vóór hun beurt al
  // niet meer bekeken werden doordat het budget op was. Geen
  // gedragswijziging, alleen zichtbaar gemaakt.
  stages.reasons.notEvaluated = items.length - itemsEvaluated;

  log(`  ${added} nieuw artikel(en) toegevoegd`);
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
// publishedAt-opmerking bij processKvkSource.
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
  return extractKvkArticleFields(html);
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

// Leest titel + categorie van alle bestaande Kenniscentrum-artikelen, als
// basis voor de overlapcontrole hieronder.
export function loadExistingArticlesMeta() {
  if (!existsSync(CONTENT_DIR)) return [];
  const articles = [];
  for (const file of readdirSync(CONTENT_DIR)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const title = text.match(/^title:\s*"([^"]*)"/m)?.[1];
    const category = text.match(/^category:\s*"([^"]*)"/m)?.[1] ?? null;
    if (!title) continue;
    articles.push({ file, title, category });
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
    // sources.config.mjs) — wordt hier, bij gebrek aan een betere bron-
    // datum, wel gebruikt als publishedAt (zelfde aanpak als de bestaande
    // Rijksoverheid-sitemapbron bij ontbrekende news:publication_date).
    const item = { title: meta.title, description: meta.description, link: candidate.loc, pubDate: candidate.lastmod };
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

    const filename = await publishItem(item, source);
    if (!filename) continue;

    existingUrls.add(candidate.loc);
    added += 1;
    sourceCount += 1;
    remainingBudget.count -= 1;
    stages.published += 1;
    log(`  + ${filename}`);
  }

  stages.reasons.pageFetches = pagesFetched;
  stages.reasons.notFetchedDueToLimit = ranked.length - pagesFetched;

  log(`  ${added} nieuw artikel(en) toegevoegd`);
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
  } else if (source.type === 'sitemap') {
    result = await processSitemapSource(source, existingUrls, remainingBudget);
  } else {
    result = await processRssSource(source, existingUrls, remainingBudget);
  }

  const s = result.stages;
  log(`  Bron → opgehaald: ${s.fetched} → succesvol geparsed: ${s.parsed} → relevant: ${s.relevant} → gepubliceerd: ${s.published}`);
  return result;
}

async function main() {
  log(`Kenniscentrum: ophalen gestart (${new Date().toISOString()})`);
  log(`AI-samenvatting: ${ANTHROPIC_API_KEY ? 'ingeschakeld (ANTHROPIC_API_KEY gevonden)' : 'uitgeschakeld (extractieve samenvatting)'}`);

  const existingUrls = loadExistingSourceUrls();
  log(`${existingUrls.size} bestaand(e) artikel(en) in content-collectie`);

  const remainingBudget = { count: maxArticlesPerRun };
  const results = [];
  for (const source of sources) {
    const result = await processSource(source, existingUrls, remainingBudget);
    results.push({ id: source.id, name: source.name, ...result });
  }

  const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
  const failedSources = results.filter((r) => !r.ok);

  log('\n=== Samenvatting ===');
  for (const r of results) {
    log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id}: ${r.added} nieuw / ${r.seen} gezien (opgehaald ${r.stages.fetched}, geparsed ${r.stages.parsed}, relevant ${r.stages.relevant}, gepubliceerd ${r.stages.published})`);
  }
  log(`Totaal nieuwe artikelen: ${totalAdded}`);
  if (failedSources.length > 0) {
    log(`${failedSources.length} bron(nen) waren niet bereikbaar of leverden geen geldige feed/sitemap. Bestaande content blijft ongewijzigd staan voor deze bronnen.`);
  }
  const sourcesWithArticles = new Set(results.filter((r) => r.added > 0).map((r) => r.id)).size;
  if (sourcesWithArticles > 0) {
    log(`Bronnen met nieuwe artikelen deze run: ${sourcesWithArticles} van ${results.length}.`);
  }

  // Schrijf een machine-leesbaar resultaat voor de GitHub Actions-stap die
  // bepaalt of er iets te committen valt en voor de job summary.
  writeFileSync(
    path.resolve(__dirname, '../../.kenniscentrum-run-result.json'),
    JSON.stringify({ totalAdded, results, ranAt: new Date().toISOString() }, null, 2),
  );

  // Nooit falen op bronproblemen: dat is verwacht/afgehandeld gedrag, geen
  // reden om de hele workflow als mislukt te markeren.
  process.exit(0);
}

// Alleen automatisch uitvoeren wanneer dit bestand direct wordt gedraaid
// (node fetch-articles.mjs), niet wanneer het als module wordt geïmporteerd
// (bv. door tests).
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error('Onverwachte fout in fetch-articles.mjs:', err);
    // Ook hier: niet hard falen, zodat een eenmalige bug nooit de site kapot
    // maakt. De laatst gecommitte content blijft gewoon live staan.
    process.exit(0);
  });
}
