import { defineCollection, z } from 'astro:content';

export const categories = [
  'Belastingen',
  'Accountancy',
  'Personeel & loon',
  'Ondernemen',
  'Wet- en regelgeving',
  'Subsidies',
  'Financiën',
  'Digitalisering',
  'Duurzaamheid',
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
  }),
});

export const collections = { kenniscentrum };
