import { z } from 'zod';
import { VISIBILITIES } from './visibility.ts';

/** A recipe in the trash (spec §3.2), as its list shows it to someone who may restore it. */
export const trashedRecipeSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    visibility: z.enum(VISIBILITIES),
    owner: z.object({ id: z.string(), name: z.string() }),
    deletedAt: z.iso.datetime(),
    purgeAt: z.iso
      .datetime()
      .describe(
        'When it’s deleted for good, unless it’s restored first. The purge runs once a day, so it may stay up to a day longer.',
      ),
    version: z.number().int().describe('The version to send in `If-Match` to restore it.'),
  })
  .meta({ id: 'TrashedRecipe' });

export type TrashedRecipe = z.infer<typeof trashedRecipeSchema>;

export const trashListSchema = z
  .object({
    recipes: z.array(trashedRecipeSchema).describe('Most recently deleted first.'),
    retentionDays: z
      .number()
      .int()
      .describe('How many days a deleted recipe stays in the trash before it’s deleted for good.'),
  })
  .meta({ id: 'TrashList' });

export type TrashList = z.infer<typeof trashListSchema>;
