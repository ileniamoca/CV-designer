import { defineConfig } from 'vite';
import { cvApi } from './server/cv-api.js';

export default defineConfig({
  plugins: [cvApi()],
  server: {
    port: 5180,
    // Los documentos los vigila el propio plugin (sin recargar la página entera).
    watch: { ignored: ['**/documentos/**'] },
  },
});
