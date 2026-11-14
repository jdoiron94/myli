import { defineConfig } from 'drizzle-kit';

// Only used to generate migrations (`pnpm db:generate`). The app applies them itself on startup.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
