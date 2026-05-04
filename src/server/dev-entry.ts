/**
 * Dev-only entry: exports the Hono app for `@hono/vite-dev-server` to
 * mount under the Vite dev server. Vite is the runtime in development;
 * Bun.serve (`./index.ts`) is only used in production.
 */

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config);

export default app;
