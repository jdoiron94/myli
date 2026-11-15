/**
 * Builds the API and web images from the repo root, for the end-to-end tests against them
 * (playwright.containers.config.ts). Docker's build cache makes a rebuild quick when nothing
 * changed. Only errors are shown.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { API_IMAGE, WEB_IMAGE } from './images.ts';

const repoRoot = join(import.meta.dirname, '..');

for (const [dockerfile, image] of [
  ['apps/api/Dockerfile', API_IMAGE],
  ['apps/web/Dockerfile', WEB_IMAGE],
] as const) {
  console.log(`Building ${image} from ${dockerfile}`);
  execFileSync('docker', ['build', '--quiet', '--file', dockerfile, '--tag', image, '.'], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
