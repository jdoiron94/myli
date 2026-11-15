import js from '@eslint/js';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import { globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  globalIgnores(['**/dist/', '**/coverage/']),
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
);
