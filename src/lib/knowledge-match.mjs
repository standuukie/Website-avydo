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

// Ondergrens voor tokenlengte. Was eerder >2 (dus minstens 3 tekens), maar
// dat filterde stilzwijgend "bv" weg — een van de belangrijkste termen in
// deze hele kennisbank (rechtsvorm-vergelijkingen, DGA-onderwerpen, enz.).
// Bij >1 (dus minstens 2 tekens) blijft "bv" wél een token, terwijl vrijwel
// alle overige korte Nederlandse functiewoorden van 2 tekens (in, is, te,
// of, er, om, nu, zo, ik, je, me, ...) al expliciet in STOPWORDS staan en
// dus alsnog worden uitgefilterd.
const MIN_TOKEN_LENGTH = 1;

/** @param {string} text */
export function tokenize(text) {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return (normalized.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > MIN_TOKEN_LENGTH && !STOPWORDS.has(w));
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

// Minimumscore om een kennisitem/artikel/deadline daadwerkelijk als context
// mee te geven (zie ook MIN_ARTICLE_RELEVANCE_SCORE-gebruik in
// ai-assistent.ts, dezelfde drempel voor Kenniscentrum-artikelen en
// Belastingkalender-deadlines). Eén enkel gedeeld woord dat uitsluitend in
// de lopende tekst voorkomt (score 1) is te zwak om op te vertrouwen — dat
// kan een toevallig gedeeld, verder inhoudsloos woord zijn (bijv. een
// generiek bijvoeglijk naamwoord als "beste", of "btw" dat toevallig ook in
// een compleet ander nieuwsartikel voorkomt). Een treffer in titel/tags
// (die al 2x meetelt) of twee of meer treffers in de lopende tekst halen
// deze drempel altijd.
export const MIN_RELEVANCE_SCORE = 2;

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

// Strengere drempel dan MIN_RELEVANCE_SCORE (2): een deterministische
// fallback (zie findDeterministicFallbackItem) mag alleen bij een écht
// ondubbelzinnige match gebruikt worden, nooit bij een zwak/toevallig
// gedeeld woord — dit antwoord komt immers zonder taalmodel-tussenkomst bij
// de bezoeker terecht, dus een fout-positieve match is hier duurder dan bij
// gewone contextretrieval (waar het taalmodel zelf nog een irrelevante bron
// kan negeren). 3 (in plaats van bijvoorbeeld 4) is bewust gekozen: een
// typische "wat is X?"-vraag reduceert na het strippen van stopwoorden tot
// ÉÉN trefwoord, en overlapScore telt de AANWEZIGHEID van een trefwoord
// (niet de frequentie) — het hoogst haalbare voor een eenwoordige vraag is
// dus een treffer in titel/tags (2x) plus één treffer in de lopende tekst
// (1x) = 3. Een drempel van 4 zou daarmee voor vrijwel elke simpele
// definitievraag onbereikbaar zijn, wat de fallback in de praktijk nutteloos
// zou maken. Score 3 vereist nog steeds een titel/tag-treffer (geen toeval)
// mét een aanvullende bodytreffer — duidelijk strenger dan de gewone
// MIN_RELEVANCE_SCORE (2), die al voldoet aan één enkele titel/tag-treffer
// alléén.
export const DETERMINISTIC_FALLBACK_MIN_SCORE = 3;

// Woorden/zinsdelen die een vraag NOOIT geschikt maken voor een
// deterministische fallback, ongeacht welk kennisitem verder zou matchen:
// een bedrag/percentage-vraag ("hoeveel...") kan per definitie nooit door
// kale, cijferloze kennisbank-content beantwoord worden (zie
// ai-knowledge/index.ts: bewust geen bedragen/percentages in content), en
// een vergelijkende/persoonlijke vraag ("voordeliger", "beter", "moet ik",
// "mag ik", "kan ik", "voor mij", "mijn situatie") vereist per opdracht
// juist de nuance/doorvraaglogica uit de systeemprompt, niet een vlakke
// definitie. Zonder deze uitsluiting zou bijvoorbeeld "hoeveel loon moet ik
// mezelf als DGA betalen?" via het losse "dga"-item (dat toevallig ook het
// woord "loon" noemt) een te simpel, ontoereikend antwoord krijgen in
// plaats van de uitleg van de gebruikelijkloonregeling.
const FALLBACK_EXCLUDED_PATTERN = /\b(hoeveel|voordeliger|goedkoper|beter|verschil|moet ik|mag ik|kan ik|voor mij|mijn situatie)\b/i;

/**
 * Zoekt, uitsluitend onder items met `deterministicFallback === true`, een
 * ondubbelzinnige match voor `query` — bedoeld als laatste redmiddel
 * wanneer de AI-provider zelf niet bereikbaar is (zie kenniscentrum-chat.ts,
 * PROVIDER-FALLBACK) en er dus geen taalmodel is dat een grensgeval nog zelf
 * kan beoordelen. Bewust conservatief:
 * - nooit bij een vraagvorm die om een bedrag of een persoonlijke/
 *   vergelijkende beoordeling vraagt (zie FALLBACK_EXCLUDED_PATTERN);
 * - nooit bij een kandidaat onder DETERMINISTIC_FALLBACK_MIN_SCORE;
 * - nooit bij een dubbelzinnige uitkomst: als een tweede kandidaat na de
 *   score EN een titel-tiebreak (een treffer in de titel zelf weegt zwaarder
 *   dan een treffer die alleen via een bijkomende tag/lopende tekst komt)
 *   nog steeds gelijk staat met de beste, is de vraag te dubbelzinnig om
 *   zonder het taalmodel te beantwoorden.
 * @template {{ title: string, category: string, content: string, tags: string[], deterministicFallback?: boolean }} T
 * @param {string} query
 * @param {T[]} items
 * @returns {T | null}
 */
export function findDeterministicFallbackItem(query, items) {
  if (FALLBACK_EXCLUDED_PATTERN.test(query)) return null;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  const scored = items
    .filter((item) => item.deterministicFallback === true)
    .map((item) => ({
      item,
      score: scoreKnowledgeItem(queryTokens, item),
      titleScore: overlapScore(queryTokens, item.title),
    }))
    .filter((x) => x.score >= DETERMINISTIC_FALLBACK_MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.titleScore - a.titleScore);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score && scored[1].titleScore === scored[0].titleScore) {
    return null; // nog steeds te dubbelzinnig ná de titel-tiebreak
  }
  return scored[0].item;
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
