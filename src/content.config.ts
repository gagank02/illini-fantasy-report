import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Weekly reports: src/content/reports/{season}/week-{n}.md → /reports/{season}/week-{n}
const reports = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reports' }),
  schema: z.object({
    headline: z.string(),
    lede: z.string(),
    season: z.number(),
    week: z.number(),
    date: z.coerce.date(),
  }),
});

export const collections = { reports };
