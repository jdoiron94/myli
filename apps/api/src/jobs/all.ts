import { invitationEmailJob } from '../invitations/invitations.ts';
import { indexRecipeJob } from '../search/indexing.ts';
import { reindexRecipesJob } from '../search/reindex.ts';
import type { JobDefinition } from './define.ts';

/** Every job type the worker runs. Add each new `defineJob(…)` here. */
export const allJobs: readonly JobDefinition[] = [
  invitationEmailJob,
  indexRecipeJob,
  reindexRecipesJob,
];
