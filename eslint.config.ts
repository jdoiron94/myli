import js from '@eslint/js';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import { globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  // schema.ts is generated from the OpenAPI document (see apps/web/scripts/api-types.ts).
  globalIgnores(['**/dist/', '**/coverage/', 'apps/web/src/api/schema.ts']),
  js.configs.recommended,
  // Its layout rules format `<template>` blocks, and `eslint --fix` applies them. They're the only
  // layout rules turned on, and they never look at `<script>` or `<style>`, which Biome formats.
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,
  {
    rules: {
      // Numbers always stringify predictably, so `${count} recipes` is fine.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The API logs through pino (`c.var.logger` inside requests), so logs stay structured.
    files: ['apps/api/**'],
    rules: { 'no-console': 'error' },
  },
  {
    // The shadcn-vue CLI writes new components that import its own young `cn` package. The app
    // uses clsx and tailwind-merge behind the same helper instead.
    files: ['apps/web/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'cn', message: "Import cn from '@/lib/utils' instead." }] },
      ],
    },
  },
  {
    // shadcn-vue's components, kept close to what its CLI writes, because updating one means
    // overwriting it: their names are single words (`Button`), and optional props stay undefined
    // when not passed.
    files: ['apps/web/src/components/ui/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    // Served to the browser as it is, before the app loads (see the file).
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { document: 'readonly', localStorage: 'readonly', matchMedia: 'readonly' },
    },
  },
);
