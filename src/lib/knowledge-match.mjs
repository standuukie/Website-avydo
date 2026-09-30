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

// --- Contextafhankelijke vervolgvragen ("en als ik de winst erin laat?") --
//
// Root cause (2026-09-30, "winst erin laten"-incident): kenniscentrum-
// chat.ts probeert de HUIDIGE vraag eerst alleen, en valt pas terug op
// buildRetrievalQuery() (hierboven, de VOLLEDIGE geschiedenis) als die kale
// poging NUL bronnen oplevert. Een korte vervolgvraag levert echter bijna
// nooit nul treffers op — "en als ik de winst erin laat?" bevat zelf al het
// woord "winst", dat toevallig ook (zwak) matcht op bijvoorbeeld
// winst-en-verliesrekening. Omdat sources.length dan al > 0 is, wordt de
// geschiedenis nooit geraadpleegd en wint het toevallige, verkeerde item —
// niet omdat de bestaande scoring/tokenize/overlapScore-logica kapot is
// (die blijft hier volledig ongewijzigd), maar omdat het TRIGGERPUNT voor
// "context nodig?" te grof is (nul-of-niet in plaats van "verwijst deze
// vraag naar iets eerder genoemds?").
//
// Verwijswoorden ("die", "dat", "dit", "het", "erin", "daar", ...) zijn
// bewust WEL in STOPWORDS (hierboven) opgenomen voor de gewone scoring —
// terecht, want ze zijn geen onderwerpsindicator. Voor DIT specifieke doel
// (detecteren of een vraag naar iets eerder genoemds verwijst) zijn het
// echter precies het signaal dat nodig is, dus deze lijst werkt op de RUWE
// woorden van de vraag, los van tokenize()/STOPWORDS.
// "het" is BEWUST uitgesloten: in "hoe zit het met dividend?" / "wat
// betekent het?" is "het" vaak een grammaticaal vulwoord (vaste uitdrukking
// "hoe zit het met X") zonder een eigen ontbrekend verwijsdoel zodra de zin
// zelf al een duidelijk onderwerp noemt (hier: "dividend") — een test tegen
// de echte kennisbank liet zien dat "het" als cue-woord juist een al
// correct opgeloste, zelfstandige vraag ("En hoe zit het met dividend?",
// die op zichzelf al ondubbelzinnig naar dividend wijst) onnodig aan
// eerdere, minder relevante context ging koppelen. De overige woorden zijn
// wél consequent echte verwijswoorden (vervangen een zelfstandig naamwoord)
// en blijven daarom staan.
const CONTEXT_CUE_WORDS = new Set([
  'die', 'dat', 'dit', 'deze', 'hem', 'haar', 'ze', 'zij',
  'erin', 'erop', 'ermee', 'erover', 'ervan', 'ervoor', 'erna', 'eraan',
  'daarin', 'daarop', 'daarmee', 'daarover', 'daarvan', 'daarvoor', 'daaraan', 'daar',
  'hierin', 'hierop', 'hiermee', 'hierover', 'hiervan', 'hiervoor',
]);

// Een vervolgvraag met een verwijswoord is typisch kort ("en hoe zit dat?",
// "kan ik die aftrekken?"). Een langere zin die toevallig ook "dat"/"die"
// bevat, is doorgaans wél zelfstandig genoeg (bijv. een samengestelde vraag)
// en hoeft niet met oudere context vermengd te worden — vandaar deze grens,
// ruim boven de lengte van elk voorbeeld uit de opdracht (maximaal 7 woorden).
const MAX_CONTEXT_DEPENDENT_WORDS = 12;

/** @param {string} text */
function rawWords(text) {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .match(/[a-z0-9]+/g) ?? []
  );
}

/**
 * True als `message` vermoedelijk niet op zichzelf staat — dus een
 * verwijswoord bevat ("die", "erin", "daar", ...) en kort genoeg is om een
 * elliptische vervolgvraag te zijn, zie CONTEXT_CUE_WORDS hierboven. Bewust
 * GEEN lengte-only heuristiek ("kort dus contextafhankelijk"): een korte,
 * zelfstandige vraag als "Wat is KIA?" heeft geen verwijswoord en telt dus
 * terecht niet mee, ook al is hij net zo kort als "En als ik die toch koop?".
 * @param {string} message
 */
export function isLikelyContextDependent(message) {
  const words = rawWords(message);
  if (words.length === 0 || words.length > MAX_CONTEXT_DEPENDENT_WORDS) return false;
  return words.some((w) => CONTEXT_CUE_WORDS.has(w));
}

/**
 * Zoekt kennisitems voor een vervolgvraag. Kernregel: de HUIDIGE vraag
 * blijft altijd leidend — de score op de huidige vraag alleen (exact
 * dezelfde scoreKnowledgeItem() als bij een zelfstandige vraag) is en
 * blijft de EERSTE sorteersleutel. De vorige vraag uit het gesprek (niet
 * het hele gesprek — zie CONTEXT_CUE_WORDS hierboven) doet daarom NOOIT een
 * item winnen dat op de huidige vraag zelf al zwakker scoort dan een ander
 * item; ze fungeert uitsluitend als TWEEDE sorteersleutel om een score-
 * gelijkspel op te lossen dat nu nog arbitrair via array-volgorde/prioriteit
 * wordt beslist (bijv. "kan ik daar geld uit halen?" na "wat is een
 * eenmanszaak?": rekening-courant-dga en priveonttrekkingen-eenmanszaak
 * scoren op de kale vraag exact gelijk — de vorige vraag maakt dan het
 * verschil). Dit is bewust GEEN gewogen som van beide scores: een
 * optelling bleek in de praktijk een niet-gelijkspel-verschil op de huidige
 * vraag (bijv. 4 om 3) alsnog te kunnen omdraaien puur door een toevallig
 * sterke score van de vorige vraag — dat zou "de actuele vraag blijft
 * leidend" schenden.
 *
 * Uitzondering: als de huidige vraag ZELF helemaal niets oplevert (geen
 * enkel item haalt MIN_RELEVANCE_SCORE) — een écht elliptische vraag als
 * "en hoe zit dat?" of "moet ik dat dan ook regelen?", die vrijwel geen
 * eigen inhoudswoorden overhoudt — dan is er niets om leidend te laten zijn,
 * en wordt uitsluitend op de vorige vraag gezocht (functioneel gelijk aan
 * retrieveKnowledgeItems() op die vorige vraag).
 *
 * Voor een zelfstandige vraag (geen verwijswoord, zie isLikelyContextDependent)
 * is dit functioneel identiek aan gewoon retrieveKnowledgeItems(currentMessage,
 * ...) — er wordt dan geen context geraadpleegd, dus de bestaande
 * zelfstandige-vraagkwaliteit (27/27) verandert hier niet.
 * @template {{ title: string, category: string, content: string, tags: string[], priority: number }} T
 * @param {string} currentMessage
 * @param {string[]} previousUserMessages eerdere vragen van de bezoeker in dit gesprek, oud → nieuw
 * @param {T[]} items
 * @param {{ maxItems?: number }} [opts]
 * @returns {T[]}
 */
export function retrieveKnowledgeItemsWithContext(currentMessage, previousUserMessages, items, opts = {}) {
  const maxItems = opts.maxItems ?? 3;
  const currentTokens = tokenize(currentMessage);

  if (!isLikelyContextDependent(currentMessage) || previousUserMessages.length === 0) {
    return retrieveKnowledgeItems(currentMessage, items, opts);
  }

  const recentContext = previousUserMessages[previousUserMessages.length - 1] ?? '';
  const contextTokens = tokenize(recentContext);

  const scored = items.map((item) => ({
    item,
    currentScore: currentTokens.length > 0 ? scoreKnowledgeItem(currentTokens, item) : 0,
    contextScore: contextTokens.length > 0 ? scoreKnowledgeItem(contextTokens, item) : 0,
  }));

  const hasOwnSignal = scored.some((x) => x.currentScore >= MIN_RELEVANCE_SCORE);

  if (!hasOwnSignal) {
    // Écht elliptisch: niets om leidend te laten zijn, dus puur op de
    // vorige vraag zoeken (zelfde drempel/limiet als een gewone vraag).
    return retrieveKnowledgeItems(recentContext, items, opts);
  }

  return scored
    .filter((x) => x.currentScore >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.currentScore - a.currentScore || b.contextScore - a.contextScore || b.item.priority - a.item.priority)
    .slice(0, maxItems)
    .map((x) => x.item);
}
