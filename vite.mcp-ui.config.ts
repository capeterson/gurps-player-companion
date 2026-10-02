import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { inlineMcpAssets } from './scripts/inline-mcp-assets';

/** A resource must work in an opaque sandbox without loading our origin's
 * scripts, styles, fonts, service worker, or authenticated HTTP endpoints. */
function inlineApp(): Plugin {
  return {
    name: 'inline-mcp-app',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['character.html'];
      if (!html || html.type !== 'asset') throw new Error('Missing MCP App entry');
      const assets: Parameters<typeof inlineMcpAssets>[1] = {};
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          assets[name] = { kind: 'script', source: output.code };
        } else if (name.endsWith('.css')) {
          assets[name] = { kind: 'style', source: String(output.source) };
        }
      }
      html.source = inlineMcpAssets(String(html.source), assets);
      for (const name of Object.keys(assets)) delete bundle[name];
    },
  };
}

export default defineConfig({
  root: 'src/client/mcp-ui',
  publicDir: false,
  plugins: [react(), tailwind(), inlineApp()],
  build: {
    outDir: '../../../dist/mcp-ui',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/client/mcp-ui/character.html'),
      output: { inlineDynamicImports: true },
    },
  },
});
