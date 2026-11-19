import { z } from 'zod';

/**
 * Whether a recipe is one of the caller's favorites (spec §3.3): what `PUT /recipes/{id}/favorite`
 * sets, and what it and `GET` answer.
 */
export const favoriteSchema = z.object({ favorite: z.boolean() }).meta({ id: 'Favorite' });

export type Favorite = z.infer<typeof favoriteSchema>;
