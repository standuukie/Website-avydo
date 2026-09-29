// Providerneutrale, framework-onafhankelijke sliding-window rate limiter.
// Bewust een los, plain .mjs-bestand (zelfde patroon als knowledge-match.mjs)
// zodat de eigenlijke limiter-logica rechtstreeks door Node's ingebouwde
// testrunner getest kan worden (`npm run kenniscentrum:test`,
// scripts/kenniscentrum/rate-limit.test.mjs) — inclusief het tijdvenster
// zelf, via de optionele `now`-parameter, zonder dat een test echt hoeft te
// wachten. Gebruikt in src/pages/api/kenniscentrum-chat.ts voor zowel de
// globale (site-brede) als de per-IP limiet.
//
// Puur in-memory, geen permanente opslag: de hits leven alleen zolang de
// serverless-instance warm is.

/**
 * @param {{ windowMs: number, max: number }} opts
 */
export function createSlidingWindowLimiter({ windowMs, max }) {
  /** @type {Map<string, number[]>} */
  const hitsByKey = new Map();

  function prune(key, now) {
    const hits = (hitsByKey.get(key) ?? []).filter((t) => now - t < windowMs);
    hitsByKey.set(key, hits);
    return hits;
  }

  return {
    /**
     * Alleen lezen: telt niets, geeft aan of `key` nu al over de limiet zit.
     * @param {string} key
     * @param {number} [now]
     */
    isLimited(key, now = Date.now()) {
      return prune(key, now).length >= max;
    },
    /**
     * Registreert één treffer voor `key` op tijdstip `now`.
     * @param {string} key
     * @param {number} [now]
     */
    record(key, now = Date.now()) {
      const hits = prune(key, now);
      hits.push(now);
      hitsByKey.set(key, hits);
    },
  };
}
