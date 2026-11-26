import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { devlogPlugin } from './devlog/vitePlugin';

export default defineConfig({
  plugins: [react(), devlogPlugin()],
  server: { port: 5180 },
});
