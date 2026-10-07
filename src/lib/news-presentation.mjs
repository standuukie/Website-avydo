// Weergave van Kenniscentrum-artikelen op de nieuwspagina en artikelpagina's
// (2026-10-07). Uitsluitend presentatie: de opgeslagen content (en daarmee de
// AI-context en -retrieval) blijft ongewijzigd. Los .mjs-bestand (zelfde
// patroon als knowledge-match.mjs) zodat dit zonder Astro-runtime getest kan
// worden.

// Sjabloon-duidingen die de nieuwsengine invult als er geen eigen duiding is
// (RELEVANCE_TEMPLATES in scripts/kenniscentrum/fetch-articles.mjs, plus één
// oudere variant die nog in bestaande artikelen staat). Zo'n tekst is geen
// eigen uitleg en wordt daarom niet als "Wat betekent dit voor u?" getoond.
// news-presentation.test.mjs bewaakt dat deze lijst gelijk blijft aan de
// sjablonen in fetch-articles.mjs.
export const GENERIC_RELEVANCE_TEXTS = new Set([
  'Dit kan gevolgen hebben voor uw fiscale positie of aangifte. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'Dit kan gevolgen hebben voor uw aangifte inkomstenbelasting. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'Dit kan gevolgen hebben voor uw btw-aangifte of -administratie. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'Als DGA of BV kan dit gevolgen hebben voor uw fiscale positie. Bespreek met uw adviseur of dit voor uw situatie relevant is.',
  'Dit kan gevolgen hebben voor de vennootschapsbelasting van uw BV. Controleer of deze wijziging van toepassing is op uw situatie en raadpleeg bij twijfel uw adviseur.',
  'Voor werkgevers met personeel kan dit gevolgen hebben voor de loonadministratie of arbeidsvoorwaarden. Controleer wat dit concreet voor uw organisatie betekent.',
  'Dit kan relevant zijn voor uw jaarrekening of financiële administratie. Bespreek met uw accountant of dit gevolgen heeft voor uw onderneming.',
  'Dit kan relevant zijn voor uw onderneming of rechtsvorm. Bekijk de volledige publicatie om te bepalen of actie nodig is.',
  'Deze wijziging in wet- of regelgeving kan verplichtingen met zich meebrengen voor ondernemers. Ga na of en wanneer dit voor u van toepassing wordt.',
]);

/** True als het artikel een eigen (niet-sjabloon) duiding heeft. */
export function hasOwnRelevance(relevance) {
  const text = (relevance ?? '').trim();
  return text.length > 0 && !GENERIC_RELEVANCE_TEXTS.has(text);
}

/**
 * Nieuws of naslag. Expliciet via `contentType` in de frontmatter; zonder
 * dat veld zijn KVK-artikelen naslag (de bron levert KVK-kennisartikelen,
 * evergreen uitleg met de sitemap-wijzigingsdatum als datum) en is al het
 * andere nieuws.
 * @param {{ contentType?: 'nieuws' | 'naslag', sourceName: string }} data
 */
export function isReferenceArticle(data) {
  if (data.contentType) return data.contentType === 'naslag';
  return data.sourceName === 'KVK';
}

/** Weergavelabels voor de optionele, redactioneel gezette `status`. */
export const STATUS_LABELS = {
  voorstel: 'Voorstel',
  consultatie: 'Consultatie',
  voornemen: 'Voornemen',
  historisch: 'Historisch',
  herzien: 'Herzien',
  'deels-geschrapt': 'Deels geschrapt',
};

/** Statussen die betekenen dat de brontekst niet (meer) de actuele situatie beschrijft. */
export const OUTDATED_STATUSES = new Set(['historisch', 'herzien', 'deels-geschrapt']);

/**
 * Een losse regel uit een geëxtraheerde Rijksoverheid-hoofdtekst die in de
 * bron een tussenkop (h2/h3) was: kort, zonder zinseinde (of een korte
 * vraag), begint met een hoofdletter en wordt gevolgd door meer tekst. Op
 * 2026-10-07 gecontroleerd tegen de h2/h3-koppen van alle actieve
 * Rijksoverheid-bronpagina's (55 van 55 juist, geen enkele valse kop).
 */
export function isHeadingBlock(block, next) {
  const t = block.trim();
  if (!next || t.startsWith('- ') || t.length < 3 || t.length > 80 || /\n/.test(t)) return false;
  const words = t.split(/\s+/).length;
  if (words > 10 || !/^[A-ZÀ-Ý0-9‘'“"]/.test(t)) return false;
  return !/[.!?:;,"”’)]$/.test(t) || (/\?$/.test(t) && words <= 6);
}

function plainBlock(block) {
  return block
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\\(?=[#*_=<-])/, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Hoofdtekst (zoals de extractor die opslaat: alinea's gescheiden door een
 * lege regel, lijstitems als "- ...") als weergaveblokken met tussenkoppen.
 * @param {string} body
 * @returns {Array<{ type: 'heading' | 'paragraph', text: string } | { type: 'list', items: string[] }>}
 */
export function sourceBodyBlocks(body) {
  const raw = (body ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const blocks = [];
  raw.forEach((block, i) => {
    if (block.startsWith('- ')) {
      const items = block.split(/\n/).map((l) => plainBlock(l.replace(/^- /, ''))).filter(Boolean);
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') last.items.push(...items);
      else blocks.push({ type: 'list', items });
      return;
    }
    const text = plainBlock(block);
    blocks.push({ type: isHeadingBlock(text, raw[i + 1]) ? 'heading' : 'paragraph', text });
  });
  return blocks;
}
