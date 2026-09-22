import { defineCollection, z } from 'astro:content';

export const categories = [
  'Belastingen',
  'Accountancy',
  'Personeel & loon',
  'Ondernemen',
  'Wet- en regelgeving',
  'Subsidies',
  'Financiën',
] as const;

export const priorities = ['belangrijk', 'actueel', 'praktisch'] as const;

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
    featured: z.boolean().default(false),
    hidden: z.boolean().default(false),
    aiAssisted: z.boolean().default(false),
    fetchedAt: z.date().optional(),
  }),
});

export const collections = { kenniscentrum };
