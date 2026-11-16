import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';
import { recordSetupCompleted, runSetup, type SetupDeps } from './setup.ts';

export type SeedOutcome = 'not-configured' | 'created' | 'users-exist' | 'in-progress';

/**
 * Creates the first admin from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD, for installs where no one
 * opens the setup screen. Runs at startup, before the server listens, through the same `runSetup`
 * as the setup endpoint. Never touches users who already exist. Throws if creating the admin fails.
 */
export async function seedFirstAdmin(
  deps: SetupDeps & { logger: Logger },
  env: Pick<Env, 'ADMIN_NAME' | 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>,
): Promise<SeedOutcome> {
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = env;
  // The env schema guarantees all three or none.
  if (name === undefined || email === undefined || password === undefined) return 'not-configured';

  const result = await runSetup(deps, { name, email, password });
  if (result.ok) {
    deps.logger.info({ userId: result.user.id }, 'first admin created from the environment');
    // No request: it happens at startup.
    recordSetupCompleted(
      deps.db,
      deps.logger,
      { ip: null, userAgent: null },
      result.user.id,
      'environment',
    );
    return 'created';
  }
  if (result.reason === 'complete') {
    deps.logger.warn(
      'ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD are set, but users already exist, so they were ' +
        'ignored. Empty ADMIN_PASSWORD, or remove it from the environment.',
    );
    return 'users-exist';
  }
  deps.logger.warn(
    'another setup is in progress, so ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD were not used. ' +
      'Restart in a few minutes, or finish setup in the browser.',
  );
  return 'in-progress';
}
