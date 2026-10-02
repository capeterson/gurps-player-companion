type InlineAsset = { kind: 'script' | 'style'; source: string };

/** Resolve tags in the original document once. Injected JavaScript may contain
 * HTML strings, so it must never be searched again as document markup. */
export function inlineMcpAssets(html: string, assets: Record<string, InlineAsset>): string {
  return html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi,
    (tag) => {
      const openingTag = tag.slice(0, tag.indexOf('>') + 1);
      if (/^<style\b/i.test(openingTag)) return tag;
      const script = /^<script\b/i.test(openingTag);
      const reference = openingTag.match(
        script ? /\bsrc\s*=\s*(["'])(.*?)\1/i : /\bhref\s*=\s*(["'])(.*?)\1/i,
      );
      const assetPath = reference?.[2];
      if (assetPath === undefined) {
        if (/\b(?:src|href)\s*=/i.test(openingTag))
          throw new Error('MCP App has an unsupported asset reference');
        return tag;
      }
      const asset = assets[assetPath.replace(/^\//, '')];
      const stylesheet = /\brel\s*=\s*(["'])stylesheet\1/i.test(openingTag);
      if (!asset || (script ? asset.kind !== 'script' : !stylesheet || asset.kind !== 'style'))
        throw new Error('MCP App has external assets');
      return script
        ? `<script type="module">${asset.source.replace(/<\/script/gi, '<\\/script')}</script>`
        : `<style>${asset.source.replace(/<\/style/gi, '<\\/style')}</style>`;
    },
  );
}
