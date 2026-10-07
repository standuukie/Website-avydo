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
    // Optioneel, redactioneel: nieuws of naslag (evergreen uitleg). Zonder
    // dit veld zijn KVK-kennisartikelen naslag en is de rest nieuws; zie
    // isReferenceArticle in src/lib/news-presentation.mjs. Alleen weergave.
    contentType: z.enum(['nieuws', 'naslag']).optional(),
    // Optioneel, redactioneel: de fase van het bericht, als badge getoond
    // (STATUS_LABELS in src/lib/news-presentation.mjs). Afwezig = geen badge.
    status: z.enum(['voorstel', 'consultatie', 'voornemen', 'historisch', 'herzien', 'deels-geschrapt']).optional(),
  }),
});

export const collections = { kenniscentrum };
