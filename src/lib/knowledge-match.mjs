// Providerneutrale, framework-onafhankelijke trefwoord-matching voor de
// AI-assistent. Bewust een losstaand .mjs-bestand (geen Astro/astro:content-
// afhankelijkheid) zodat het zowel vanuit de Astro-runtime (src/lib/
// ai-assistent.ts) als rechtstreeks vanuit Node's ingebouwde testrunner
// (scripts/kenniscentrum/*.test.mjs, `npm run kenniscentrum:test`) te
// gebruiken is — geen extra testdependency (ts-node/vitest/etc.) nodig.
//
// Dit is dezelfde, simpele trefwoord-overlapaanpak die retrieveContext() al
// gebruikte voor Kenniscentrum-artikelen en Belastingkalender-deadlines
// (zie ai-assistent.ts) — hier eenmalig gedefinieerd zodat alle brontypes
// (artikelen, deadlines, en nu ook de Avydo-kennisbank) dezelfde,
// geverifieerde matchinglogica delen.

const STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'van', 'voor', 'op', 'in', 'is', 'wat', 'hoe', 'wanneer',
  'moet', 'ik', 'mijn', 'als', 'dat', 'die', 'met', 'te', 'aan', 'of', 'dit', 'naar',
  'uw', 'u', 'kan', 'kun', 'ben', 'zijn', 'er', 'bij', 'ook', 'om', 'nog', 'wel', 'niet',
  'wij', 'we', 'jij', 'je', 'me', 'mij', 'over', 'per', 'tot', 'zo', 'maar', 'dan', 'nu',
  // Overige vraagwoorden/verwijswoorden zonder eigen onderwerpsbetekenis —
  // zonder deze zou bijvoorbeeld een geheel onderwerpsvreemde vraag als
  // "wie won de voetbalwedstrijd?" per ongeluk matchen op elk kennisitem
  // wiens titel/tag toevallig ook het woord "wie" bevat (bijv. "voor wie
  // geldt de btw"), puur door het gedeelde vraagwoord.
  'wie', 'waar', 'welke', 'welk', 'waarom', 'waarvoor',
  // Zeer algemene Nederlandse hulp-/koppelwerkwoorden die in vrijwel elke
  // juridisch/procedureel geformuleerde zin voorkomen (bijv. "... gaan
  // gelden", "moet worden ingeschreven") en dus geen enkel onderwerps-
  // signaal geven — zonder deze zou bijvoorbeeld "waar kan ik het beste op
  // vakantie gaan?" toevallig matchen via het woord "gaan".
  'gaan', 'gaat', 'wordt', 'worden', 'zou', 'zullen', 'moeten', 'kunnen',
]);

/** @param {string} text */
export function tokenize(text) {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return (normalized.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * @param {string[]} queryTokens
 * @param {string} text
 */
export function overlapScore(queryTokens, text) {
  const tokens = new Set(tokenize(text));
  let score = 0;
  for (const q of queryTokens) if (tokens.has(q)) score += 1;
  return score;
}

/**
 * Scoort één kennisitem tegen de al-getokeniseerde vraag. Titel en tags
 * wegen zwaarder (2x) dan categorie/inhoud: een treffer op het onderwerp
 * zelf ("kor", "gebruikelijk loon") is een sterker signaal van relevantie
 * dan een toevallig woord dat ook ergens in de lopende tekst voorkomt.
 * @param {string[]} queryTokens
 * @param {{ title: string, category: string, content: string, tags: string[] }} item
 */
export function scoreKnowledgeItem(queryTokens, item) {
  const titleAndTags = `${item.title} ${item.tags.join(' ')}`;
  const bodyText = `${item.category} ${item.content}`;
  return overlapScore(queryTokens, titleAndTags) * 2 + overlapScore(queryTokens, bodyText);
}

// Minimumscore om een kennisitem daadwerkelijk als context mee te geven.
// Eén enkel gedeeld woord dat uitsluitend in de lopende tekst voorkomt
// (score 1) is te zwak om op te vertrouwen — dat kan een toevallig
// gedeeld, verder inhoudsloos woord zijn (bijv. een generiek bijvoeglijk
// naamwoord als "beste"). Een treffer in titel/tags (die al 2x meetelt) of
// twee of meer treffers in de lopende tekst halen deze drempel altijd.
const MIN_RELEVANCE_SCORE = 2;

/**
 * Selecteert de meest relevante kennisitems voor een vraag. Geeft nooit
 * meer dan `maxItems` items terug, en nooit een item onder
 * MIN_RELEVANCE_SCORE — zo krijgt het taalmodel nooit tientallen
 * irrelevante kennisitems als context, en blijft "geen relevante kennis
 * gevonden" ook echt leeg in plaats van willekeurig gevuld met een zwakke,
 * toevallige woordovereenkomst.
 * @template {{ title: string, category: string, content: string, tags: string[], priority: number }} T
 * @param {string} query
 * @param {T[]} items
 * @param {{ maxItems?: number }} [opts]
 * @returns {T[]}
 */
export function retrieveKnowledgeItems(query, items, opts = {}) {
  const maxItems = opts.maxItems ?? 3;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return items
    .map((item) => ({ item, score: scoreKnowledgeItem(queryTokens, item) }))
    .filter((x) => x.score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority)
    .slice(0, maxItems)
    .map((x) => x.item);
}

/**
 * Bouwt de tekst die voor retrieval (dus NIET voor wat het model als
 * "vraag van de bezoeker" te zien krijgt) wordt getokeniseerd, door de
 * eerdere gebruikersvragen uit het gesprek vóór de huidige vraag te
 * plakken. Dit lost op dat een elliptische vervolgvraag ("en hoe zit dat
 * bij een BV?", "en voor een starter?", "hoe zit dat met dividend?") op
 * zichzelf te weinig of geen trefwoorden bevat om de juiste kennisitems/
 * artikelen te vinden — de eerdere vraag ("is een BV voordeliger?") levert
 * het ontbrekende onderwerp. Geen permanente opslag: dit gebruikt precies
 * dezelfde chatgeschiedenis die de client toch al meestuurt naar de
 * provider (zie kenniscentrum-chat.ts).
 * @param {string[]} previousUserMessages eerdere vragen van de bezoeker in dit gesprek, oud → nieuw
 * @param {string} currentMessage
 * @returns {string}
 */
export function buildRetrievalQuery(previousUserMessages, currentMessage) {
  return [...previousUserMessages, currentMessage].filter((part) => typeof part === 'string' && part.trim().length > 0).join(' ');
}
