// The GitHub Actions workflows (.github/workflows) and the actions they share (.github/actions). It
// lives with the API's tests, like the checks of compose.yaml and .env.example, since no workspace
// package covers the repository's root.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const list = (dir: string) => readdirSync(new URL(`../../../${dir}`, import.meta.url));

const stepSchema = z.object({
  name: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  'continue-on-error': z.boolean().optional(),
});
type Step = z.infer<typeof stepSchema>;

const workflowSchema = z.object({
  on: z.unknown(),
  permissions: z.unknown(),
  jobs: z.record(
    z.string(),
    z.object({
      permissions: z.unknown().optional(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      if: z.string().optional(),
      steps: z.array(stepSchema),
    }),
  ),
});

const workflows = Object.fromEntries(
  list('.github/workflows')
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => [file, workflowSchema.parse(parse(read(`.github/workflows/${file}`)))]),
);
const actions = Object.fromEntries(
  list('.github/actions').map((name) => {
    const path = `.github/actions/${name}/action.yml`;
    return [
      path,
      z.object({ runs: z.object({ steps: z.array(stepSchema) }) }).parse(parse(read(path))),
    ];
  }),
);
const files = [
  ...Object.keys(workflows).map((file) => `.github/workflows/${file}`),
  ...Object.keys(actions),
];
const allSteps: Step[] = [
  ...Object.values(workflows).flatMap(({ jobs }) =>
    Object.values(jobs).flatMap(({ steps }) => steps),
  ),
  ...Object.values(actions).flatMap(({ runs }) => runs.steps),
];

function workflow(file: string) {
  const found = workflows[file];
  if (!found) throw new Error(`no ${file}`);
  return found;
}

/** Root scripts that aren't checks, so CI doesn't run them. Every other root script must run. */
const NOT_CHECKS = {
  dev: 'starts the dev servers',
  'dev:all': 'starts the dev servers and Meilisearch',
  'test:watch': 'reruns the tests on every change',
  format: 'rewrites files; CI runs format:check',
  'openapi:generate': 'rewrites files; pnpm test checks they match',
  'db:generate': 'writes a migration; pnpm test checks none is missing',
  seed: 'writes demo accounts to a database',
  reindex: 'rebuilds the search index of a running instance',
  backup: 'backs up a running instance',
  screenshots: 'retakes the README’s screenshots',
};

describe('every workflow', () => {
  // In-repo actions use GitHub's self-repository syntax ($/...), which loads them from the commit
  // being run. A workspace-relative one (./...) could load whatever an earlier step wrote there.
  it('pins every action it uses to a commit, and names its version', () => {
    for (const path of files) {
      const uses = read(path)
        .split('\n')
        .filter((line) => /^\s*(- )?uses:/.test(line))
        .map((line) => line.replace(/^\s*(- )?uses:\s*/, ''));

      expect(uses.length, path).toBeGreaterThan(0);
      for (const action of uses) {
        expect(action, path).toMatch(/^(\$\/\S+|[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+)$/);
      }
    }
  });

  it('leaves no token in the git configuration after checking out', () => {
    const checkouts = allSteps.filter(({ uses }) => uses?.startsWith('actions/checkout@'));

    expect(checkouts.length).toBeGreaterThan(0);
    for (const { with: options } of checkouts) {
      expect(options?.['persist-credentials']).toBe(false);
    }
  });
});

describe('the CI workflow', () => {
  it('runs every check that runs locally', () => {
    const { scripts } = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(read('package.json')));
    const checks = Object.keys(scripts).filter((name) => !(name in NOT_CHECKS));
    const runs = Object.values(workflow('ci.yml').jobs).flatMap(({ steps }) =>
      steps.map(({ run }) => run),
    );

    for (const name of checks) expect(runs, name).toContain(`pnpm ${name}`);
    // The list above stays current.
    for (const name of Object.keys(NOT_CHECKS)) expect(scripts, name).toHaveProperty(name);
  });

  it('reports known vulnerabilities, and never fails because of them', () => {
    const audits = allSteps.filter(({ run }) => run?.includes('pnpm audit'));

    expect(audits).toHaveLength(1);
    expect(audits[0]?.['continue-on-error']).toBe(true);
  });
});

describe('the release workflow', () => {
  it('publishes the images only for a release, built as CI builds them for its tests', () => {
    const publish = workflow('release.yml').jobs.publish;
    const steps = publish?.steps ?? [];
    const runs = steps.map(({ run }) => run ?? '');
    const built = runs.indexOf('node e2e/build-images.ts');
    const pushed = runs.findIndex((run) => run.includes('docker push'));

    expect(publish?.needs).toBe('release-please');
    expect(publish?.if).toBe("needs.release-please.outputs.release_created == 'true'");
    // The released commit.
    expect(steps[0]?.uses).toMatch(/^actions\/checkout@/);
    expect(steps[0]?.with?.ref).toBe('${{ needs.release-please.outputs.sha }}');
    expect(built).toBeGreaterThan(0);
    expect(pushed).toBeGreaterThan(built);
    // The images build-images.ts names (e2e/images.ts), as the version and latest.
    expect(runs[pushed]).toContain('docker tag "$image:e2e"');
    expect(runs[pushed]).toContain('for tag in "$VERSION" latest; do');
    // Pull requests ran the tests on the same build (see the workflow).
    expect(runs).not.toContain('pnpm test:containers');
  });
});
