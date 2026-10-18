import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/healthz': { target: apiTarget },
      '/socket.io': { target: apiTarget, ws: true, changeOrigin: false },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
} as Parameters<typeof defineConfig>[0]);
