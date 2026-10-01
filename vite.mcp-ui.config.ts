import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/** A resource must work in an opaque sandbox without loading our origin's
 * scripts, styles, fonts, service worker, or authenticated HTTP endpoints. */
function inlineApp(): Plugin {
  return {
    name: 'inline-mcp-app',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['character.html'];
      if (!html || html.type !== 'asset') throw new Error('Missing MCP App entry');
      let source = String(html.source);
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          source = source.replace(
            /<script\b[^>]*src="[^"]+"[^>]*><\/script>/,
            () =>
              `<script type="module">${output.code.replace(/<\/script/gi, '<\\/script')}</script>`,
          );
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          source = source.replace(
            /<link\b[^>]*rel="stylesheet"[^>]*>/,
            () => `<style>${String(output.source).replace(/<\/style/gi, '<\\/style')}</style>`,
          );
          delete bundle[name];
        }
      }
      if (/<(?:script|link)\b[^>]*(?:src|href)=/.test(source))
        throw new Error('MCP App has external assets');
      html.source = source;
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
