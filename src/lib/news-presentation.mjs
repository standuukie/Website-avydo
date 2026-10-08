// Weergave van Kenniscentrum-artikelen op de overzichtspagina en artikelpagina's
// (2026-10-07, aangepast 2026-10-08 voor het Avydo-artikelmodel). Uitsluitend
// presentatie: de opgeslagen content (en daarmee de AI-context en -retrieval)
// blijft ongewijzigd. Los .mjs-bestand (zelfde
// patroon als knowledge-match.mjs) zodat dit zonder Astro-runtime getest kan
// worden.

// Sjabloon-duidingen die de oude nieuwsengine invulde als er geen eigen
// duiding was. Zo'n tekst is geen eigen uitleg: hij wordt niet als "Wat
// betekent dit voor u?" getoond, en de validatie van nieuwe Avydo-artikelen
// (scripts/kenniscentrum/validate-article.mjs) keurt hem af.
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

/** Weergavelabels voor de optionele, redactioneel gezette `status`. */
export const STATUS_LABELS = {
  voorstel: 'Voorstel',
  consultatie: 'Consultatie',
  voornemen: 'Voornemen',
  aangenomen: 'Aangenomen',
  'van-kracht': 'Van kracht',
  historisch: 'Historisch',
  herzien: 'Herzien',
  'deels-geschrapt': 'Deels geschrapt',
};

/**
 * True als de datum de "laatst gewijzigd"-datum van de KVK-bronpagina is en
 * geen publicatiedatum. Dat geldt alleen voor de in oktober 2026 omgezette
 * KVK-artikelen: die behielden de sitemap-lastmod als datum (en hun
 * fetchedAt). Nieuwe Avydo-artikelen hebben geen fetchedAt; hun datum is de
 * eigen publicatiedatum van Avydo.
 * @param {{ sourceName: string, fetchedAt?: Date | string, sourcePublishedAt?: Date | string }} data
 */
export function dateIsSourceLastModified(data) {
  return data.sourceName === 'KVK' && data.fetchedAt != null && data.sourcePublishedAt == null;
}

/** Statussen die betekenen dat de brontekst niet (meer) de actuele situatie beschrijft. */
export const OUTDATED_STATUSES = new Set(['historisch', 'herzien', 'deels-geschrapt']);
