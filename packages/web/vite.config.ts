import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev o Vite (5173) faz proxy de /api e /ws para o servidor Node (3000, ou DEV_API_PORT),
// mantendo a mesma origem lógica usada em produção.
const apiPort = process.env.DEV_API_PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
