import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    // `src/sw` is browser code too (the SW registration/update
    // lifecycle the page drives); it needs the same DOM environment.
    include: ['src/{client,sw}/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/client/**/*.{ts,tsx}', 'src/sw/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@shared': new URL('./src/shared', import.meta.url).pathname,
      '@client': new URL('./src/client', import.meta.url).pathname,
    },
  },
});
