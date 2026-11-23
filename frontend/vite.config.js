import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)),
                  fileURLToPath(new URL('../gesture_config.json', import.meta.url))] },
    proxy: { '/api': { target: 'http://127.0.0.1:8000', rewrite: path => path.slice(4) } },
  },
});
