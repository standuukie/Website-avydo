// Controles op de bronlink van een Avydo-artikel en de titel van een
// bronrecord.
//
// Twee afzonderlijke regels:
// - URL-specificiteit (deze module): een bron-URL moet naar een pagina over
//   één onderwerp wijzen, niet naar een start- of rubriekpagina. Deze controle
//   kijkt alleen naar de URL zelf.
// - Bronrelatie (bronlaag): per bron-URL is er één bronrecord, en dat record
//   is via `avydoSlug` aan hooguit één artikel gekoppeld. Twee artikelen op
//   dezelfde specifieke bron kan dus niet; de bronrelatietest in
//   source-links.test.mjs en de duplicaatcontrole van de redactiepipeline
//   (validateAvydoArticle) houden dat tegen. Dat volgt uit het datamodel,
//   niet uit de URL-controle hieronder.
//
// Aanleiding (audit 2026-10-09): elf handgeschreven gidsen verwezen allemaal
// naar dezelfde algemene Belastingdienst-URL, die doorverwijst naar de
// overzichtspagina "Ondernemers". De lezer kwam zo op een menu uit in plaats
// van op de pagina over het onderwerp van het artikel. In de bronlaag stond
// daarvoor één record met de placeholdertitel "Belastingdienst –
// geraadpleegde bronpagina".
import { normalizeSourceUrl } from './source-records.mjs';

// Startpagina's van belastingdienst.nl. Live gecontroleerd op 2026-10-09:
// .../belastingdienst/zakelijk/ verwijst door naar .../nl/ondernemers/ondernemers
// ("Ondernemers"), .../belastingdienst/prive/ naar .../nl/home/home
// ("Belastingdienst Nederland"). Specifieke pagina's van de Belastingdienst
// liggen altijd dieper; ook een themapagina zoals /nl/box-3/box-3 staat hier
// dus niet tussen.
const BELASTINGDIENST_PORTAL_PATHS = new Set([
  '',
  '/wps/wcm/connect',
  '/wps/wcm/connect/bldcontentnl/belastingdienst',
  '/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk',
  '/wps/wcm/connect/bldcontentnl/belastingdienst/prive',
  '/wps/wcm/connect/nl/home/home',
  '/wps/wcm/connect/nl/ondernemers/ondernemers',
]);

// Op kvk.nl en rijksoverheid.nl is een pad van één segment een rubriek met
// links naar onderliggende pagina's (live gecontroleerd: kvk.nl/deponeren/ is
// "Deponeren", kvk.nl/starten/ "Een eigen bedrijf starten? Begin hier",
// rijksoverheid.nl/onderwerpen verwijst door naar "Thema's"). Inhoud over één
// onderwerp staat op /<rubriek>/<pagina>/.
const SECTION_HOSTS = ['kvk.nl', 'rijksoverheid.nl'];

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Waarom een bron-URL een algemene start- of rubriekpagina is, of null als
 * de URL naar een specifieke pagina wijst.
 * @param {string} url
 * @returns {string|null}
 */
export function genericSourceReason(url) {
  let parsed;
  try {
    parsed = new URL(normalizeSourceUrl(url));
  } catch {
    return null;
  }
  const host = parsed.hostname;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname === '') return 'startpagina van de site';
  if (hostMatches(host, 'belastingdienst.nl') && BELASTINGDIENST_PORTAL_PATHS.has(pathname)) {
    return 'startpagina van belastingdienst.nl (overzicht, geen pagina over één onderwerp)';
  }
  if (SECTION_HOSTS.some((d) => hostMatches(host, d)) && pathname.split('/').filter(Boolean).length === 1) {
    return `rubriekpagina van ${host} (overzicht van onderliggende pagina's)`;
  }
  return null;
}

export function isGenericSourceUrl(url) {
  return genericSourceReason(url) !== null;
}

/**
 * Een titel die niets over de bronpagina zegt: leeg, alleen de bronnaam,
 * of een aanduiding als "geraadpleegde bronpagina".
 * @param {string|undefined} title
 * @param {string|undefined} sourceName
 */
export function isPlaceholderSourceTitle(title, sourceName) {
  const t = String(title ?? '').trim();
  if (t === '') return true;
  if (sourceName && t.toLowerCase() === String(sourceName).trim().toLowerCase()) return true;
  return /geraadpleegde\s+bron|^\s*bron(pagina)?\s*$/i.test(t);
}

/**
 * URL-specificiteit van de bronlinks van artikelen: algemene start- of
 * rubriekpagina's, en een algemene URL die meerdere artikelen delen (wijst
 * op een placeholder). Meerdere artikelen op dezelfde specifieke URL meldt
 * deze functie niet, want dat is geen kwestie van URL-specificiteit; de
 * bronlaag staat het niet toe (één record per URL, gekoppeld aan één
 * artikel) en de bronrelatietest vangt het af.
 * @param {Array<{slug: string, sourceUrl: string}>} articles
 * @returns {Array<{type: 'generic-url', slug: string, url: string, reason: string} | {type: 'shared-generic-url', url: string, slugs: string[]}>}
 */
export function findSourceLinkIssues(articles) {
  const issues = [];
  const byUrl = new Map();
  for (const a of articles) {
    const reason = genericSourceReason(a.sourceUrl);
    if (reason) issues.push({ type: 'generic-url', slug: a.slug, url: a.sourceUrl, reason });
    const key = normalizeSourceUrl(a.sourceUrl);
    byUrl.set(key, [...(byUrl.get(key) ?? []), a.slug]);
  }
  for (const [url, slugs] of byUrl) {
    if (slugs.length > 1 && isGenericSourceUrl(url)) issues.push({ type: 'shared-generic-url', url, slugs: [...slugs].sort() });
  }
  return issues;
}

/**
 * Gepubliceerde artikelen (niet `hidden`) waarvan de bron-URL een bronrecord
 * met status `afgewezen` heeft. Een afgewezen bron is ongeschikt als basis
 * voor een artikel, ongeacht de reden of de site. Geeft alleen id's en URL's
 * terug, geen broninhoud.
 * @param {Array<{slug: string, sourceUrl: string, hidden?: boolean}>} articles
 * @param {Array<{id: string, sourceUrl: string, processingStatus: string}>} records
 * @returns {Array<{recordId: string, slug: string, url: string}>}
 */
export function findRejectedSourcesInUse(articles, records) {
  const rejected = new Map(
    records.filter((r) => r.processingStatus === 'afgewezen').map((r) => [normalizeSourceUrl(r.sourceUrl), r.id]),
  );
  return articles
    .filter((a) => !a.hidden && rejected.has(normalizeSourceUrl(a.sourceUrl)))
    .map((a) => ({ recordId: rejected.get(normalizeSourceUrl(a.sourceUrl)), slug: a.slug, url: a.sourceUrl }));
}

/** Leesbare melding per geval, voor testuitvoer. */
export function describeRejectedSourceInUse({ recordId, slug }) {
  return `bronrecord ${recordId} is afgewezen, maar het gepubliceerde artikel ${slug} gebruikt deze bron`;
}

/**
 * Bronrecords met een placeholdertitel.
 * @param {Array<{id: string, title?: string, sourceName?: string}>} records
 */
export function findPlaceholderRecordTitles(records) {
  return records.filter((r) => isPlaceholderSourceTitle(r.title, r.sourceName)).map((r) => r.id);
}
