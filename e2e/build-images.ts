/**
 * Prepares the end-to-end tests against the images (playwright.containers.config.ts), before
 * Playwright starts: removes the stacks an earlier run left behind, then builds the API and web
 * images with compose.yaml's build settings. Docker's build cache makes a rebuild quick when nothing
 * changed. Only errors are shown.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BROWSERS } from './browsers.ts';
import {
  API_IMAGE,
  composeProject,
  dockerClientEnvironment,
  IMAGE_TAG,
  WEB_IMAGE,
} from './images.ts';

const repoRoot = join(import.meta.dirname, '..');

/** Runs a Compose command to the end. Not the shell's variables, nor the repo's .env. */
function compose(...args: string[]) {
  execFileSync('docker', ['compose', '--env-file', '/dev/null', '--progress', 'quiet', ...args], {
    cwd: repoRoot,
    env: {
      ...dockerClientEnvironment(),
      MYLI_VERSION: IMAGE_TAG,
      // compose.yaml requires it, though neither building nor removing a stack uses it.
      PUBLIC_URL: 'https://localhost',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

// Each browser's launcher (start-compose.ts) removes its stack when Playwright stops it, but not
// when it's killed, or stopped while it's still starting the stack. That stack keeps running, and
// once its web server answers on the port, Playwright refuses to start the launcher that would
// remove it.
for (const { name } of BROWSERS) {
  // With the s3 profile, which Firefox's stack runs, so Garage goes too.
  compose(
    '--project-name',
    composeProject(name),
    '--profile',
    's3',
    'down',
    '--volumes',
    '--remove-orphans',
  );
}

console.log(`Building ${API_IMAGE} and ${WEB_IMAGE} from compose.yaml`);
compose('build', '--quiet');
