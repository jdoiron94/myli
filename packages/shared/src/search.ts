import { z } from 'zod';

/**
 * Where the latest rebuild of the search index stands: waiting for its turn, under way, waiting to
 * try again after a failed attempt (as while search is unavailable), done, or given up on.
 */
export const REBUILD_STATES = ['queued', 'running', 'retrying', 'succeeded', 'failed'] as const;

export type RebuildState = (typeof REBUILD_STATES)[number];

export const searchIndexStatusSchema = z
  .object({
    available: z.boolean().describe('Whether search works right now.'),
    rebuild: z
      .object({
        state: z.enum(REBUILD_STATES),
        queuedAt: z.iso.datetime().describe('When the rebuild was asked for.'),
      })
      .nullable()
      .describe('The latest rebuild, or null if there has been none.'),
  })
  .meta({ id: 'SearchIndexStatus' });

export type SearchIndexStatus = z.infer<typeof searchIndexStatusSchema>;
