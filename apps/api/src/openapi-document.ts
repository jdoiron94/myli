import { API_BASE_PATH } from '@myli/shared';
import { createApp } from './app.ts';
import { createLogger } from './logger.ts';

/** The committed copy of the OpenAPI document. The frontend client is generated from it. */
export const OPENAPI_DOCUMENT_FILE = new URL('../openapi.json', import.meta.url);

/** The OpenAPI document exactly as the API serves it, formatted for committing. */
export async function renderOpenApiDocument(): Promise<string> {
  const app = createApp({ logger: createLogger('silent') });
  const res = await app.request(`${API_BASE_PATH}/openapi.json`);
  if (!res.ok) {
    throw new Error(`GET ${API_BASE_PATH}/openapi.json answered ${res.status}`);
  }
  return `${JSON.stringify(await res.json(), null, 2)}\n`;
}
