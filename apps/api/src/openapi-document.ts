import { API_BASE_PATH } from '@myli/shared';
import { createTestApp } from './testing.ts';

/** The committed copy of the OpenAPI document. The frontend client is generated from it. */
export const OPENAPI_DOCUMENT_FILE = new URL('../openapi.json', import.meta.url);

/** The OpenAPI document exactly as the API serves it, formatted for committing. */
export async function renderOpenApiDocument(): Promise<string> {
  // The document only depends on the routes, so a throwaway in-memory app renders it.
  const { app } = createTestApp();
  const res = await app.request(`${API_BASE_PATH}/openapi.json`);
  if (!res.ok) {
    throw new Error(`GET ${API_BASE_PATH}/openapi.json answered ${res.status}`);
  }
  return `${JSON.stringify(await res.json(), null, 2)}\n`;
}
