import { describe, expect, test } from 'bun:test';
import { inlineMcpAssets } from '../../../scripts/inline-mcp-assets.ts';

describe('inlineMcpAssets', () => {
  test('inlines exact script and stylesheet references without matching markup inside JavaScript', () => {
    const html =
      "<html><head><script type='module' src='/assets/app.js'></script>" +
      '<link rel="stylesheet" crossorigin href="/assets/app.css"></head><body></body></html>';
    const script =
      'const warning = `<link rel="stylesheet" href="%s" ... />`; const closer = "</script>";';
    const output = inlineMcpAssets(html, {
      'assets/app.js': { kind: 'script', source: script },
      'assets/app.css': { kind: 'style', source: 'body { color: red; } </style>' },
    });

    expect(output).toContain(
      '<script type="module">const warning = `<link rel="stylesheet" href="%s" ... />`; const closer = "<\\/script>";</script>',
    );
    expect(output).toContain('<style>body { color: red; } <\\/style></style>');
    expect(output).not.toContain('src=');
    expect(output).not.toContain('href="/assets/');
  });

  test('rejects unknown script and stylesheet asset references', () => {
    expect(() =>
      inlineMcpAssets('<script src="https://example.invalid/app.js"></script>', {}),
    ).toThrow('MCP App has external assets');
    expect(() => inlineMcpAssets('<link rel="stylesheet" href="/assets/missing.css">', {})).toThrow(
      'MCP App has external assets',
    );
    expect(() => inlineMcpAssets('<link rel="modulepreload" href="/assets/chunk.js">', {})).toThrow(
      'MCP App has external assets',
    );
  });
});
