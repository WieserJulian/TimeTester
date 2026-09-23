import { defineConfig } from 'vite';

// src/sw.ts → dist/sw.js as one classic script (no imports), runs after the app build.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/sw.ts', formats: ['iife'], name: 'sw', fileName: () => 'sw.js' },
  },
});
