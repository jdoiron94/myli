import { z } from 'zod';

/** The longest a personal note may be, in characters. */
export const NOTE_MAX_LENGTH = 10_000;

/** What `PUT /recipes/{id}/note` sets: the caller's note on the recipe. */
export const noteRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Write the note.')
      .max(NOTE_MAX_LENGTH, `Keep it to ${String(NOTE_MAX_LENGTH)} characters.`)
      .describe('Markdown (ADR 0006).'),
  })
  .meta({ id: 'NoteRequest' });

export type NoteRequest = z.infer<typeof noteRequestSchema>;

/** A personal note on a recipe (spec §3.3), which only its writer ever sees. */
export const noteSchema = z
  .object({
    body: z.string().describe('Markdown (ADR 0006).'),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Note' });

export type Note = z.infer<typeof noteSchema>;

/** The caller's note on a recipe, if they have one. */
export const recipeNoteSchema = z
  .object({
    // A union rather than `.nullable()`, which would inline the note instead of naming it.
    note: z.union([noteSchema, z.null()]).describe('`null` when there is none.'),
  })
  .meta({ id: 'RecipeNote' });

export type RecipeNote = z.infer<typeof recipeNoteSchema>;

/** The note as just saved. */
export const savedNoteSchema = z.object({ note: noteSchema }).meta({ id: 'SavedNote' });

export type SavedNote = z.infer<typeof savedNoteSchema>;
