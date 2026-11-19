// The week-old rule (CLAUDE.md, "Dependencies and Docker"): pnpm refuses any release less than a
// week old on every install, and Renovate proposes none. Lives with the API's tests, like
// renovate.test.ts, since no workspace package covers the repository's root.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const workspace = z
  .looseObject({
    minimumReleaseAge: z.number().optional(),
    minimumReleaseAgeExclude: z.unknown().optional(),
  })
  .parse(parse(read('pnpm-workspace.yaml')));
const renovate = z
  .looseObject({ minimumReleaseAge: z.string() })
  .parse(JSON.parse(read('renovate.json')));

describe('the week-old rule', () => {
  // An exception lets a release in before it's a week old, for every install. It's the user's
  // decision, so a change here shows in review.
  it('exempts no package', () => {
    expect(workspace.minimumReleaseAgeExclude).toBeUndefined();
  });

  it('waits as long as Renovate does', () => {
    const [, days] = /^(\d+) days?$/.exec(renovate.minimumReleaseAge) ?? [];
    expect(Number(days) * 24 * 60).toBe(workspace.minimumReleaseAge);
  });
});
