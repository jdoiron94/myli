// The API docs page (api/docs/index.html). It's a page of its own, so the app never loads Scalar's
// code, its global styles, or the <style> elements it adds (ADR 0011).
import '../zod-jitless.ts';
import '@scalar/api-reference/style.css';
import './api-docs.css';
import { createApp } from 'vue';
import ApiDocs from './ApiDocs.vue';

createApp(ApiDocs).mount('#app');
