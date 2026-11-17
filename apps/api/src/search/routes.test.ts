import { searchIndexStatusSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { job } from '../db/schema.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(t: TestApp, method: 'GET' | 'POST', path: string, cookie: string) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, ...(method === 'POST' && { 'content-type': 'application/json' }) },
  });
}

async function setUp(available = true) {
  const t = createTestApp({ search: { isReady: () => Promise.resolve(available) } });
  const { cookie } = await signedInAs(t, 'admin');
  const status = async () => {
    const res = await send(t, 'GET', '/search/index', cookie);
    expect(res.status).toBe(200);
    return searchIndexStatusSchema.parse(await res.json());
  };
  const rebuild = () => send(t, 'POST', '/search/index/rebuild', cookie);
  return { t, status, rebuild };
}

const rebuilds = (t: TestApp) =>
  t.db
    .select()
    .from(job)
    .all()
    .filter(({ type }) => type === 'search.reindex');

describe('GET /search/index', () => {
  it('says whether search works, and that there has been no rebuild yet', async () => {
    expect(await (await setUp()).status()).toEqual({ available: true, rebuild: null });
    expect(await (await setUp(false)).status()).toEqual({ available: false, rebuild: null });
  });

  it('tells how the latest rebuild stands, without the error a failed one left', async () => {
    const { t, status, rebuild } = await setUp();
    await rebuild();
    const [queued] = rebuilds(t);
    if (!queued) throw new Error('nothing queued');
    const set = (values: Partial<typeof job.$inferSelect>) =>
      t.db.update(job).set(values).where(eq(job.id, queued.id)).run();
    const stateNow = async () => (await status()).rebuild?.state;

    expect(await status()).toEqual({
      available: true,
      rebuild: { state: 'queued', queuedAt: queued.createdAt.toISOString() },
    });
    set({ status: 'running' });
    expect(await stateNow()).toBe('running');
    set({ status: 'pending', attempts: 1, lastError: 'Search is unavailable' });
    expect(await stateNow()).toBe('retrying');
    set({ status: 'dead', attempts: 24 });
    expect(await stateNow()).toBe('failed');
    expect(JSON.stringify(await status())).not.toContain('unavailable');

    await rebuild();
    expect(await stateNow()).toBe('queued');
    const [, latest] = rebuilds(t);
    if (!latest) throw new Error('nothing queued');
    t.db.update(job).set({ status: 'succeeded', attempts: 1 }).where(eq(job.id, latest.id)).run();
    expect(await stateNow()).toBe('succeeded');
  });
});

describe('POST /search/index/rebuild', () => {
  it('queues a rebuild and answers at once, with the index as it stands', async () => {
    const { t, rebuild } = await setUp(false);

    const res = await rebuild();

    expect(res.status).toBe(202);
    expect(searchIndexStatusSchema.parse(await res.json())).toMatchObject({
      available: false,
      rebuild: { state: 'queued' },
    });
    expect(rebuilds(t)).toMatchObject([{ status: 'pending', payload: {} }]);
  });

  it('lets a rebuild already waiting or under way stand, rather than queue another', async () => {
    const { t, rebuild } = await setUp();
    await rebuild();
    await rebuild();
    expect(rebuilds(t)).toHaveLength(1);

    const [first] = rebuilds(t);
    t.db
      .update(job)
      .set({ status: 'running' })
      .where(eq(job.id, first?.id ?? 0))
      .run();
    expect((await rebuild()).status).toBe(202);
    expect(rebuilds(t)).toHaveLength(1);
  });
});
