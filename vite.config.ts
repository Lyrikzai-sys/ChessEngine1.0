import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative so the built demo works from a project subpath on GitHub Pages.
  base: './',
  server: { port: 5180 },
});
