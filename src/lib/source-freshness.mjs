// Actualiteit van Kenniscentrum-bronnen (2026-10-07).
//
// Bewust klein en expliciet: er is GEEN automatische "nieuwste wint" en GEEN
// recentheidsbonus. De enige actualiteitsinformatie die de volgorde
// beïnvloedt, is het handmatig (redactioneel) gezette frontmatterveld
// `supersededBy` (de sourceUrl van het artikel dat een artikel inhoudelijk
// heeft opgevolgd). Een opgevolgd artikel blijft gewoon in de kennisbank en
// in retrieval; het krijgt alleen lagere voorrang. Een later beleidsvoornemen
// zonder `supersededBy`-relatie verdringt dus nooit automatisch een geldende
// regel. Los .mjs-bestand (zelfde patroon als knowledge-match.mjs) zodat dit
// zonder Astro-runtime getest kan worden.

/**
 * Sorteert artikelkandidaten die de relevantiedrempel al gehaald hebben:
 *  1. bestaande relevantiescore (hoogste eerst) — ongewijzigd leidend;
 *  2. bij gelijke score: niet-opgevolgde artikelen vóór opgevolgde;
 *  3. daarbinnen: publicatiedatum (nieuwste eerst), de bestaande tiebreaker;
 *  4. een opgevolgd artikel staat nooit vóór zijn eigen opvolger, als die
 *     opvolger zelf ook een kandidaat is (alleen via de expliciete
 *     `supersededBy`-relatie, nooit op basis van datum alleen).
 *
 * @template {{ score: number, publishedAt: Date, sourceUrl: string, supersededBy?: string }} T
 * @param {T[]} scored
 * @returns {T[]}
 */
export function rankScoredArticles(scored) {
  const ranked = [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      Number(Boolean(a.supersededBy)) - Number(Boolean(b.supersededBy)) ||
      b.publishedAt.valueOf() - a.publishedAt.valueOf(),
  );
  for (let i = 0; i < ranked.length; i++) {
    const successorUrl = ranked[i].supersededBy;
    if (!successorUrl) continue;
    const j = ranked.findIndex((candidate, k) => k > i && candidate.sourceUrl === successorUrl);
    if (j > i) {
      const [successor] = ranked.splice(j, 1);
      ranked.splice(i, 0, successor);
    }
  }
  return ranked;
}

/**
 * Na de topselectie: vervangt een GESELECTEERD artikel met een expliciet
 * gezette `supersededBy` door zijn opvolger. Uitsluitend als:
 *  - `supersededBy` exact overeenkomt met de sourceUrl van precies één
 *    artikel in `corpus` (een gedeelde/dubbelzinnige sourceUrl: geen
 *    vervanging);
 *  - die opvolger nog niet geselecteerd is.
 * Een artikel zonder `supersededBy` wordt nooit vervangen. Geen
 * "nieuwste wint", geen datum-, titel- of fuzzy-matching; scores en de
 * volgorde van de selectie blijven verder ongewijzigd (de opvolger neemt de
 * plek van het opgevolgde artikel in).
 *
 * @template {{ sourceUrl: string, supersededBy?: string }} T
 * @param {T[]} selected
 * @param {T[]} corpus
 * @returns {T[]}
 */
export function substituteExplicitSuccessors(selected, corpus) {
  const byUrl = new Map();
  const ambiguous = new Set();
  for (const candidate of corpus) {
    if (byUrl.has(candidate.sourceUrl)) ambiguous.add(candidate.sourceUrl);
    else byUrl.set(candidate.sourceUrl, candidate);
  }
  const selectedUrls = new Set(selected.map((item) => item.sourceUrl));
  return selected.map((item) => {
    const successorUrl = item.supersededBy;
    if (!successorUrl || ambiguous.has(successorUrl) || selectedUrls.has(successorUrl)) return item;
    const successor = byUrl.get(successorUrl);
    if (!successor) return item;
    selectedUrls.add(successorUrl);
    return successor;
  });
}

/** @param {Date} date */
export function formatSourceDate(date) {
  return date.toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Bronnaam zoals het model hem ziet: met publicatiedatum (alleen voor bronnen
 * die er één hebben, d.w.z. Kenniscentrum-artikelen) en het label
 * "historisch" voor een opgevolgd artikel. Andere bronnen blijven ongewijzigd.
 *
 * @param {{ name: string, publishedAt?: Date, superseded?: boolean }} source
 */
export function formatSourceName(source) {
  if (!source.publishedAt) return source.name;
  const extra = `${formatSourceDate(source.publishedAt)}${source.superseded ? ', historisch' : ''}`;
  return source.name.endsWith(')') ? `${source.name.slice(0, -1)}, ${extra})` : `${source.name} (${extra})`;
}

/**
 * @param {Array<{ id: number, name: string, title: string, snippet: string, publishedAt?: Date, superseded?: boolean }>} sources
 */
export function formatSourcesForPrompt(sources) {
  if (sources.length === 0) return '(Geen relevante bronnen gevonden in het Kenniscentrum, de Belastingkalender of Avydo-informatie voor deze vraag.)';
  return sources.map((s) => `[${s.id}] ${formatSourceName(s)} — "${s.title}"\n${s.snippet}`).join('\n\n');
}
