import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ucsdmanorlab.github.io',
  base: '/sparsity',
  outDir: './dist',
  // Dev-only: don't file-watch the large precomputed tree (tens of thousands of
  // mesh fragments blow past the inotify limit). No effect on build/deploy.
  vite: {
    server: {
      watch: { ignored: ['**/public/data/**'] },
    },
  },
});
