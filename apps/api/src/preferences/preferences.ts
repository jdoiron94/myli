import { DEFAULT_PREFERENCES, type UserPreferences } from '@myli/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { userPreference } from '../db/schema.ts';

/** A user's display preferences, or the defaults until they choose. */
export function getPreferences(db: Db, userId: string): UserPreferences {
  const row = db
    .select({ unitSystem: userPreference.unitSystem })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .get();
  return row ?? DEFAULT_PREFERENCES;
}

/** Replaces a user's display preferences. */
export function savePreferences(db: Db, userId: string, preferences: UserPreferences): void {
  db.insert(userPreference)
    .values({ userId, ...preferences })
    .onConflictDoUpdate({
      target: userPreference.userId,
      // `$onUpdate` only runs for updates, not for this.
      set: { ...preferences, updatedAt: new Date() },
    })
    .run();
}
