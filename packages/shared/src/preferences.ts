import { z } from 'zod';
import { DEFAULT_UNIT_SYSTEM, unitSystemSchema } from './units.ts';

/**
 * A user's own display preferences, which follow them from device to device. Every role has them:
 * they change what someone sees, never what anyone else does. The theme isn't one: it's chosen per
 * browser (spec §6).
 */
export const userPreferencesSchema = z
  .object({
    unitSystem: unitSystemSchema.describe(
      'How recipes show quantities. `imperial` is the US customary measures.',
    ),
  })
  .meta({ id: 'UserPreferences' });

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/** What someone who hasn't chosen anything sees. */
export const DEFAULT_PREFERENCES: UserPreferences = { unitSystem: DEFAULT_UNIT_SYSTEM };

export const preferencesResultSchema = z
  .object({ preferences: userPreferencesSchema })
  .meta({ id: 'PreferencesResult' });
