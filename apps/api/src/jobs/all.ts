import { invitationEmailJob } from '../invitations/invitations.ts';
import type { JobDefinition } from './define.ts';

/** Every job type the worker runs. Add each new `defineJob(…)` here. */
export const allJobs: readonly JobDefinition[] = [invitationEmailJob];
