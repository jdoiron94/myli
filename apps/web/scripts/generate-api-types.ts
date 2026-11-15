// Writes apps/web/src/api/schema.ts from apps/api/openapi.json. `pnpm openapi:generate` runs it
// right after regenerating that document; `pnpm test` fails while the committed copy is out of date.
import { writeFileSync } from 'node:fs';
import { API_TYPES_FILE, renderApiTypes } from './api-types.ts';

writeFileSync(API_TYPES_FILE, await renderApiTypes());
process.stdout.write(`Wrote ${API_TYPES_FILE}\n`);
