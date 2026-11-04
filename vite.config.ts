import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE lets you deploy to a GitHub Pages project site, e.g. VITE_BASE=/yapameet/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 8777, strictPort: true, host: true },
  preview: { port: 8777, strictPort: true, host: true },
  build: { target: 'es2021', sourcemap: false },
});
