import { z } from 'zod';

/**
 * Who can see a recipe (spec §3.1). `private`: the owner only. `shared`: every signed-in user.
 * A public link is an add-on to a shared recipe, not a visibility level.
 */
export const VISIBILITIES = ['private', 'shared'] as const;

export const visibilitySchema = z.enum(VISIBILITIES).meta({ id: 'Visibility' });

export type Visibility = z.infer<typeof visibilitySchema>;
