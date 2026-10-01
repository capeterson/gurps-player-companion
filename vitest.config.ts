import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    // Verified helper/source tests do not render React or open IndexedDB.
    // Keep an explicit list: new browser tests retain DOM setup by default.
    environmentMatchGlobs: [
      ['src/client/components/AppBreadcrumbs.test.ts', 'node'],
      ['src/client/components/ui/overlaySourceGuard.test.ts', 'node'],
      ['src/client/db/legacyCampaignDependencies.test.ts', 'node'],
      ['src/client/features/characters/sections/inventoryTree.test.tsx', 'node'],
      ['src/client/sync/fieldValuesEqual.test.ts', 'node'],
      ['src/client/sync/flashBus.test.ts', 'node'],
      ['src/client/sync/gestureBatch.test.ts', 'node'],
      ['src/client/sync/minimalViewSweep.test.ts', 'node'],
      ['src/client/sync/state.test.ts', 'node'],
      ['src/client/sync/syncLogPresentation.test.ts', 'node'],
    ],
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
