import { defineCollection, z } from 'astro:content';

// Categorie-indeling (2026-10-01, redactionele aanscherping): gericht op de
// kernexpertise van een accountants- en belastingadvieskantoor, i.p.v. de
// eerdere brede "algemeen ondernemersnieuws"-indeling. Zie
// scripts/kenniscentrum/sources.config.mjs voor de bijbehorende, eveneens
// aangescherpte bronfiltering.
export const categories = [
  'Fiscale actualiteit',
  'Inkomstenbelasting',
  'Btw',
  'BV & DGA',
  'Vennootschapsbelasting',
  'Personeel & loonheffingen',
  'Administratie & jaarrekening',
  'Ondernemen & rechtsvormen',
] as const;

export const priorities = ['belangrijk', 'actueel', 'praktisch'] as const;

// Doelgroepen, afgeleid door de nieuwsengine op basis van trefwoorden in de
// titel/samenvatting van een artikel (zie scripts/kenniscentrum/sources.config.mjs,
// audienceKeywords) — nooit handmatig geraden. Een artikel kan meerdere
// doelgroepen hebben, of geen enkele als er geen duidelijke match is.
export const audiences = ['zzp', 'bv-dga', 'werkgever', 'starter', 'mkb-ondernemer'] as const;

export const articleStatuses = ['voorstel', 'consultatie', 'voornemen', 'aangenomen', 'van-kracht', 'historisch', 'herzien', 'deels-geschrapt'] as const;

const kenniscentrum = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    category: z.enum(categories),
    priority: z.enum(priorities).default('praktisch'),
    publishedAt: z.date(),
    updatedAt: z.date().optional(),
    sourceName: z.string(),
    sourceUrl: z.string().url(),
    summary: z.string(),
    relevance: z.string(),
    tags: z.array(z.string()).default([]),
    audiences: z.array(z.enum(audiences)).default([]),
    featured: z.boolean().default(false),
    hidden: z.boolean().default(false),
    aiAssisted: z.boolean().default(false),
    fetchedAt: z.date().optional(),
    // Optioneel, uitsluitend handmatig/redactioneel gezet: de sourceUrl van
    // het artikel dat dit artikel inhoudelijk heeft opgevolgd. Afwezig =
    // normaal/current. Het artikel blijft bestaan; retrieval geeft het alleen
    // lagere voorrang (zie src/lib/source-freshness.mjs). Nooit automatisch.
    supersededBy: z.string().url().optional(),
    // Optioneel, redactioneel: de fase van het bericht, als badge getoond
    // (STATUS_LABELS in src/lib/news-presentation.mjs). Afwezig = geen badge.
    // 'van-kracht' = het voorstel uit het bericht is inmiddels geldende regel.
    // 'aangenomen' = door het parlement aangenomen, maar nog niet in werking.
    status: z.enum(articleStatuses).optional(),
    // Eigen Avydo-content: elk zichtbaar artikel is door Avydo geschreven op
    // basis van één officiële bron (sourceName/sourceUrl). 'toelichting' =
    // actueel nieuws of een (aangekondigde) wijziging; 'gids' = blijvend
    // geldende uitleg.
    avydoContent: z.enum(['gids', 'toelichting']).optional(),
    // Publicatiedatum van het officiële bronbericht. `publishedAt` is de
    // datum van het Avydo-artikel. Bij de in oktober 2026 omgezette
    // artikelen zijn beide gelijk (zie README, "Datums").
    sourcePublishedAt: z.date().optional(),
  }),
});

// Bronlaag: één record per officieel bronbericht (zie
// scripts/kenniscentrum/source-records.mjs). Geen pagina's; dit is de
// invoer voor de redactionele pipeline en de deduplicatie van de import.
const bronnen = defineCollection({
  type: 'data',
  schema: z.object({
    sourceUrl: z.string().url(),
    sourceName: z.string(),
    // Titel zoals de bron die gebruikt.
    title: z.string(),
    // Korte omschrijving van de bron (meta description of feedtekst).
    description: z.string().optional(),
    // Opgehaalde hoofdtekst van de bronpagina; ontbreekt als die niet
    // betrouwbaar uit te lezen was.
    body: z.string().optional(),
    sourcePublishedAt: z.coerce.date().optional(),
    sourceLastModified: z.coerce.date().optional(),
    fetchedAt: z.coerce.date().optional(),
    category: z.enum(categories).optional(),
    priority: z.enum(priorities).optional(),
    audiences: z.array(z.enum(audiences)).default([]),
    processingStatus: z.enum(['kandidaat', 'verwerkt', 'afgewezen']),
    rejectionReason: z.string().optional(),
    // Slug van het Avydo-artikel dat op deze bron is gebaseerd.
    avydoSlug: z.string().optional(),
  }),
});

export const collections = { kenniscentrum, bronnen };
