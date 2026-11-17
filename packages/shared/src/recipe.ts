import { z } from 'zod';

/** How hard a recipe is (spec §3.2). Optional on each recipe. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export const difficultySchema = z.enum(DIFFICULTIES).meta({ id: 'Difficulty' });

export type Difficulty = z.infer<typeof difficultySchema>;
