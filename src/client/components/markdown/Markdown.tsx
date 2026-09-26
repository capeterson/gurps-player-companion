/**
 * <Markdown> — renders sanitized markdown as HTML.
 *
 * The source string is run through `renderMarkdown` (remark/rehype +
 * sanitize, raw HTML escaped to literal text — see markdownProcessor).
 * The resulting HTML is injected via `dangerouslySetInnerHTML`; it is
 * safe because the pipeline never interprets raw HTML/scripts and
 * runs rehype-sanitize as defense-in-depth.
 *
 * The pipeline is async, so a new source renders nothing until the
 * sanitized HTML settles. Recently rendered sources come from the
 * processor's LRU synchronously, so remounts in long lists neither
 * re-parse nor flicker.
 */

import { useEffect, useState } from 'react';
import { peekRenderedMarkdown, renderMarkdown } from './markdownProcessor.ts';

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps) {
  // Recently rendered sources resolve synchronously so remounts don't flash empty.
  const cached = peekRenderedMarkdown(source);
  const [rendered, setRendered] = useState(() => cached ?? '');

  useEffect(() => {
    if (peekRenderedMarkdown(source) !== undefined) return;
    let cancelled = false;
    renderMarkdown(source).then((html) => {
      if (!cancelled) setRendered(html);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const html = cached ?? rendered;
  const cls = `markdown-body${className ? ` ${className}` : ''}`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: `html` is produced by the sanitized remark/rehype pipeline in markdownProcessor, which never interprets raw HTML/scripts (raw nodes become escaped text) and runs rehype-sanitize as defense-in-depth. Safe to inject.
  return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}
