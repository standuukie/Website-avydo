// Providerneutrale, framework-onafhankelijke sliding-window rate limiter.
// Bewust een los, plain .mjs-bestand (zelfde patroon als knowledge-match.mjs)
// zodat de eigenlijke limiter-logica rechtstreeks door Node's ingebouwde
// testrunner getest kan worden (`npm run kenniscentrum:test`,
// scripts/kenniscentrum/rate-limit.test.mjs) — inclusief het tijdvenster
// zelf, via de optionele `now`-parameter, zonder dat een test echt hoeft te
// wachten. Gebruikt in src/pages/api/kenniscentrum-chat.ts voor de globale
// en per-IP requestlimiet (gewicht 1 per hit, dus in feite een simpele
// telling), én voor de token-bewuste (TPM) limiet (gewicht = geschat
// aantal tokens per verzoek) — zelfde implementatie voor beide, alleen het
// gewicht per hit verschilt.
//
// Puur in-memory, geen permanente opslag: de hits leven alleen zolang de
// serverless-instance warm is.

/**
 * @param {{ windowMs: number, max: number }} opts
 */
export function createSlidingWindowLimiter({ windowMs, max }) {
  /** @type {Map<string, { t: number, w: number }[]>} */
  const hitsByKey = new Map();

  function prune(key, now) {
    const hits = (hitsByKey.get(key) ?? []).filter((h) => now - h.t < windowMs);
    hitsByKey.set(key, hits);
    return hits;
  }

  function sumWeights(hits) {
    let total = 0;
    for (const h of hits) total += h.w;
    return total;
  }

  return {
    /**
     * Alleen lezen: telt niets, geeft aan of `key` nu al over de limiet zit
     * (som van de gewichten binnen het venster — bij het standaardgewicht 1
     * per hit is dit gewoon een aantalstelling, zoals voorheen).
     * @param {string} key
     * @param {number} [now]
     */
    isLimited(key, now = Date.now()) {
      return sumWeights(prune(key, now)) >= max;
    },
    /**
     * Alleen lezen: true als het TOEVOEGEN van `weight` nu de limiet zou
     * overschrijden, zonder zelf iets te registreren. Bedoeld als
     * pre-check vóór een dure/onomkeerbare actie (een Groq-aanroep) — zie
     * de token-bewuste limiter in kenniscentrum-chat.ts.
     * @param {string} key
     * @param {number} weight
     * @param {number} [now]
     */
    wouldExceed(key, weight, now = Date.now()) {
      return sumWeights(prune(key, now)) + weight > max;
    },
    /**
     * Registreert één treffer voor `key` op tijdstip `now`, met een
     * optioneel gewicht (standaard 1 — een gewone requesttelling).
     * @param {string} key
     * @param {number} [now]
     * @param {number} [weight]
     */
    record(key, now = Date.now(), weight = 1) {
      const hits = prune(key, now);
      hits.push({ t: now, w: weight });
      hitsByKey.set(key, hits);
    },
    /**
     * Huidig verbruik (som van gewichten) binnen het venster — puur voor
     * diagnose/logging, telt zelf niets.
     * @param {string} key
     * @param {number} [now]
     */
    usage(key, now = Date.now()) {
      return sumWeights(prune(key, now));
    },
  };
}
