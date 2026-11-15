import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

/** The API's committed OpenAPI document, which `pnpm test` keeps in step with its routes. */
export const OPENAPI_DOCUMENT_FILE = join(import.meta.dirname, '../../api/openapi.json');

/** The web app's types for the API, generated from that document. */
export const API_TYPES_FILE = join(import.meta.dirname, '../src/api/schema.ts');

const HEADER =
  '// Generated from apps/api/openapi.json by `pnpm openapi:generate`. Do not edit it by hand.\n\n';

/** The contents of `API_TYPES_FILE`, as `pnpm openapi:generate` writes it. */
export async function renderApiTypes(): Promise<string> {
  const document = readFileSync(OPENAPI_DOCUMENT_FILE, 'utf8');
  return HEADER + astToString(await openapiTS(document));
}
