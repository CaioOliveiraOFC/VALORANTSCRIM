import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'import.meta.env.VITE_BRASA_DEPLOYMENT': JSON.stringify(
      process.env.VERCEL_ENV === 'preview'
        ? 'preview'
        : process.env.VERCEL_ENV === 'production'
          ? 'production'
          : 'local',
    ),
  },
  plugins: [react()],
  test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'supabase/**/*.test.ts'] },
});
