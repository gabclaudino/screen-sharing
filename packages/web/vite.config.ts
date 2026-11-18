import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev o Vite (5173) faz proxy de /api e /ws para o servidor Node (3000),
// mantendo a mesma origem lógica usada em produção.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
});
