import js from '@eslint/js';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import { globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  globalIgnores(['**/dist/', '**/coverage/']),
  js.configs.recommended,
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
    // Biome owns formatting, so turn off every rule that only checks layout.
    // The plugin only ships this preset in the legacy format, so take its rules.
    name: 'vue/no-layout-rules',
    rules: pluginVue.configs['no-layout-rules'].rules,
  },
);
