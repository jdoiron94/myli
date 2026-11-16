/**
 * Builds the API and web images with compose.yaml's build settings, tagged for the end-to-end
 * tests against them (playwright.containers.config.ts). Docker's build cache makes a rebuild quick
 * when nothing changed. Only errors are shown.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { API_IMAGE, dockerClientEnvironment, IMAGE_TAG, WEB_IMAGE } from './images.ts';

const repoRoot = join(import.meta.dirname, '..');

console.log(`Building ${API_IMAGE} and ${WEB_IMAGE} from compose.yaml`);
execFileSync('docker', ['compose', '--env-file', '/dev/null', 'build', '--quiet'], {
  cwd: repoRoot,
  // Not the shell's variables, nor the repo's .env (`--env-file` above).
  env: {
    ...dockerClientEnvironment(),
    MYLI_VERSION: IMAGE_TAG,
    // compose.yaml requires it, though building doesn't use it.
    PUBLIC_URL: 'https://localhost',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
