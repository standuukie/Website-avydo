// Eenmalige backfill: de hoofdtekst van BESTAANDE Rijksoverheid-artikelen
// in src/content/kenniscentrum/ alsnog ophalen (zie
// extractRijksoverheidArticleBody in fetch-articles.mjs; nieuwe artikelen
// krijgen die al bij publicatie).
//
// Standaard een dry-run: er wordt niets geschreven, alleen per artikel
// getoond wat de kandidaatwijziging zou zijn. Schrijven gebeurt uitsluitend
// met de expliciete optie --write, en dan alleen voor artikelen waarvan de
// body betrouwbaar geëxtraheerd is. De frontmatter blijft byte-voor-byte
// gelijk (inclusief supersededBy, hidden, categorie, summary, ...); alleen
// de markdown-body na de frontmatter wordt vervangen.
//
//   node scripts/kenniscentrum/backfill-rijksoverheid-body.mjs            (dry-run)
//   node scripts/kenniscentrum/backfill-rijksoverheid-body.mjs --dry-run  (idem)
//   node scripts/kenniscentrum/backfill-rijksoverheid-body.mjs --write    (schrijft)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRijksoverheidArticleBody } from './fetch-articles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');
const FETCH_TIMEOUT_MS = 15000;
// Kleine pauze tussen requests: ~48 pagina's achter elkaar, geen haast.
const DELAY_BETWEEN_REQUESTS_MS = 300;
const PREVIEW_LENGTH = 100;

/** Splitst een artikelbestand in de letterlijke frontmatter (incl. afsluitende '---' + newline) en de rest. */
export function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!match) return null;
  return { frontmatter: match[0], body: text.slice(match[0].length) };
}

/** Vervangt alleen de markdown-body; zelfde opmaak als writeArticle in fetch-articles.mjs. */
export function replaceMarkdownBody(text, newBody) {
  const parts = splitFrontmatter(text);
  if (!parts) return null;
  return `${parts.frontmatter}\n${newBody}\n`;
}

/** Alle artikelen met sourceName "Rijksoverheid" (gesorteerd op bestandsnaam). */
export function findRijksoverheidArticles(contentDir = DEFAULT_CONTENT_DIR) {
  return readdirSync(contentDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(contentDir, file), 'utf8');
      const parts = splitFrontmatter(text);
      if (!parts) return null;
      if (parts.frontmatter.match(/^sourceName: "(.*)"$/m)?.[1] !== 'Rijksoverheid') return null;
      const sourceUrl = parts.frontmatter.match(/^sourceUrl: "(.*)"$/m)?.[1];
      return sourceUrl ? { file, sourceUrl, text } : null;
    })
    .filter(Boolean);
}

async function defaultFetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bepaalt per artikel de kandidaatwijziging; schrijft niets.
 * @returns {Promise<Array<{ file: string, sourceUrl: string, status: 'extracted' | 'fallback', bodyLength: number, preview: string, text: string, newText: string | null }>>}
 */
export async function planBackfill({ contentDir = DEFAULT_CONTENT_DIR, fetchHtml = defaultFetchHtml, delayMs = DELAY_BETWEEN_REQUESTS_MS } = {}) {
  const plan = [];
  const articles = findRijksoverheidArticles(contentDir);
  for (const [i, article] of articles.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    let html = null;
    try {
      html = await fetchHtml(article.sourceUrl);
    } catch {
      html = null;
    }
    let body = null;
    try {
      body = html ? extractRijksoverheidArticleBody(html) : null;
    } catch {
      body = null;
    }
    const currentBody = splitFrontmatter(article.text).body.trim();
    const shown = body ?? currentBody;
    plan.push({
      ...article,
      status: body ? 'extracted' : 'fallback',
      bodyLength: shown.length,
      preview: shown.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH),
      newText: body ? replaceMarkdownBody(article.text, body) : null,
    });
  }
  return plan;
}

/** Schrijft uitsluitend de geëxtraheerde kandidaten weg. Geeft het aantal gewijzigde bestanden terug. */
export function applyBackfill(plan, contentDir = DEFAULT_CONTENT_DIR) {
  let written = 0;
  for (const entry of plan) {
    if (entry.status !== 'extracted' || !entry.newText || entry.newText === entry.text) continue;
    writeFileSync(path.join(contentDir, entry.file), entry.newText, 'utf8');
    written += 1;
  }
  return written;
}

export function parseArgs(argv) {
  const known = new Set(['--dry-run', '--write']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`Onbekende optie(s): ${unknown.join(' ')}`);
  if (argv.includes('--write') && argv.includes('--dry-run')) throw new Error('Kies --dry-run óf --write, niet beide.');
  return { write: argv.includes('--write') };
}

export async function main(argv = process.argv.slice(2), { contentDir = DEFAULT_CONTENT_DIR, fetchHtml = defaultFetchHtml, delayMs = DELAY_BETWEEN_REQUESTS_MS, log = console.log } = {}) {
  const { write } = parseArgs(argv);
  log(`Rijksoverheid body-backfill — ${write ? 'SCHRIJFMODUS (--write)' : 'dry-run (er wordt niets gewijzigd)'}`);
  const plan = await planBackfill({ contentDir, fetchHtml, delayMs });
  for (const entry of plan) {
    log(`${entry.status.padEnd(9)} ${String(entry.bodyLength).padStart(5)}  ${entry.file}`);
    log(`          ${entry.preview}`);
  }
  const extracted = plan.filter((e) => e.status === 'extracted').length;
  log(`\n${plan.length} Rijksoverheid-artikel(en): ${extracted} extracted, ${plan.length - extracted} fallback`);
  if (!write) {
    log('Dry-run: geen bestanden gewijzigd. Gebruik --write om de geëxtraheerde bodies weg te schrijven.');
    return { plan, written: 0 };
  }
  const written = applyBackfill(plan, contentDir);
  log(`${written} bestand(en) bijgewerkt (alleen de markdown-body; frontmatter ongewijzigd).`);
  return { plan, written };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`backfill-rijksoverheid-body: ${err.message}`);
    process.exit(1);
  });
}
