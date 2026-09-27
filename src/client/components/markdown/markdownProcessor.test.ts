import { describe, expect, it } from 'vitest';
import { RENDER_CACHE_LIMIT, peekRenderedMarkdown, renderMarkdown } from './markdownProcessor.ts';

/**
 * Security & correctness tests for the sanitized markdown pipeline.
 *
 * The invariant under test: raw HTML and scripts in the source must
 * NEVER reach the output as executable markup. They may appear as
 * escaped literal text or be stripped entirely, but never as live
 * HTML elements.
 */
describe('renderMarkdown — security', () => {
  it('escapes a <script> tag to literal text (never emits a live script element)', async () => {
    const out = await renderMarkdown('<script>alert(1)</script>');
    // No live opening or closing tag survives serialization.
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<\/script>/i);
    // The user's literal text is preserved (here as escaped markup).
    expect(out).toContain('alert(1)');
  });

  it('does not honour arbitrary HTML elements', async () => {
    const out = await renderMarkdown('<div onclick="evil()">hi</div>');
    // No live <div> element is emitted.
    expect(out).not.toMatch(/<div/i);
    // The literal characters survive as escaped text the user can see.
    expect(out).toContain('hi');
  });

  it('keeps raw HTML attack shapes as inert text across attributes and namespaces', async () => {
    const cases = [
      '<img src=x onerror="window.__markdownCanary = 1">image canary',
      '<svg onload="window.__markdownCanary = 2"><a href="javascript:alert(1)">svg canary</a></svg>',
      '<a href="data:text/html,<script>alert(1)</script>" onclick="alert(1)">attribute canary</a>',
      '<ScRiPt>alert("mixed case")</ScRiPt>',
      '<iframe srcdoc="<script>alert(1)</script>">frame canary</iframe>',
      '<div title="x" autofocus onfocus=alert(1) \' y">malformed attribute canary',
    ];

    for (const source of cases) {
      const out = await renderMarkdown(source);
      const parsed = document.createElement('div');
      parsed.innerHTML = out;

      expect(
        parsed.querySelector(
          'script, img, svg, iframe, a[onclick], [onerror], [onload], [onfocus]',
        ),
      ).toBeNull();
      expect(parsed.textContent).toContain(source);
    }
  });

  it('neutralizes encoded or mixed-case executable link protocols while retaining safe links', async () => {
    const out = await renderMarkdown(
      '[plain](javascript:alert(1)) [mixed](JaVaScRiPt:alert(2)) [entity](java&#x73;cript:alert(3)) [data](data:text/html,hello) [safe](https://example.com/path?q=one&amp;two) [upper](HTTPS://Example.com/Cased/Path?q=Case#Frag) [mixed-safe](hTtPs://example.com/MiXeD?Q=Value)',
    );
    const parsed = document.createElement('div');
    parsed.innerHTML = out;

    expect([...parsed.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      null,
      null,
      null,
      null,
      'https://example.com/path?q=one&two',
      'https://Example.com/Cased/Path?q=Case#Frag',
      'https://example.com/MiXeD?Q=Value',
    ]);
  });

  it('removes dangerous Markdown image sources and retains safe HTTPS sources', async () => {
    const out = await renderMarkdown(
      '![unsafe script](javascript:alert(1))\n\n![unsafe SVG](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)\n\n![uppercase safe](HTTPS://Example.com/Cased/Path.png?Q=Case)\n\n![safe image](https://example.com/safe.png)',
    );
    const parsed = document.createElement('div');
    parsed.innerHTML = out;
    const images = [...parsed.querySelectorAll('img')];

    expect(images).toHaveLength(4);
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      null,
      null,
      'https://Example.com/Cased/Path.png?Q=Case',
      'https://example.com/safe.png',
    ]);
    expect(images.map((image) => image.getAttribute('alt'))).toEqual([
      'unsafe script',
      'unsafe SVG',
      'uppercase safe',
      'safe image',
    ]);
  });

  it('preserves punctuation, Unicode, RTL text, emoji, and fenced markup as text', async () => {
    const source = [
      'Quotes: "double" \'single\' &ampersand; \\ slash — café 東京 مرحبا 🐉',
      '',
      '```html',
      '<img src=x onerror="alert(1)">',
      '```',
    ].join('\n');
    const out = await renderMarkdown(source);
    const parsed = document.createElement('div');
    parsed.innerHTML = out;

    expect(parsed.querySelector('img, script')).toBeNull();
    expect(parsed.textContent).toContain(
      'Quotes: "double" \'single\' &ampersand; \\ slash — café 東京 مرحبا 🐉',
    );
    expect(parsed.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(out).toContain('<pre><code class="language-html">');
  });

  it('strips dangerous link protocols via the sanitizer', async () => {
    const out = await renderMarkdown('[click](javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('renders an empty string to empty output', async () => {
    expect(await renderMarkdown('')).toBe('');
  });

  it('returns empty output on thrown pipeline errors', async () => {
    // Non-string input is typed out, but the function tolerates it
    // without throwing (returns '').
    // @ts-expect-error — intentionally passing garbage
    expect(await renderMarkdown(null)).toBe('');
  });
});

describe('renderMarkdown — markdown rendering', () => {
  it('renders headings and paragraphs', async () => {
    const out = await renderMarkdown('# Title\n\nA paragraph.');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<p>A paragraph.</p>');
  });

  it('renders emphasis and strong', async () => {
    const out = await renderMarkdown('**bold** and *ital*');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>ital</em>');
  });

  it('renders bullet and ordered lists', async () => {
    const out = await renderMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>first</li>');
  });

  it('renders a GFM table', async () => {
    const out = await renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>a</th>');
    expect(out).toContain('<td>1</td>');
  });

  it('renders a fenced code block (text only, no execution)', async () => {
    const out = await renderMarkdown('```\nlet x = 1;\n```');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('let x = 1;');
  });

  it('renders a safe https link', async () => {
    const out = await renderMarkdown('[docs](https://example.com)');
    expect(out).toContain('<a href="https://example.com"');
  });

  it('renders blockquote, hr, strikethrough, and task list (GFM)', async () => {
    const out = await renderMarkdown('> quoted\n\n---\n\n~~struck~~\n\n- [ ] done');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<hr');
    expect(out).toContain('<del>struck</del>');
    expect(out).toContain('type="checkbox"');
  });
});

describe('renderMarkdown — render cache', () => {
  it('serves a rendered source synchronously and evicts the least recently used entry', async () => {
    const first = 'cache **first** entry';
    expect(peekRenderedMarkdown(first)).toBeUndefined();
    const html = await renderMarkdown(first);
    expect(html).toContain('<strong>first</strong>');
    expect(peekRenderedMarkdown(first)).toBe(html);

    for (let index = 0; index < RENDER_CACHE_LIMIT; index++) {
      expect(peekRenderedMarkdown(first)).toBe(html);
      await renderMarkdown(`filler ${index}`);
    }
    // Reading refreshes recency, so the oldest untouched filler is evicted instead.
    expect(peekRenderedMarkdown(first)).toBe(html);
    expect(peekRenderedMarkdown('filler 0')).toBeUndefined();
    expect(peekRenderedMarkdown('')).toBe('');
  });
});
