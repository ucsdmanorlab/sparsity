import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ucsdmanorlab.github.io',
  base: '/sparsity',
  outDir: './dist',
  // Keep "--flag" and quotes literal in imported docs; smart punctuation turns -- into a dash.
  markdown: { smartypants: false },
  // Dev-only: don't file-watch the large precomputed tree (tens of thousands of
  // mesh fragments exceed the inotify limit). No effect on build/deploy.
  vite: {
    server: {
      watch: { ignored: ['**/public/data/**'] },
    },
  },
});
