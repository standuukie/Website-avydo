import type { CollectionEntry } from 'astro:content';

const monthsShort = [
  'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

export function formatDate(date: Date): string {
  return `${date.getDate()} ${monthsShort[date.getMonth()]} ${date.getFullYear()}`;
}

// Weergavenamen voor de doelgroepen. Moet gelijk blijven aan
// audienceLabels in scripts/kenniscentrum/sources.config.mjs (de
// nieuwsengine kent dezelfde sleutels toe aan artikelen op basis van
// trefwoorden, zie pickAudiences in fetch-articles.mjs).
export const audienceOptions = [
  { value: 'zzp', label: "ZZP'er" },
  { value: 'bv-dga', label: 'BV / DGA' },
  { value: 'werkgever', label: 'Werkgever' },
  { value: 'starter', label: 'Starter' },
  { value: 'mkb-ondernemer', label: 'MKB-ondernemer' },
] as const;

export const audienceLabels: Record<string, string> = Object.fromEntries(
  audienceOptions.map((o) => [o.value, o.label]),
);

type Article = CollectionEntry<'kenniscentrum'>;

const PRIORITY_WEIGHT: Record<string, number> = { belangrijk: 2, actueel: 1, praktisch: 0 };

/**
 * Selecteert een klein aantal artikelen voor de "Belangrijk voor
 * ondernemers"-sectie, puur op basis van bestaande metadata (priority,
 * publicatiedatum, categorie, bron) — geen nieuw geraden of verzonnen
 * belang. Prioriteit gaat naar priority="belangrijk" en recente artikelen;
 * daarna wordt gespreid over categorieën en bronnen zodat de sectie niet
 * door één onderwerp of bron gedomineerd wordt. Verandert vanzelf mee
 * zodra de nieuwsengine nieuwe artikelen toevoegt.
 */
export function pickHighlighted(articles: Article[], limit = 4): Article[] {
  const sorted = [...articles].sort((a, b) => {
    // Handmatig gemarkeerde artikelen (featured: true) gaan altijd voor —
    // dat is een expliciet redactioneel signaal, geen verzonnen relevantie.
    const featuredDiff = Number(b.data.featured) - Number(a.data.featured);
    if (featuredDiff !== 0) return featuredDiff;
    const weightDiff = (PRIORITY_WEIGHT[b.data.priority] ?? 0) - (PRIORITY_WEIGHT[a.data.priority] ?? 0);
    if (weightDiff !== 0) return weightDiff;
    return b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf();
  });

  const picked: Article[] = [];
  const perCategory = new Map<string, number>();
  const perSource = new Map<string, number>();

  for (const article of sorted) {
    if (picked.length >= limit) break;
    const cat = article.data.category;
    const src = article.data.sourceName;
    if ((perCategory.get(cat) ?? 0) >= 2 || (perSource.get(src) ?? 0) >= 2) continue;
    picked.push(article);
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
    perSource.set(src, (perSource.get(src) ?? 0) + 1);
  }

  // Vul aan zonder spreidingslimiet als er nog plek over is, zodat de
  // sectie nooit korter is dan nodig puur door gebrek aan variatie.
  if (picked.length < limit) {
    for (const article of sorted) {
      if (picked.length >= limit) break;
      if (!picked.includes(article)) picked.push(article);
    }
  }

  return picked;
}
