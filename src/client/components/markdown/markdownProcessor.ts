/**
 * Sanitized markdown -> HTML pipeline.
 *
 * Security contract (see AGENTS.md and the adventure-log plan):
 *
 *   Raw HTML and <script> in the source MUST NEVER reach the DOM as
 *   markup. This pipeline:
 *
 *     1. Parses markdown (CommonMark via remark-parse + GFM tables /
 *        task lists / strikethrough via remark-gfm). Raw HTML in the
 *        source is captured as `html` mdast nodes — NOT executed.
 *     2. remark-rehype with `allowDangerousHtml: true` forwards those
 *        raw spans to the hast tree as `raw` nodes (still inert —
 *        hast `raw` is an opaque string, never parsed as elements).
 *     3. `rehypeEscapeRaw` (below) rewrites every `raw` node into a
 *        plain `text` node carrying the original literal characters.
 *        rehype-stringify HTML-escapes text node values, so
 *        `<script>alert(1)</script>` serializes to
 *        `&lt;script&gt;alert(1)&lt;/script&gt;` — the user sees their
 *        literal text, the browser never parses it.
 *     4. rehype-sanitize with its default schema strips/neutralizes
 *        anything that slipped through as defense-in-depth (e.g.
 *        `javascript:` link URLs, disallowed attributes). With raw
 *        nodes already converted to text this is belt-and-suspenders,
 *        but it stays so the pipeline remains safe even if a future
 *        plugin reintroduces element nodes.
 *
 * Nothing here executes or interprets HTML. The output is a sanitized
 * HTML string safe to inject via `dangerouslySetInnerHTML`.
 *
 * The pipeline is created once and reused; `renderMarkdown` is the
 * single entrypoint used by both the <Markdown/> component and tests.
 */

import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/** A hast `raw` node (carries literal HTML characters as `value`). */
interface RawNode {
  type: 'raw';
  value: string;
}

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

/**
 * Rewrite every `raw` hast node into a `text` node carrying the same
 * literal characters. rehype-stringify HTML-escapes text values on
 * serialization, so the original markup is shown verbatim to the user
 * without the browser ever interpreting it.
 *
 * Walking manually (rather than via `unist-util-visit`) keeps the
 * dependency surface small and the traversal order obvious.
 */
function rehypeEscapeRaw() {
  return (tree: Node) => walk(tree);
  function walk(node: Node): void {
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) continue;
      if (child.type === 'raw') {
        const raw = child as unknown as RawNode;
        node.children[i] = { type: 'text', value: raw.value } as Node;
      } else {
        walk(child);
      }
    }
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeEscapeRaw)
  // Defense-in-depth: even though raw HTML is now inert text, keep the
  // sanitizer in the pipeline so any element nodes the markdown itself
  // produces stay within the safe allowlist (e.g. it rewrites dangerous
  // link protocols to null hrefs).
  .use(rehypeSanitize, defaultSchema)
  .use(rehypeStringify);

/**
 * Render a markdown source string to a sanitized HTML string.
 *
 * Never throws on malformed input; an empty/failed render yields ''.
 */
export async function renderMarkdown(src: string): Promise<string> {
  if (!src) return '';
  try {
    const file = await processor.process(src);
    return String(file);
  } catch {
    return '';
  }
}

export { rehypeEscapeRaw };
export type { RawNode };
