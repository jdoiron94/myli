import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { installApp } from './app.ts';

const app = createApp(App);
installApp(app);
app.mount('#app');
