// The CI workflow (.github/workflows/ci.yml) and the setup steps its jobs share. It lives with the
// API's tests, like the checks of compose.yaml and .env.example, since no workspace package covers
// the repository's root.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const stepSchema = z.object({
  name: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  'continue-on-error': z.boolean().optional(),
});

const WORKFLOW = '.github/workflows/ci.yml';
const SETUP_ACTION = '.github/actions/setup/action.yml';

const workflow = z
  .object({
    permissions: z.unknown(),
    jobs: z.record(
      z.string(),
      z.object({ permissions: z.unknown().optional(), steps: z.array(stepSchema) }),
    ),
  })
  .parse(parse(read(WORKFLOW)));
const setupAction = z
  .object({ runs: z.object({ steps: z.array(stepSchema) }) })
  .parse(parse(read(SETUP_ACTION)));

const workflowSteps = Object.values(workflow.jobs).flatMap(({ steps }) => steps);
const allSteps = [...workflowSteps, ...setupAction.runs.steps];

/** Root scripts that aren't checks, so CI doesn't run them. Every other root script must run. */
const NOT_CHECKS = {
  dev: 'starts the dev servers',
  'test:watch': 'reruns the tests on every change',
  format: 'rewrites files; CI runs format:check',
  'openapi:generate': 'rewrites files; pnpm test checks they match',
  'db:generate': 'writes a migration; pnpm test checks none is missing',
  seed: 'writes demo accounts to a database',
};

describe('the CI workflow', () => {
  it('runs every check that runs locally', () => {
    const { scripts } = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(read('package.json')));
    const checks = Object.keys(scripts).filter((name) => !(name in NOT_CHECKS));
    const runs = workflowSteps.map(({ run }) => run);

    for (const name of checks) expect(runs, name).toContain(`pnpm ${name}`);
    // The list above stays current.
    for (const name of Object.keys(NOT_CHECKS)) expect(scripts, name).toHaveProperty(name);
  });

  // In-repo actions use GitHub's self-repository syntax ($/...), which loads them from the commit
  // being run. A workspace-relative one (./...) could load whatever an earlier step wrote there.
  it('pins every action it uses to a commit, and names its version', () => {
    for (const path of [WORKFLOW, SETUP_ACTION]) {
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

  it('gives its token read access to the repository, and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions, name).toBeUndefined();
    }
  });

  it('leaves no token in the git configuration after checking out', () => {
    const checkouts = allSteps.filter(({ uses }) => uses?.startsWith('actions/checkout@'));

    expect(checkouts).toHaveLength(Object.keys(workflow.jobs).length);
    for (const { with: options } of checkouts) {
      expect(options?.['persist-credentials']).toBe(false);
    }
  });

  it('reports known vulnerabilities, and never fails because of them', () => {
    const audits = allSteps.filter(({ run }) => run?.includes('pnpm audit'));

    expect(audits).toHaveLength(1);
    expect(audits[0]?.['continue-on-error']).toBe(true);
  });
});
