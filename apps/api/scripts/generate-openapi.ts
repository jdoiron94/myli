// Writes the API's OpenAPI document to apps/api/openapi.json. Run after changing any route or schema;
// `pnpm test` fails while the committed copy is out of date.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPENAPI_DOCUMENT_FILE, renderOpenApiDocument } from '../src/openapi-document.ts';

writeFileSync(OPENAPI_DOCUMENT_FILE, await renderOpenApiDocument());
process.stdout.write(`Wrote ${fileURLToPath(OPENAPI_DOCUMENT_FILE)}\n`);
