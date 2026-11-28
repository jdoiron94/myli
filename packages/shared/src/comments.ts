import { z } from 'zod';
import { personSchema } from './user.ts';

/** The longest a comment may be, in characters. */
export const COMMENT_MAX_LENGTH = 5_000;

/** What a comment says, written or changed by its author. */
export const commentRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Write the comment.')
      .max(COMMENT_MAX_LENGTH, `Keep it to ${String(COMMENT_MAX_LENGTH)} characters.`)
      .describe('Markdown (ADR 0006).'),
  })
  .meta({ id: 'CommentRequest' });

export type CommentRequest = z.infer<typeof commentRequestSchema>;

/** One comment on a recipe (spec §3.2). */
export const commentSchema = z
  .object({
    id: z.string(),
    author: personSchema,
    body: z.string().describe('Markdown (ADR 0006).'),
    createdAt: z.iso.datetime(),
    editedAt: z.iso
      .datetime()
      .nullable()
      .describe('When its author last changed it. `null` if they never have.'),
  })
  .meta({ id: 'Comment' });

export type Comment = z.infer<typeof commentSchema>;

export const commentListSchema = z
  .object({ comments: z.array(commentSchema).describe('Oldest first, as a conversation reads.') })
  .meta({ id: 'CommentList' });

export type CommentList = z.infer<typeof commentListSchema>;

export const commentIdParamsSchema = z.object({ id: z.string().min(1).max(100) });
