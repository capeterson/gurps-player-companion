import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdownProcessor.ts';

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
