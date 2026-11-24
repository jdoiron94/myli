import { AUTH_BASE_PATH, passwordSchema, recipeListSchema } from '@myli/shared';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  auditEvent,
  collectionItem,
  comment,
  invitation,
  job,
  rating,
  user,
  userNote,
} from '../db/schema.ts';
import { besideTheApi } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { DEMO_ACCOUNTS, type DemoAccount, demoPassword, seedDemoAccounts } from './demo.ts';
import { DEMO_COLLECTIONS, DEMO_RECIPES, seedDemoRecipes } from './demo-recipes.ts';
import { runSetup } from './setup.ts';

function setUp() {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ logger });
  const seed = () =>
    seedDemoAccounts({
      db: t.db,
      auth: t.auth,
      logger,
      publicUrl: t.publicUrl,
      ttlDays: t.env.INVITATION_TTL_DAYS,
    });
  /** Every log line, including Better Auth's, so tests can check no password appears. */
  const rawLogs = () => lines.join('');
  return { t, seed, rawLogs };
}

const users = (t: TestApp) =>
  t.db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .all();

function signIn(t: TestApp, email: string, password: string) {
  return t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
    method: 'POST',
    headers: { origin: t.publicUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('demoPassword', () => {
  it('follows the password rules, and is different every time', () => {
    const passwords = Array.from({ length: 500 }, demoPassword);

    for (const password of passwords) {
      expect(passwordSchema.safeParse(password).success, password).toBe(true);
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/);
    }
    expect(new Set(passwords).size).toBe(passwords.length);
  });
});

describe('seedDemoAccounts', () => {
  it('creates one account per role, each able to sign in with the password it returns', async () => {
    const { t, seed } = setUp();

    const result = await seed();

    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.accounts.map(({ role, name, email }) => ({ role, name, email }))).toEqual(
      DEMO_ACCOUNTS,
    );
    expect(users(t).map(({ role, name, email }) => ({ role, name, email }))).toEqual(
      expect.arrayContaining([...DEMO_ACCOUNTS]),
    );
    expect(users(t)).toHaveLength(3);
    for (const { email, password } of result.accounts) {
      expect((await signIn(t, email, password)).status, email).toBe(200);
    }
    expect(new Set(result.accounts.map(({ password }) => password)).size).toBe(3);
  });

  it('creates the admin through setup and invites the others, as the audit log shows', async () => {
    const { t, seed } = setUp();

    await seed();

    const ids = Object.fromEntries(users(t).map(({ role, id }) => [role, id]));
    const invitations = Object.fromEntries(
      t.db
        .select({ id: invitation.id, role: invitation.role, accepted: invitation.acceptedAt })
        .from(invitation)
        .all()
        .map(({ role, id, accepted }) => {
          expect(accepted, role).not.toBeNull();
          return [role, id];
        }),
    );
    const events = t.db
      .select({
        actorId: auditEvent.actorId,
        action: auditEvent.action,
        targetId: auditEvent.targetId,
        metadata: auditEvent.metadata,
        ip: auditEvent.ip,
      })
      .from(auditEvent)
      .orderBy(asc(auditEvent.id))
      .all();
    expect(events).toEqual([
      {
        actorId: ids.admin,
        action: 'setup.completed',
        targetId: ids.admin,
        metadata: { via: 'demo-seed' },
        ip: null,
      },
      ...(['editor', 'viewer'] as const).flatMap((role) => [
        {
          actorId: ids.admin,
          action: 'invitation.created',
          targetId: invitations[role],
          metadata: { email: `${role}@example.com`, role },
          ip: null,
        },
        {
          actorId: ids[role],
          action: 'invitation.accepted',
          targetId: invitations[role],
          metadata: { email: `${role}@example.com`, role },
          ip: null,
        },
      ]),
    ]);
  });

  it('queues no email and logs no password', async () => {
    const { t, seed, rawLogs } = setUp();

    const result = await seed();

    // It invites with email off, whatever the instance's setting: the addresses are example.com.
    expect(t.db.select().from(job).all()).toEqual([]);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    for (const { password } of result.accounts) expect(rawLogs()).not.toContain(password);
    expect(rawLogs()).toContain('demo accounts created');
  });

  it('refuses once any user exists, and changes nothing', async () => {
    const { t, seed } = setUp();
    await signedInAs(t, 'viewer');
    const before = users(t);

    expect(await seed()).toEqual({ ok: false, reason: 'users-exist' });
    expect(users(t)).toEqual(before);
    expect(t.db.select().from(invitation).all()).toEqual([]);
  });

  it('refuses while first-run setup is under way', async () => {
    const { t, seed } = setUp();
    // Setup holds its claim while Better Auth creates the admin.
    const setup = runSetup(
      { db: t.db, auth: t.auth },
      { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Correct horse battery 9' },
    );

    expect(await seed()).toEqual({ ok: false, reason: 'in-progress' });
    await setup;
    expect(users(t).map(({ email }) => email)).toEqual(['ada@example.com']);
  });
});

describe('seedDemoRecipes', () => {
  /** A demo account's session, signed in with the password the seed gave it. */
  async function cookieOf(t: TestApp, { email, password }: DemoAccount) {
    const res = await signIn(t, email, password);
    return res.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  it('saves every demo recipe, each account seeing all but the others’ private ones', async () => {
    const { t, seed } = setUp();
    const result = await seed();
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const [admin, editor, viewer] = result.accounts;
    if (!admin || !editor || !viewer) throw new Error('missing a demo account');

    expect(seedDemoRecipes(t.db, { admin: admin.id, editor: editor.id })).toBe(DEMO_RECIPES.length);

    const totals: Record<string, number> = {};
    for (const account of [admin, editor, viewer]) {
      const res = await t.app.request('/api/v1/recipes?page=1', {
        headers: { cookie: await cookieOf(t, account) },
      });
      totals[account.role] = recipeListSchema.parse(await res.json()).total;
    }
    const privateOf = (owner: string) =>
      DEMO_RECIPES.filter((recipe) => recipe.visibility === 'private' && recipe.owner === owner)
        .length;
    const shared = DEMO_RECIPES.length - privateOf('admin') - privateOf('editor');
    expect(totals).toEqual({
      admin: shared + privateOf('admin'),
      editor: shared + privateOf('editor'),
      viewer: shared,
    });
    // With the ratings, comments, notes and collections the demo accounts gave them.
    expect({
      ratings: t.db.select().from(rating).all().length,
      comments: t.db.select().from(comment).all().length,
      notes: t.db.select().from(userNote).all().length,
      collected: t.db.select().from(collectionItem).all().length,
    }).toEqual({
      ratings: DEMO_RECIPES.flatMap((recipe) => Object.keys(recipe.ratings ?? {})).length,
      comments: DEMO_RECIPES.flatMap((recipe) => recipe.comments ?? []).length,
      notes: DEMO_RECIPES.flatMap((recipe) => Object.keys(recipe.notes ?? {})).length,
      collected: DEMO_COLLECTIONS.flatMap((collection) => collection.recipes).length,
    });
    // Each queued its search update, for the API's worker to send.
    const updated = t.db
      .select()
      .from(job)
      .all()
      .filter(({ type }) => type === 'search.index-recipe')
      .map(({ payload }) => (payload as { recipeId: string }).recipeId);
    expect(new Set(updated).size).toBe(DEMO_RECIPES.length);
  });

  // Regression: `docker compose exec api node src/seed-demo.ts` could fail with
  // SQLITE_BUSY_SNAPSHOT when the API's worker committed while a tag or a recipe was being saved.
  it('saves them while the API writes to the database, which waits for it', () => {
    const { result, apiWrites } = besideTheApi(
      ['insert into "tag"', 'insert into "recipe"', 'insert into "collection_item"'],
      (script, api) => {
        for (const role of ['admin', 'editor'] as const) {
          api
            .insert(user)
            .values({ id: role, name: role, email: `${role}@example.com`, role })
            .run();
        }
        return seedDemoRecipes(script, { admin: 'admin', editor: 'editor' });
      },
    );

    expect(result).toBe(DEMO_RECIPES.length);
    expect(apiWrites).toEqual({
      'insert into "tag"': false,
      'insert into "recipe"': false,
      'insert into "collection_item"': false,
    });
  });
});
