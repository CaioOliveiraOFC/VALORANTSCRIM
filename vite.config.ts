import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': API,
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
