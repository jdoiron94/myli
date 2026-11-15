<script setup lang="ts">
import { API_BASE_PATH } from '@myli/shared';
import { ApiReference, type ReferenceProps } from '@scalar/api-reference';

// public/theme.js has already put the app's light or dark theme on <html>.
const colorMode = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

/** Scalar's settings. The page loads the API's own document and talks to no Scalar service. */
const configuration = {
  url: `${API_BASE_PATH}/openapi.json`,
  // Its default fonts come from fonts.scalar.com. api-docs.css uses the system's instead.
  withDefaultFonts: false,
  // Scalar turns both on by default on a local URL, as in development: an AI chat that runs on
  // Scalar's servers, and developer tools whose Share button uploads the document to Scalar.
  agent: { disabled: true },
  showDeveloperTools: 'never',
  // Its Open API Client button opens client.scalar.com in a new tab, which then fetches this
  // instance's document and loads Scalar's analytics. A CSP can't stop a new tab.
  hideClientButton: true,
  // Only Scalar's analytics plugin reads this, and the page doesn't load it. Off in case that
  // changes.
  telemetry: false,
  // The app's theme, instead of Scalar's own toggle and saved choice.
  forceDarkModeState: colorMode,
} satisfies NonNullable<ReferenceProps['configuration']>;
</script>

<template>
  <ApiReference :configuration="configuration" />
</template>
