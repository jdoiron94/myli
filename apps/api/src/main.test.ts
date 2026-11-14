// Runs the real entry point under plain Node (no Vitest transform), the way production runs it.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return address.port;
}

/** Starts main.ts with exactly `env`, so the developer's shell and .env can't leak in. */
function startApi(env: Record<string, string>) {
  const child = spawn(process.execPath, [MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const exited = once(child, 'exit').then(([code]) => code as number | null);

  const untilListening = () =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (stdout.includes('listening')) resolve();
      };
      check();
      child.stdout.on('data', check);
      void exited.then((code) => {
        reject(new Error(`API exited with code ${String(code)} before listening:\n${stderr}`));
      });
    });

  return { child, exited, untilListening, output: () => ({ stdout, stderr }) };
}

describe('main.ts', () => {
  it('serves /healthz, then exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    const api = startApi({ NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port) });
    await api.untilListening();

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);
    expect(api.output().stdout).toContain('SIGTERM received');
    expect(api.output().stderr).toBe('');
  });

  it('exits with code 1 and a readable message when the config is invalid', async () => {
    const api = startApi({ PORT: 'not-a-port' });

    expect(await api.exited).toBe(1);
    const { stderr } = api.output();
    expect(stderr).toMatch(/^Invalid environment configuration:\n\s+PORT: /);
    expect(stderr).not.toMatch(/^\s+at /m); // no stack trace
  });
});
