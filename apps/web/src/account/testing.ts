import type { UnitSystem } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import { apiServer } from '@/testing.ts';

/** Answers GET /me/preferences with this unit system, for pages that show amounts. */
export function answerPreferences(unitSystem: UnitSystem = 'imperial') {
  apiServer.use(
    http.get('/api/v1/me/preferences', () => HttpResponse.json({ preferences: { unitSystem } })),
  );
}
