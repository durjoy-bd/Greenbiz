import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// GREENBIZ_DEV_PORT / GREENBIZ_API_ORIGIN let a second checkout run beside another dev server.
const port = Number(process.env.GREENBIZ_DEV_PORT ?? 5173);
export default defineConfig({
  // Relative asset paths: the static build runs from any host, folder or the Android app.
  base: process.env.GREENBIZ_BASE ?? './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '/api': process.env.GREENBIZ_API_ORIGIN ?? 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', sourcemap: false },
});
