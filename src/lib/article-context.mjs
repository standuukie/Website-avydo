// Contextfragment van een AL GESELECTEERD Kenniscentrum-artikel voor het
// taalmodel (2026-10-07).
//
// Dit bepaalt uitsluitend WELKE tekst van een gekozen artikel wordt
// meegegeven. Selectie, score en volgorde gebeuren in ai-assistent.ts
// (overlapScore op titel/summary/categorie/tags, MIN_RELEVANCE_SCORE,
// rankScoredArticles, top-MAX_ARTICLE_SOURCES) en gebruiken de body nooit.
//
// Alleen Rijksoverheid-artikelen hebben een uit de bronpagina geëxtraheerde
// hoofdtekst (zie extractRijksoverheidArticleBody in
// scripts/kenniscentrum/fetch-articles.mjs). Voor alle andere bronnen, en
// voor een Rijksoverheid-artikel waarvan de body alleen de summary is
// (extractie mislukt), blijft exact het bestaande fragment gelden.
// Los .mjs-bestand (zelfde patroon als knowledge-match.mjs) zodat dit
// zonder Astro-runtime getest kan worden.

export const ARTICLE_FALLBACK_SNIPPET_MAX_LENGTH = 500;
export const ARTICLE_BODY_SNIPPET_MAX_LENGTH = 1200;
const BODY_SNIPPET_SOURCE_NAMES = new Set(['Rijksoverheid']);

// Afkortingen waarna een punt geen zinseinde is.
const SENTENCE_END_ABBREVIATION = /(?:^|\s)(?:bijv|bv|o\.a|m\.b\.t|i\.p\.v|d\.w\.z|nr|art|ca|incl|excl|zgn|e\.d|t\.o\.v|mr|dr|drs|ir|prof)\.$/i;

/** Het bestaande fragment: summary + relevance, maximaal 500 tekens. */
export function fallbackArticleSnippet({ summary, relevance }) {
  return `${summary} ${relevance}`.slice(0, ARTICLE_FALLBACK_SNIPPET_MAX_LENGTH);
}

// Markdown-body (zoals de extractor die schrijft) als platte tekst: één
// regel per alinea, zonder de backslash-escapes en entiteiten die de
// extractor voor de markdown-weergave toevoegt.
function bodyAsPlainText(body) {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim().replace(/^\\(?=[#*_=<-])/, ''))
    .filter(Boolean)
    .join('\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Kapt af op het laatste zinseinde binnen `max` tekens (of anders de
 * laatste witruimte); overschrijdt `max` nooit en voegt niets toe.
 * @param {string} text
 * @param {number} [max]
 */
export function truncateAtTextBoundary(text, max = ARTICLE_BODY_SNIPPET_MAX_LENGTH) {
  if (text.length <= max) return text;
  const sentenceEnd = /[.!?][”"’)]?(?=\s)/g;
  let cut = -1;
  let match;
  while ((match = sentenceEnd.exec(text)) && match.index + match[0].length <= max) {
    const end = match.index + match[0].length;
    if (!SENTENCE_END_ABBREVIATION.test(text.slice(Math.max(0, end - 12), end))) cut = end;
  }
  // Zinsgrens alleen als er niet onevenredig veel tekst verloren gaat.
  if (cut < max / 2) cut = text.lastIndexOf(' ', max);
  if (cut <= 0) cut = max;
  return text.slice(0, cut).trimEnd();
}

/**
 * Tekst die het model te zien krijgt voor een al geselecteerd artikel.
 * @param {{ sourceName: string, summary: string, relevance: string, body?: string | null }} article
 */
export function articleContextSnippet({ sourceName, summary, relevance, body }) {
  if (BODY_SNIPPET_SOURCE_NAMES.has(sourceName) && typeof body === 'string') {
    const text = bodyAsPlainText(body);
    if (text && text !== summary.trim()) return truncateAtTextBoundary(text);
  }
  return fallbackArticleSnippet({ summary, relevance });
}
