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

async function fetchArticlePageMeta(url) {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return { description: null, ministry: null };
    const html = await res.text();
    return { description: extractMetaDescription(html), ministry: extractMinistryTag(html) };
  } catch {
    return { description: null, ministry: null };
  }
}

export function scoreCategories(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
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
function newStageCounters() {
  return { fetched: 0, parsed: 0, relevant: 0, published: 0 };
}

async function processRssSource(source, existingUrls, remainingBudget) {
  const stages = newStageCounters();

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

  for (const item of items) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
    if (!item.title || !item.link) continue;
    if (existingUrls.has(item.link)) continue;
    if (!item.description || item.description.length < 20) {
      // Onvoldoende broninformatie om een eigen samenvatting op te baseren.
      continue;
    }
    stages.parsed += 1;

    if (source.requireKeywordMatch) {
      const scores = scoreCategories(`${item.title} ${item.description}`);
      if (Object.keys(scores).length === 0) continue;
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

  log(`  ${added} nieuw artikel(en) toegevoegd`);
  return { added, seen: items.length, ok: true, stages };
}

async function processSitemapSource(source, existingUrls, remainingBudget) {
  const stages = newStageCounters();

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
  let items;
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

  stages.fetched = items.length;
  log(`  ${items.length} item(s) in sitemap`);
  let added = 0;
  let sourceCount = 0;

  for (const item of items) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
    if (!item.title || !item.link) continue;
    if (existingUrls.has(item.link)) continue;

    // Sitemap-items hebben geen samenvattingstekst: de artikelpagina zelf
    // wordt opgehaald voor de meta-description (en, indien geconfigureerd,
    // de ministerie-toewijzing). Een probleem bij één artikel (pagina niet
    // bereikbaar, geen description) slaat alleen dat artikel over, niet de
    // hele bron.
    const { description, ministry } = await fetchArticlePageMeta(item.link);
    if (!description || description.length < 20) {
      log(`  - overgeslagen (geen samenvattingstekst op bron-pagina): ${item.link}`);
      continue;
    }
    const enrichedItem = { ...item, description };
    stages.parsed += 1;

    if (source.requireKeywordMatch) {
      const scores = scoreCategories(`${enrichedItem.title} ${enrichedItem.description}`);
      const ministryMatch = source.ministryBypass && ministry === source.ministryBypass;
      if (Object.keys(scores).length === 0 && !ministryMatch) continue;
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

  log(`  ${added} nieuw artikel(en) toegevoegd`);
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

// Zuiver filter-/selectiepad, gedeeld door de productie-run (processKvkSource)
// en het aparte dry-run-script (dry-run-kvk.mjs): dedupliceert op URL,
// sorteert op lastmod (meest recent eerst), past het URL-vormfilter toe
// (bevestigde artikel-URL's volgen het patroon kvk.nl/<categorie>/<slug>/,
// precies twee padsegmenten — sluit overduidelijke niet-artikel-URL's uit
// zonder te gokken op een deny-list) en daarna de relevantie-vóórfilter op
// de URL-slug. Hergebruikt bewust dezelfde categoryKeywords/scoreCategories
// als de andere bronnen — geen tweede, parallel filtersysteem.
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
    try {
      const { pathname } = new URL(e.loc);
      const segments = pathname.split('/').filter(Boolean);
      return segments.length === 2;
    } catch {
      return false;
    }
  });

  const afterRelevanceFilter = afterUrlFilter.filter(
    (e) => Object.keys(scoreCategories(kvkSlugToText(e.loc))).length > 0,
  );

  const afterDedupAgainstExisting = afterRelevanceFilter.filter((e) => !existingUrls.has(e.loc));

  return { deduped, afterUrlFilter, afterRelevanceFilter, afterDedupAgainstExisting };
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

// Veiligheidsgrens op het aantal daadwerkelijk opgehaalde artikelpagina's
// per run: de sitemap bevat ~1.800 URL's, en zonder grens zou een eerste
// run (vóór dedup tegen bestaande content opbouwt) in theorie honderden
// pagina's kunnen opvragen. Ruim boven maxArticlesPerSourcePerRun, zodat dit
// in de praktijk alleen bij die eerste/lege run ooit relevant wordt.
const KVK_MAX_PAGE_FETCHES_PER_RUN = 50;

async function processKvkSource(source, existingUrls, remainingBudget) {
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

  const { afterUrlFilter, afterRelevanceFilter, afterDedupAgainstExisting } = selectKvkCandidates(entries, existingUrls);
  log(`  ${afterUrlFilter.length} na URL-vormfilter, ${afterRelevanceFilter.length} na relevantie-vóórfilter, ${afterDedupAgainstExisting.length} nog niet eerder opgenomen`);

  let added = 0;
  let sourceCount = 0;
  let pagesFetched = 0;

  for (const candidate of afterDedupAgainstExisting) {
    if (remainingBudget.count <= 0 || sourceCount >= maxArticlesPerSourcePerRun) break;
    if (pagesFetched >= KVK_MAX_PAGE_FETCHES_PER_RUN) {
      log(`  grens van ${KVK_MAX_PAGE_FETCHES_PER_RUN} opgehaalde pagina's per run bereikt, stoppen (overige kandidaten volgen in een volgende run).`);
      break;
    }
    pagesFetched += 1;

    const meta = await fetchKvkArticleMeta(candidate.loc);
    if (!meta) {
      log(`  - overgeslagen (geen betrouwbare titel/samenvatting op pagina): ${candidate.loc}`);
      continue;
    }
    stages.parsed += 1;

    // lastmod is "laatst gewijzigd", geen bewezen publicatiedatum (zie
    // sources.config.mjs) — wordt hier, bij gebrek aan een betere bron-
    // datum, wel gebruikt als publishedAt (zelfde aanpak als de bestaande
    // Rijksoverheid-sitemapbron bij ontbrekende news:publication_date).
    const item = { title: meta.title, description: meta.description, link: candidate.loc, pubDate: candidate.lastmod };

    const scores = scoreCategories(`${item.title} ${item.description}`);
    if (Object.keys(scores).length === 0) {
      log(`  - overgeslagen (titel/samenvatting bevatten geen fiscaal/accountancy-trefwoord): ${candidate.loc}`);
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

  log(`  ${added} nieuw artikel(en) toegevoegd`);
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
