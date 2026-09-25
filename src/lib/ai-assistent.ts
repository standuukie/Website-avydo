// Retrieval-laag voor de Kenniscentrum-AI-assistent: zoekt relevante
// context in de BESTAANDE contentstructuur (Kenniscentrum-artikelen,
// Belastingkalender-dataset, Avydo-bedrijfsgegevens) op basis van
// eenvoudige trefwoord-overlap. Geen aparte nieuwsdatabase, geen
// vectordatabase — dit is een lichte, RAG-achtige aanpak die past bij de
// omvang van de bestaande content (enkele tientallen artikelen).
//
// Het resultaat van retrieveContext() is de ENIGE informatie die het
// taalmodel mag gebruiken om feitelijke uitspraken op te baseren (zie de
// systeemprompt in de API-route). Elke bron in de lijst heeft een echte,
// al bestaande URL — er wordt hier niets verzonnen of samengesteld.
import { getCollection } from 'astro:content';
import { taxDeadlines } from '@/data/belastingkalender';
import { company } from '@/data/company';

export interface RetrievedSource {
  id: number;
  name: string;
  title: string;
  url: string;
  snippet: string;
}

const STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'van', 'voor', 'op', 'in', 'is', 'wat', 'hoe', 'wanneer',
  'moet', 'ik', 'mijn', 'als', 'dat', 'die', 'met', 'te', 'aan', 'of', 'dit', 'naar',
  'uw', 'u', 'kan', 'kun', 'ben', 'zijn', 'er', 'bij', 'ook', 'om', 'nog', 'wel', 'niet',
  'wij', 'we', 'jij', 'je', 'me', 'mij', 'over', 'per', 'tot', 'zo', 'maar', 'dan', 'nu',
]);

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return (normalized.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlapScore(queryTokens: string[], text: string): number {
  const tokens = new Set(tokenize(text));
  let score = 0;
  for (const q of queryTokens) if (tokens.has(q)) score += 1;
  return score;
}

const MAX_ARTICLE_SOURCES = 4;
const MAX_DEADLINE_SOURCES = 3;
const STALE_DEADLINE_DAYS = 400;

export interface RetrieveOptions {
  /** Slug van een specifiek Kenniscentrum-artikel dat als vaste context moet worden meegenomen (bv. vanaf een artikelpagina). */
  pinnedArticleSlug?: string;
}

export async function retrieveContext(query: string, opts: RetrieveOptions = {}): Promise<RetrievedSource[]> {
  const queryTokens = tokenize(query);
  const sources: RetrievedSource[] = [];
  let nextId = 1;

  const allArticles = await getCollection('kenniscentrum', ({ data }) => !data.hidden);

  if (opts.pinnedArticleSlug) {
    const pinned = allArticles.find((a) => a.slug === opts.pinnedArticleSlug);
    if (pinned) {
      sources.push({
        id: nextId++,
        name: `Kenniscentrum Avydo (bron: ${pinned.data.sourceName})`,
        title: pinned.data.title,
        url: pinned.data.sourceUrl,
        snippet: `${pinned.data.summary} ${pinned.data.relevance}`.slice(0, 700),
      });
    }
  }

  const scoredArticles = allArticles
    .filter((a) => !opts.pinnedArticleSlug || a.slug !== opts.pinnedArticleSlug)
    .map((article) => ({
      article,
      score: overlapScore(
        queryTokens,
        `${article.data.title} ${article.data.summary} ${article.data.category} ${article.data.tags.join(' ')}`,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.article.data.publishedAt.valueOf() - a.article.data.publishedAt.valueOf())
    .slice(0, MAX_ARTICLE_SOURCES);

  for (const { article } of scoredArticles) {
    sources.push({
      id: nextId++,
      name: `Kenniscentrum Avydo (bron: ${article.data.sourceName})`,
      title: article.data.title,
      url: article.data.sourceUrl,
      snippet: `${article.data.summary} ${article.data.relevance}`.slice(0, 500),
    });
  }

  const now = Date.now();
  // Veel deadline-entries (bv. elke maandelijkse btw-aangifte) hebben
  // vrijwel identieke titel/omschrijving en scoren dus gelijk op
  // trefwoord-overlap. Bij gelijke score geeft dit de voorkeur aan de
  // eerstvolgende (nog niet verstreken) deadline boven een allang
  // verstreken periode — anders zou de gebruiker bij "wanneer moet ik
  // btw-aangifte doen" een datum uit het verleden als antwoord krijgen.
  function recencyRank(deadline: (typeof taxDeadlines)[number]): number {
    if (!deadline.deadline) return 0;
    const diffDays = (new Date(deadline.deadline).getTime() - now) / 86_400_000;
    return diffDays >= 0 ? 100_000 - diffDays : diffDays;
  }

  const scoredDeadlines = taxDeadlines
    .filter((d) => (now - new Date(d.lastVerified).getTime()) / 86_400_000 <= STALE_DEADLINE_DAYS)
    .map((deadline) => ({
      deadline,
      score: overlapScore(queryTokens, `${deadline.title} ${deadline.description} ${deadline.taxType} ${deadline.period}`),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || recencyRank(b.deadline) - recencyRank(a.deadline))
    .slice(0, MAX_DEADLINE_SOURCES);

  for (const { deadline } of scoredDeadlines) {
    sources.push({
      id: nextId++,
      name: deadline.sourceName,
      title: deadline.title,
      url: deadline.sourceUrl,
      snippet: `${deadline.description} Uiterste datum: ${deadline.deadline ?? 'geen vaste kalenderdatum, zie omschrijving'}. Voor wie: ${deadline.forWhom}. Gecontroleerd op ${deadline.lastVerified}.`,
    });
  }

  // Algemene Avydo-contactinformatie, alleen relevant bij vragen die
  // daadwerkelijk over Avydo of contact opnemen lijken te gaan.
  if (overlapScore(queryTokens, 'avydo contact afspraak accountant adviseur kantoor bellen mailen') > 0) {
    sources.push({
      id: nextId++,
      name: 'Avydo',
      title: `Contact ${company.name}`,
      url: 'https://www.avydo.nl/contact',
      snippet: `${company.name} is een accountantskantoor in ${company.address.city}. Telefoon: ${company.phone}, e-mail: ${company.email}.`,
    });
  }

  return sources;
}

export function formatSourcesForPrompt(sources: RetrievedSource[]): string {
  if (sources.length === 0) return '(Geen relevante bronnen gevonden in het Kenniscentrum, de Belastingkalender of Avydo-informatie voor deze vraag.)';
  return sources
    .map((s) => `[${s.id}] ${s.name} — "${s.title}"\n${s.snippet}`)
    .join('\n\n');
}
