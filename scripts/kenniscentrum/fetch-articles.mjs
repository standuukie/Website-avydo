#!/usr/bin/env node
/**
 * Haalt nieuwe artikelen op uit de geconfigureerde RSS-bronnen (zie
 * sources.config.mjs), filtert op relevantie voor MKB-ondernemers,
 * genereert een korte eigen samenvatting + "wat betekent dit voor jou"-tekst,
 * en schrijft nieuwe items weg als content-bestanden in
 * src/content/kenniscentrum/.
 *
 * Nooit fabricage: als een bron niet bereikbaar is, geen geldige RSS levert,
 * of onvoldoende informatie bevat, wordt die bron/dat item simpelweg
 * overgeslagen. Bestaande content blijft altijd staan (fallback = het laatst
 * succesvol opgehaalde resultaat, gecommit in git).
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
  importantKeywords,
  maxArticlesPerRun,
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

export function pickPriority(text, pubDate) {
  const lower = text.toLowerCase();
  if (importantKeywords.some((kw) => lower.includes(kw))) return 'belangrijk';
  if (pubDate) {
    const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 14) return 'actueel';
  }
  return 'praktisch';
}

const RELEVANCE_TEMPLATES = {
  Belastingen: 'Dit kan gevolgen hebben voor uw fiscale positie of aangifte. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  Accountancy: 'Dit kan relevant zijn voor uw jaarrekening of financiële verslaggeving. Bespreek met uw accountant of dit gevolgen heeft voor uw administratie.',
  'Personeel & loon': 'Voor werkgevers met personeel kan dit gevolgen hebben voor de loonadministratie of arbeidsvoorwaarden. Controleer wat dit concreet voor uw organisatie betekent.',
  Ondernemen: 'Dit kan relevant zijn voor uw bedrijfsvoering als MKB-ondernemer. Bekijk de volledige publicatie om te bepalen of actie nodig is.',
  'Wet- en regelgeving': 'Deze wijziging in wet- of regelgeving kan verplichtingen met zich meebrengen voor ondernemers. Ga na of en wanneer dit voor u van toepassing wordt.',
  Subsidies: 'Mogelijk komt uw onderneming in aanmerking voor deze regeling. Controleer de voorwaarden en eventuele deadlines bij de bron.',
  Financiën: 'Dit kan invloed hebben op de financiële planning van uw onderneming. Bekijk de volledige publicatie voor de precieze details.',
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
    return { summary, relevance: RELEVANCE_TEMPLATES[category] ?? RELEVANCE_TEMPLATES.Ondernemen, aiAssisted: false };
  }
}

function writeArticle({ title, category, priority, publishedAt, sourceName, sourceUrl, summary, relevance, aiAssisted }) {
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

async function processSource(source, existingUrls, remainingBudget) {
  log(`\n=== ${source.name} (${source.id}) ===`);
  if (!source.enabled) {
    log('  overgeslagen (uitgeschakeld in sources.config.mjs)');
    return { added: 0, seen: 0, ok: true };
  }

  let res;
  try {
    res = await fetchWithTimeout(source.feedUrl, FETCH_TIMEOUT_MS);
  } catch (err) {
    log(`  FOUT: kon feed niet ophalen (${err.message}). Bron overgeslagen, bestaande content blijft staan.`);
    return { added: 0, seen: 0, ok: false };
  }
  if (!res.ok) {
    log(`  FOUT: HTTP ${res.status} bij ophalen feed. Bron overgeslagen.`);
    return { added: 0, seen: 0, ok: false };
  }

  const xmlText = await res.text();
  let items;
  try {
    items = parseFeedItems(xmlText);
  } catch (err) {
    log(`  FOUT: kon feed niet parsen als RSS/Atom (${err.message}). Bron overgeslagen.`);
    return { added: 0, seen: 0, ok: false };
  }
  if (!items) {
    log('  FOUT: onherkenbaar feedformaat (geen RSS- of Atom-items gevonden). Bron overgeslagen.');
    return { added: 0, seen: 0, ok: false };
  }

  log(`  ${items.length} item(s) in feed`);
  let added = 0;

  for (const item of items) {
    if (remainingBudget.count <= 0) break;
    if (!item.title || !item.link) continue;
    if (existingUrls.has(item.link)) continue;

    const combinedText = `${item.title} ${item.description}`;
    if (source.requireKeywordMatch) {
      const scores = scoreCategories(combinedText);
      if (Object.keys(scores).length === 0) continue;
    }
    if (!item.description || item.description.length < 20) {
      // Onvoldoende broninformatie om een eigen samenvatting op te baseren.
      continue;
    }

    const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;

    const category = pickCategory(combinedText, source.defaultCategory) ?? 'Ondernemen';
    const priority = pickPriority(combinedText, publishedAt);

    let summaryData;
    if (ANTHROPIC_API_KEY) {
      summaryData = await aiSummary(item, category);
    } else {
      const { summary } = extractiveSummary(item);
      summaryData = { summary, relevance: RELEVANCE_TEMPLATES[category] ?? RELEVANCE_TEMPLATES.Ondernemen, aiAssisted: false };
    }

    const filename = writeArticle({
      title: item.title,
      category,
      priority,
      publishedAt,
      sourceName: source.name,
      sourceUrl: item.link,
      summary: summaryData.summary,
      relevance: summaryData.relevance,
      aiAssisted: summaryData.aiAssisted,
    });

    existingUrls.add(item.link);
    added += 1;
    remainingBudget.count -= 1;
    log(`  + ${filename}`);
  }

  log(`  ${added} nieuw artikel(en) toegevoegd`);
  return { added, seen: items.length, ok: true };
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
    results.push({ id: source.id, ...result });
  }

  const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
  const failedSources = results.filter((r) => !r.ok);

  log('\n=== Samenvatting ===');
  for (const r of results) {
    log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id}: ${r.added} nieuw / ${r.seen} gezien`);
  }
  log(`Totaal nieuwe artikelen: ${totalAdded}`);
  if (failedSources.length > 0) {
    log(`${failedSources.length} bron(nen) waren niet bereikbaar of leverden geen geldige feed. Bestaande content blijft ongewijzigd staan voor deze bronnen.`);
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
