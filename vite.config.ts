import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

const pages = ['index', 'dev', 'control', 'camera'];

export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? './',
  // Selbstsigniertes Zertifikat nur für `npm run dev:https` (Kamera im Handy-Browser braucht HTTPS).
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, new URL(`${p}.html`, import.meta.url).pathname])) },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
}));
