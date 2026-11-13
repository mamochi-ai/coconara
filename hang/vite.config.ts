import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 相対パスで出力し、GitHub Pages の /coconara/hang/ など、どのパスに置いても動くようにする
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../docs/hang',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
  },
});
