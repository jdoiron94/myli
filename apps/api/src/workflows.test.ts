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

/**
 * Each workflow's token access, for the whole workflow and for each job that asks for more. A new
 * workflow or job, or more access, must be added here, so it's visible in review.
 */
const ACCESS: Record<string, { workflow: unknown; jobs: Record<string, unknown> }> = {
  'ci.yml': { workflow: { contents: 'read' }, jobs: {} },
  'release.yml': {
    workflow: {},
    jobs: {
      'release-please': { contents: 'write', 'pull-requests': 'write', issues: 'write' },
      publish: { contents: 'read', packages: 'write' },
    },
  },
};

/** Root scripts that aren't checks, so CI doesn't run them. Every other root script must run. */
const NOT_CHECKS = {
  dev: 'starts the dev servers',
  'test:watch': 'reruns the tests on every change',
  format: 'rewrites files; CI runs format:check',
  'openapi:generate': 'rewrites files; pnpm test checks they match',
  'db:generate': 'writes a migration; pnpm test checks none is missing',
  seed: 'writes demo accounts to a database',
  reindex: 'rebuilds the search index of a running instance',
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

  it('gives each job only the access it needs', () => {
    expect(Object.keys(workflows).sort()).toEqual(Object.keys(ACCESS).sort());
    for (const [file, { permissions, jobs }] of Object.entries(workflows)) {
      expect(permissions, file).toEqual(ACCESS[file]?.workflow);
      for (const [name, job] of Object.entries(jobs)) {
        expect(job.permissions, `${file}: ${name}`).toEqual(ACCESS[file]?.jobs[name]);
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

  it('runs on pull requests to main and by hand, but not on release-please’s', () => {
    const ci = workflow('ci.yml');

    expect(ci.on).toEqual({ pull_request: { branches: ['main'] }, workflow_dispatch: null });
    for (const [name, job] of Object.entries(ci.jobs)) {
      expect(job.if, name).toBe("${{ !startsWith(github.head_ref, 'release-please--') }}");
    }
  });

  it('reports known vulnerabilities, and never fails because of them', () => {
    const audits = allSteps.filter(({ run }) => run?.includes('pnpm audit'));

    expect(audits).toHaveLength(1);
    expect(audits[0]?.['continue-on-error']).toBe(true);
  });
});

describe('the release workflow', () => {
  it('runs release-please on every push to main', () => {
    const release = workflow('release.yml');

    expect(release.on).toEqual({ push: { branches: ['main'] } });
    expect(release.jobs['release-please']?.steps.map(({ uses }) => uses)).toEqual([
      expect.stringMatching(/^googleapis\/release-please-action@/),
    ]);
  });

  it('makes the first release 0.1.0, and keeps breaking changes below 1.0', () => {
    const config = z
      .object({
        'bump-minor-pre-major': z.boolean(),
        packages: z.object({ '.': z.looseObject({ 'initial-version': z.string().optional() }) }),
      })
      .parse(JSON.parse(read('release-please-config.json')));

    // Without it, release-please makes the first release 1.0.0, whatever the manifest says.
    expect(config.packages['.']['initial-version']).toBe('0.1.0');
    expect(config['bump-minor-pre-major']).toBe(true);
  });

  it('publishes the images only for a release, and only once it has tested them', () => {
    const publish = workflow('release.yml').jobs.publish;
    const steps = publish?.steps ?? [];
    const runs = steps.map(({ run }) => run ?? '');
    const tested = runs.indexOf('pnpm test:containers');
    const pushed = runs.findIndex((run) => run.includes('docker push'));

    expect(publish?.needs).toBe('release-please');
    expect(publish?.if).toBe("needs.release-please.outputs.release_created == 'true'");
    // The released commit.
    expect(steps[0]?.uses).toMatch(/^actions\/checkout@/);
    expect(steps[0]?.with?.ref).toBe('${{ needs.release-please.outputs.sha }}');
    expect(tested).toBeGreaterThan(0);
    expect(pushed).toBeGreaterThan(tested);
    // The images test:containers just tested (e2e/images.ts), as the version and latest.
    expect(runs[pushed]).toContain('docker tag "$image:e2e"');
    expect(runs[pushed]).toContain('for tag in "$VERSION" latest; do');
  });
});
