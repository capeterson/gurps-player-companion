/**
 * <Markdown> — renders sanitized markdown as HTML.
 *
 * The source string is run through `renderMarkdown` (remark/rehype +
 * sanitize, raw HTML escaped to literal text — see markdownProcessor).
 * The resulting HTML is injected via `dangerouslySetInnerHTML`; it is
 * safe because the pipeline never interprets raw HTML/scripts and
 * runs rehype-sanitize as defense-in-depth.
 *
 * The pipeline is async, so we render nothing until the sanitized HTML
 * settles. Switching `source` re-runs the pipeline; identical input is
 * short-circuited so re-renders don't flicker.
 */

import { useEffect, useState } from 'react';
import { renderMarkdown } from './markdownProcessor.ts';

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    renderMarkdown(source).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const cls = `markdown-body${className ? ` ${className}` : ''}`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: `html` is produced by the sanitized remark/rehype pipeline in markdownProcessor, which never interprets raw HTML/scripts (raw nodes become escaped text) and runs rehype-sanitize as defense-in-depth. Safe to inject.
  return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}
