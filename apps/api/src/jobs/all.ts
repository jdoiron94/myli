import { passwordResetEmailJob } from '../account/password-reset.ts';
import { emailVerificationJob } from '../account/verification.ts';
import { backupJob } from '../backups/backup.ts';
import { deleteBlobsJob, discardUnsavedImageJob } from '../images/images.ts';
import { sweepUnusedImagesJob } from '../images/sweep.ts';
import { invitationEmailJob } from '../invitations/invitations.ts';
import { indexRecipeJob } from '../search/indexing.ts';
import { reindexRecipesJob } from '../search/reindex.ts';
import { purgeTrashJob } from '../trash/purge.ts';
import type { JobDefinition } from './define.ts';

/** Every job type the worker runs. Add each new `defineJob(…)` here. */
export const allJobs: readonly JobDefinition[] = [
  invitationEmailJob,
  emailVerificationJob,
  passwordResetEmailJob,
  indexRecipeJob,
  reindexRecipesJob,
  discardUnsavedImageJob,
  deleteBlobsJob,
  purgeTrashJob,
  sweepUnusedImagesJob,
  backupJob,
];
