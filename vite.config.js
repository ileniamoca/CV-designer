import { defineConfig } from 'vite';
import { cvApi } from './server/cv-api.js';

export default defineConfig({
  plugins: [cvApi()],
  server: {
    port: 5180,
    // Documents are watched by the plugin itself (without reloading the whole page).
    watch: { ignored: ['**/documents/**'] },
  },
});
