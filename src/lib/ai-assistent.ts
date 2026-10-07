// Retrieval-laag voor de Kenniscentrum-AI-assistent: zoekt relevante
// context in de BESTAANDE contentstructuur (Avydo AI-kennisbank,
// Kenniscentrum-artikelen, Belastingkalender-dataset, Avydo-
// bedrijfsgegevens) op basis van eenvoudige trefwoord-overlap. Geen aparte
// nieuwsdatabase, geen vectordatabase — dit is een lichte, RAG-achtige
// aanpak die past bij de omvang van de bestaande content.
//
// Het resultaat van retrieveContext() is de ENIGE informatie die het
// taalmodel mag gebruiken om feitelijke uitspraken op te baseren (zie de
// systeemprompt in de API-route). Elke bron in de lijst heeft een echte,
// al bestaande URL — er wordt hier niets verzonnen of samengesteld.
import { getCollection } from 'astro:content';
import { knowledgeBase } from '@/data/ai-knowledge';
import { taxDeadlines } from '@/data/belastingkalender';
import { company } from '@/data/company';
import { MIN_RELEVANCE_SCORE, overlapScore, retrieveKnowledgeItems, retrieveKnowledgeItemsWithContext, tokenize } from './knowledge-match.mjs';
import { formatSourcesForPrompt as formatSourcesWithFreshness, rankScoredArticles, substituteExplicitSuccessors } from './source-freshness.mjs';
import { articleContextSnippet } from './article-context.mjs';

export interface RetrievedSource {
  id: number;
  name: string;
  title: string;
  url: string;
  snippet: string;
  /** Alleen bij Kenniscentrum-artikelen: getoond aan het model (zie source-freshness.mjs). */
  publishedAt?: Date;
  /** Alleen bij Kenniscentrum-artikelen: true als het artikel een (handmatig gezette) `supersededBy` heeft. */
  superseded?: boolean;
}

// Verlaagd (2026-09-29, ronde 3) van 4/3 naar 2/2: Kenniscentrum-artikelen
// en Belastingkalender-deadlines zijn de meest speculatieve, minst curated
// brontypes — het minst essentieel voor een gewone definitie-/
// personeel-/verzekeringenvraag, en de grootste bijdrage aan zowel
// onnodig tokengebruik (elk verzoek naar Groq telt mee voor Groq's eigen
// tokens-per-minuut-limiet) als het risico dat een toevallig meegekomen,
// eigenlijk niet-relevante bron in het antwoord doorsijpelt (zie het
// "zakelijke rekening"-in-een-verzekeringenantwoord-incident). De
// kern-kennisbank (MAX_KNOWLEDGE_SOURCES) blijft ongewijzigd: die is al
// strak gedrempeld via MIN_RELEVANCE_SCORE en typisch het beste
// onderbouwde brontype.
const MAX_ARTICLE_SOURCES = 2;
const MAX_DEADLINE_SOURCES = 2;
// Verlaagd (ronde 4) van 3 naar 2: een simulatie tegen de echte kennisbank
// liet zien dat 3 volledige kennisitems bij een vraag als "wat moet ik
// regelen als ik personeel aanneem?" al 700+ tokens kostten — een
// aanzienlijk deel van het TPM-budget voor precies het brontype dat het
// vaakst wordt opgehaald. 2 goed-gedrempelde items (via MIN_RELEVANCE_SCORE)
// zijn voor een gewone vraag ruim voldoende zonder onnodig tokengebruik.
const MAX_KNOWLEDGE_SOURCES = 2;
const STALE_DEADLINE_DAYS = 400;

export interface RetrieveOptions {
  /** Slug van een specifiek Kenniscentrum-artikel dat als vaste context moet worden meegenomen (bv. vanaf een artikelpagina). */
  pinnedArticleSlug?: string;
  /**
   * Eerdere vragen van de bezoeker in dit gesprek (oud → nieuw), uitsluitend
   * gebruikt voor de Avydo-kennisbank (zie retrieveKnowledgeItemsWithContext
   * in knowledge-match.mjs) om een vervolgvraag met een verwijswoord ("die",
   * "erin", "daar", ...) correct te koppelen aan het onderwerp van de
   * LAATSTE voorgaande vraag — nooit het hele gesprek, en nooit ten koste
   * van een reeds ondubbelzinnige huidige vraag (zie de toelichting in
   * knowledge-match.mjs). Optioneel: zonder deze parameter is het gedrag
   * exact gelijk aan voorheen (retrieveKnowledgeItems op `query` alleen).
   */
  previousUserMessages?: string[];
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
        publishedAt: pinned.data.publishedAt,
        superseded: Boolean(pinned.data.supersededBy),
      });
    }
  }

  // Avydo AI-kennisbank (src/data/ai-knowledge/): algemene, gecontroleerde
  // kennisitems over ondernemen/belastingen/accountancy. Vóór de losse
  // Kenniscentrum-artikelen gezet omdat curated, evergreen uitleg voor een
  // "wat is..."-vraag doorgaans een betrouwbaardere basis is dan een
  // nieuwsartikel dat toevallig dezelfde trefwoorden bevat.
  const knowledgeMatches = opts.previousUserMessages
    ? retrieveKnowledgeItemsWithContext(query, opts.previousUserMessages, knowledgeBase, { maxItems: MAX_KNOWLEDGE_SOURCES })
    : retrieveKnowledgeItems(query, knowledgeBase, { maxItems: MAX_KNOWLEDGE_SOURCES });
  for (const item of knowledgeMatches) {
    sources.push({
      id: nextId++,
      name: `Avydo kennisbank (bron: ${item.sourceName})`,
      title: item.title,
      url: item.sourceUrl,
      snippet: item.content,
    });
  }

  // MIN_RELEVANCE_SCORE (zelfde drempel als bij de kennisbank): sinds de
  // retrieval-query ook eerdere gespreksvragen meeweegt (zie
  // buildRetrievalQuery() in kenniscentrum-chat.ts, nodig voor
  // vervolgvragen), bevat de query meer tekst en dus meer kans op een
  // toevallige, inhoudsloze woordovereenkomst met een verder onrelevant
  // nieuwsartikel — bijvoorbeeld een artikel dat het woord "btw" bevat maar
  // niets met de gestelde vraag te maken heeft. Eén losse treffer (score 1)
  // is daarom niet meer genoeg om een artikel als bron mee te geven.
  // Volgorde: zie rankScoredArticles (source-freshness.mjs) — de score zelf is
  // ongewijzigd; alleen een handmatig gezette `supersededBy` geeft een
  // opgevolgd artikel lagere voorrang. Geen recentheidsbonus.
  const candidateArticles = allArticles.filter((a) => !opts.pinnedArticleSlug || a.slug !== opts.pinnedArticleSlug);
  const scoredArticles = rankScoredArticles(
    candidateArticles
      .map((article) => ({
        article,
        score: overlapScore(
          queryTokens,
          `${article.data.title} ${article.data.summary} ${article.data.category} ${article.data.tags.join(' ')}`,
        ),
        publishedAt: article.data.publishedAt,
        sourceUrl: article.data.sourceUrl,
        supersededBy: article.data.supersededBy,
      }))
      .filter((x) => x.score >= MIN_RELEVANCE_SCORE),
  ).slice(0, MAX_ARTICLE_SOURCES);

  // Ná de topselectie, vóór het bronfragment: een gekozen artikel met een
  // expliciet gezette `supersededBy` wordt vervangen door die opvolger
  // (exacte sourceUrl, nog niet gekozen). Geen scorewijziging; artikelen
  // zonder `supersededBy` blijven altijd staan. Zie source-freshness.mjs.
  const toSuccessionCandidate = (article: (typeof allArticles)[number]) => ({
    article,
    sourceUrl: article.data.sourceUrl,
    supersededBy: article.data.supersededBy,
  });
  const selectedArticles = substituteExplicitSuccessors(
    scoredArticles.map(({ article }) => toSuccessionCandidate(article)),
    candidateArticles.map(toSuccessionCandidate),
  );

  for (const { article } of selectedArticles) {
    sources.push({
      id: nextId++,
      name: `Kenniscentrum Avydo (bron: ${article.data.sourceName})`,
      title: article.data.title,
      url: article.data.sourceUrl,
      // Pas NA de selectie hierboven: welke tekst van dit gekozen artikel
      // het model ziet (Rijksoverheid: hoofdtekst, max. 1.200 tekens;
      // anders ongewijzigd summary + relevance). Zie article-context.mjs.
      snippet: articleContextSnippet({
        sourceName: article.data.sourceName,
        summary: article.data.summary,
        relevance: article.data.relevance,
        body: article.body,
      }),
      publishedAt: article.data.publishedAt,
      superseded: Boolean(article.data.supersededBy),
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
    .filter((x) => x.score >= MIN_RELEVANCE_SCORE)
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

// Toont bij Kenniscentrum-artikelen de publicatiedatum (en "historisch" bij
// een opgevolgd artikel); overige bronnen ongewijzigd. Zie source-freshness.mjs.
export function formatSourcesForPrompt(sources: RetrievedSource[]): string {
  return formatSourcesWithFreshness(sources);
}
