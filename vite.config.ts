import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Limit watch scope to the actual frontend so repo-level edits do not trigger reload storms.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/.git/**',
          '**/.gcloud-config/**',
          '**/build/**',
          '**/dist/**',
          '**/docs/**',
          '**/infra/**',
          '**/node_modules/**',
          '**/scripts/**',
          '**/skills/**',
          '**/tests/**',
          '**/*.log',
          '**/*.tf',
          '**/*.tfvars',
        ],
      },
    },
  };
});
