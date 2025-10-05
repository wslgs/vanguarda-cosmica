import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')?.[1] ?? '';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubActions && repositoryName ? `/${repositoryName}/` : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
});
