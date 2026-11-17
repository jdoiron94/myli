import { preferencesResultSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userPreference } from '../db/schema.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

afterEach(() => {
  vi.useRealTimers();
});

function send(t: TestApp, method: string, cookie?: string, body?: unknown) {
  return t.app.request('/api/v1/me/preferences', {
    method,
    headers: {
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function preferencesOf(t: TestApp, cookie: string) {
  const res = await send(t, 'GET', cookie);
  expect(res.status).toBe(200);
  return preferencesResultSchema.parse(await res.json()).preferences;
}

describe('/me/preferences', () => {
  it('starts at the defaults: imperial', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    expect(await preferencesOf(t, cookie)).toEqual({ unitSystem: 'imperial' });
    expect(t.db.select().from(userPreference).all()).toEqual([]);
  });

  it('saves a choice, which is the user’s alone', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    const other = await signedInAs(t, 'editor');

    const res = await send(t, 'PUT', cookie, { unitSystem: 'metric' });
    expect(res.status).toBe(200);
    expect(preferencesResultSchema.parse(await res.json()).preferences).toEqual({
      unitSystem: 'metric',
    });
    expect(await preferencesOf(t, cookie)).toEqual({ unitSystem: 'metric' });
    expect(await preferencesOf(t, other.cookie)).toEqual({ unitSystem: 'imperial' });
  });

  it('changes a saved choice, and when', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T10:00:00Z') });
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    await send(t, 'PUT', cookie, { unitSystem: 'metric' });
    vi.setSystemTime(new Date('2026-11-16T11:00:00Z'));

    await send(t, 'PUT', cookie, { unitSystem: 'imperial' });

    expect(await preferencesOf(t, cookie)).toEqual({ unitSystem: 'imperial' });
    const rows = t.db.select().from(userPreference).where(eq(userPreference.userId, user.id)).all();
    expect(rows).toEqual([
      { userId: user.id, unitSystem: 'imperial', updatedAt: new Date('2026-11-16T11:00:00Z') },
    ]);
  });

  it('lets viewers choose: it changes only what they see', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'viewer');
    expect((await send(t, 'PUT', cookie, { unitSystem: 'metric' })).status).toBe(200);
    expect(await preferencesOf(t, cookie)).toEqual({ unitSystem: 'metric' });
  });

  it('refuses a unit system that doesn’t exist, or none', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    expect((await send(t, 'PUT', cookie, { unitSystem: 'cubits' })).status).toBe(422);
    expect((await send(t, 'PUT', cookie, {})).status).toBe(422);
    expect(await preferencesOf(t, cookie)).toEqual({ unitSystem: 'imperial' });
  });

  it('needs someone signed in', async () => {
    const t = createTestApp();
    expect((await send(t, 'GET')).status).toBe(401);
    expect((await send(t, 'PUT', undefined, { unitSystem: 'metric' })).status).toBe(401);
  });

  it('refuses a unit system the CHECK constraint doesn’t know, written straight to the table', async () => {
    const t = createTestApp();
    const { user } = await signedInAs(t, 'editor');
    expect(() =>
      t.db.$client
        .prepare(
          "insert into user_preference (user_id, unit_system, updated_at) values (?, 'cubits', 0)",
        )
        .run(user.id),
    ).toThrow(/CHECK constraint failed/);
  });
});
