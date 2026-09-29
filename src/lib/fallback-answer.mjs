// Pure, framework-onafhankelijke opbouw van een fallback-antwoord (dus
// zonder Groq-aanroep) — gedeeld tussen de route (src/pages/api/
// kenniscentrum-chat.ts) en de testset. Bewust een los .mjs-bestand (zelfde
// patroon als knowledge-match.mjs/rate-limit.mjs/token-estimate.mjs/
// error-classify.mjs): geen Astro-/TypeScript-afhankelijkheid, dus
// rechtstreeks te testen met Node's ingebouwde testrunner (`npm run
// kenniscentrum:test`) zonder TS-transpilatie of een live Groq-aanroep.
//
// Twee niveaus (ronde 6, 2026-09-30 — het Groq TPD-incident):
// 1. buildFallbackAnswer: een ondubbelzinnige, deterministische match op ÉÉN
//    kennisitem (zie findDeterministicFallbackItem in knowledge-match.mjs) —
//    het meest betrouwbare, want vooraf zelf gecureerde antwoord.
// 2. buildSourceFallbackAnswer: wanneer zo'n ondubbelzinnige match ontbreekt,
//    maar de gewone, context-bewuste retrieval (dezelfde bronnen die anders
//    naar Groq zouden gaan) wél relevante bronnen opleverde — de INHOUD van
//    die bron wordt dan rechtstreeks als antwoord gepresenteerd. Beide geven
//    uitsluitend letterlijke brontekst terug, nooit een samenvatting,
//    interpretatie of aanvulling — er is immers geen taalmodel beschikbaar
//    om dat betrouwbaar te doen.
//
// Incident (2026-09-30, ronde 8 — "kruisbesmetting" tussen kennisitems in
// productie): een eerdere versie van buildSourceFallbackAnswer nam niet
// alleen de PRIMAIRE (best scorende) bron, maar plakte ook de VOLLEDIGE,
// letterlijke snippet van een eventuele TWEEDE bron achter het antwoord —
// bijvoorbeeld: retrieval voor "wat moet ik regelen als ik personeel
// aanneem?" vindt zowel "werknemer-aannemen" (primair) als, via een gedeeld
// trefwoord, "onderneming-starten" (secundair, legitiem verwant maar niet
// het onderwerp van de vraag) — zonder taalmodel dat kan filteren, werd de
// complete "onderneming starten"-alinea dan letterlijk aan het correcte
// antwoord geplakt. Dit was GEEN fout in de kennisitems zelf (die bevatten,
// geverifieerd, geen enkele ingesloten tekst uit een ander onderwerp — zie
// git-historie/testverslag), maar in hoe deze functie meerdere, op zichzelf
// correcte bronnen samenvoegde. Fix: gebruik uitsluitend de primaire,
// hoogst scorende bron — exact hetzelfde principe als buildFallbackAnswer
// hierboven (één onderwerp, één bron), nooit de volledige tekst van een
// tweede bron erbij plakken. Een eventuele tweede, minder relevante bron
// wordt nu simpelweg genegeerd voor dit (taalmodel-loze) fallback-antwoord,
// in plaats van blindelings meegenomen.
//
// `note` is bewust altijd een lege string (ronde 6, punt 4 — "maak fallback-
// antwoorden natuurlijker"): een eerdere versie voegde hier een technische
// disclaimer toe ("de AI-assistent is op dit moment tijdelijk niet
// bereikbaar..."). De bezoeker hoeft niet te weten dat Groq achterliggend
// een RPM/TPM/TPD-limiet raakte — zolang het antwoord inhoudelijk correct en
// van een echte bron voorzien is, verschijnt dit gewoon als een normaal
// Avydo-antwoord.

/**
 * @param {{ content: string, sourceName: string, title: string, sourceUrl: string }} item
 */
export function buildFallbackAnswer(item) {
  const sentences = item.content.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const shortAnswer = sentences[0] ?? item.content;
  const explanation = sentences.slice(1).join(' ');
  return {
    ok: true,
    shortAnswer,
    explanation,
    note: '',
    insufficientInfo: false,
    personalAdviceNeeded: false,
    sources: [{ name: `Avydo kennisbank (bron: ${item.sourceName})`, title: item.title, url: item.sourceUrl }],
    fallback: true,
  };
}

/**
 * @param {Array<{ name: string, title: string, url: string, snippet: string }>} sources
 */
export function buildSourceFallbackAnswer(sources) {
  const primary = sources[0];
  const sentences = primary.snippet.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const shortAnswer = sentences[0] ?? primary.snippet;
  const explanation = sentences.slice(1).join(' ');
  return {
    ok: true,
    shortAnswer,
    explanation,
    note: '',
    insufficientInfo: false,
    personalAdviceNeeded: false,
    sources: [{ name: primary.name, title: primary.title, url: primary.url }],
    fallback: true,
  };
}
