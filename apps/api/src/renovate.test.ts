// Renovate's configuration (renovate.json). Renovate itself only reads it on the default branch, so
// these check what it can't: the user's decisions, and the custom patterns, which stop finding
// anything without a word if the file they read changes. Lives with the API's tests, like
// workflows.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const config = z
  .looseObject({
    schedule: z.array(z.string()),
    lockFileMaintenance: z.looseObject({ schedule: z.array(z.string()) }),
    automerge: z.boolean(),
    minimumReleaseAge: z.string(),
    vulnerabilityAlerts: z.looseObject({ minimumReleaseAge: z.string() }),
    customManagers: z.array(
      z.looseObject({
        managerFilePatterns: z.array(z.string()),
        matchStrings: z.array(z.string()),
      }),
    ),
    packageRules: z.array(
      z.looseObject({
        matchUpdateTypes: z.array(z.string()).optional(),
        matchPackageNames: z.array(z.string()).optional(),
        matchDepNames: z.array(z.string()).optional(),
        groupName: z.string().optional(),
        minimumReleaseAge: z.string().optional(),
      }),
    ),
  })
  .parse(JSON.parse(read('renovate.json')));

/** Every value of `key`, anywhere in the configuration. */
function valuesOf(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesOf(item, key));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, inner]) => [
    ...(name === key ? [inner] : []),
    ...valuesOf(inner, key),
  ]);
}

/** The custom manager that reads `path`, and what its pattern finds there. */
function customMatches(path: string) {
  const manager = config.customManagers.find(({ managerFilePatterns }) =>
    managerFilePatterns.some((pattern) => new RegExp(pattern.slice(1, -1)).test(path)),
  );
  expect(manager, path).toBeDefined();
  const [pattern = ''] = manager?.matchStrings ?? [];
  return [...read(path).matchAll(new RegExp(pattern, 'g'))].map(({ groups }) => ({ ...groups }));
}

const groupOf = (depName: string) =>
  config.packageRules.find(
    ({ matchPackageNames, matchDepNames }) =>
      matchPackageNames?.includes(depName) ?? matchDepNames?.includes(depName),
  )?.groupName;

describe('the Renovate configuration', () => {
  it('never merges a PR itself: every one waits for review', () => {
    expect(config.automerge).toBe(false);
    expect(valuesOf(config, 'automerge')).toEqual([false]);
  });

  it('opens PRs once a week, lockfile maintenance included', () => {
    expect(config.schedule).toHaveLength(1);
    // A cron schedule on a single weekday.
    expect(config.schedule[0]).toMatch(/^\S+ \S+ \* \* [0-6]$/);
    expect(config.lockFileMaintenance.schedule).toEqual(config.schedule);
  });

  it('proposes only releases at least a week old', () => {
    expect(config.minimumReleaseAge).toBe('7 days');
    expect(config.vulnerabilityAlerts.minimumReleaseAge).toBe('7 days');
    // config:best-practices sets 3 days for npm in a package rule; a later rule wins.
    const last = config.packageRules.findLast((rule) => rule.minimumReleaseAge !== undefined);
    expect(last).toEqual(
      expect.objectContaining({
        matchUpdateTypes: ['major', 'minor', 'patch'],
        minimumReleaseAge: '7 days',
      }),
    );
    expect(Object.keys(last ?? {}).filter((key) => key.startsWith('match'))).toEqual([
      'matchUpdateTypes',
    ]);
    expect(new Set(valuesOf(config, 'minimumReleaseAge'))).toEqual(new Set(['7 days']));
  });

  it("updates search/testing.ts's Meilisearch image together with compose.yaml's", () => {
    const [found, ...others] = customMatches('apps/api/src/search/testing.ts');

    expect(others).toEqual([]);
    expect(found?.depName).toBe('getmeili/meilisearch');
    expect(read('compose.yaml')).toContain(
      `image: ${String(found?.depName)}:${String(found?.currentValue)}@${String(found?.currentDigest)}\n`,
    );
    expect(groupOf('getmeili/meilisearch')).toBeDefined();
  });

  it("updates the Dockerfiles' pnpm together with packageManager in package.json", () => {
    const { packageManager } = z
      .object({ packageManager: z.string() })
      .parse(JSON.parse(read('package.json')));

    for (const path of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
      const found = customMatches(path);
      expect(found, path).toHaveLength(1);
      expect(`${String(found[0]?.depName)}@${String(found[0]?.currentValue)}`, path).toBe(
        packageManager,
      );
    }
    expect(groupOf('pnpm')).toBeDefined();
  });
});
