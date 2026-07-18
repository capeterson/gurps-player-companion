/**
 * <RichTextEditor> — WYSIWYG markdown editor backed by Tiptap.
 *
 * The source of truth exchanged with the parent is a **markdown string**
 * (the same format stored in `adventure_log_entries.body`). Tiptap edits
 * an in-memory ProseMirror document; `tiptap-markdown` serializes it to
 * markdown on every change and parses markdown back into the doc when
 * the parent pushes a new value.
 *
 * The formatting toolbar is always visible. Its trailing button toggles
 * between two editor surfaces of identical width:
 *
 *   - `'rich'`   — the Tiptap WYSIWYG surface (toolbar buttons active).
 *   - `'source'`  — a plain <textarea> bound to the raw markdown string,
 *                   wrapped to match the rich surface's outer box.
 *
 * Switching surfaces carries state across: rich -> source serializes the
 * current doc; source -> rich re-parses the textarea text. Neither mode
 * ever interprets raw HTML — Tiptap's markdown parser only honours
 * CommonMark/GFM syntax, and the rendered body downstream is sanitized
 * by <Markdown>. The editor never produces or persists HTML.
 */

import { Link as TiptapLink } from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useState } from 'react';
import { Markdown as TiptapMarkdown } from 'tiptap-markdown';
import { Markdown } from './Markdown.tsx';

export type EditorMode = 'rich' | 'source';

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "What happened, who acted, what's left to follow up on…",
  id,
  className,
}: RichTextEditorProps) {
  const [mode, setMode] = useState<EditorMode>('rich');
  // Raw-markdown buffer shown in source mode. Kept in state so the
  // <textarea> re-renders as the user types; mirrored into the editor
  // when switching back to rich mode.
  const [sourceText, setSourceText] = useState<string>(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      // Link mark. tiptap-markdown serializes this to `[text](href)`
      // and rehype-sanitize (in the render pipeline) neutralizes any
      // dangerous protocol (`javascript:`, etc.) to a null href at
      // render time — so even a pasted malicious URL is safe downstream.
      // `openOnClick: false` keeps the WYSIWYG editable without
      // navigating away on an accidental click.
      TiptapLink.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      // Serializes/parses the ProseMirror doc <-> markdown. The stored
      // body stays markdown; the editor never emits or persists HTML.
      TiptapMarkdown.configure({
        html: false,
        breaks: false,
        linkify: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'rich-text-surface',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor: e }) => {
      // tiptap-markdown attaches its serializer to editor.storage.markdown.
      const md = (e.storage as { markdown?: MarkdownStore }).markdown;
      const out = md ? md.getMarkdown() : '';
      setSourceText(out);
      onChange(out);
    },
  });

  // When the parent pushes a new value that differs from what the
  // editor already shows (e.g. after loading a draft or a reset to
  // empty), resync the doc without clobbering in-progress edits.
  useEffect(() => {
    if (!editor) return;
    const md = (editor.storage as { markdown?: MarkdownStore }).markdown;
    const current = md ? md.getMarkdown() : '';
    if (value !== current) {
      setSourceText(value);
      editor.commands.setContent(value || '', false);
    }
  }, [value]);

  const switchToSource = () => {
    if (editor) {
      const md = (editor.storage as { markdown?: MarkdownStore }).markdown;
      setSourceText(md ? md.getMarkdown() : '');
    }
    setMode('source');
  };

  const switchToRich = () => {
    const md = sourceText;
    if (editor) {
      editor.commands.setContent(md || '', false);
      onChange(md);
    }
    setMode('rich');
  };

  return (
    <div className={`rich-text-editor ${className ?? ''}`}>
      <div className="rich-text-toolbar">
        <ToolbarButton
          label="Bold"
          active={mode === 'rich' && !!editor?.isActive('bold')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={mode === 'rich' && !!editor?.isActive('italic')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={mode === 'rich' && !!editor?.isActive('strike')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          label="Heading"
          active={mode === 'rich' && !!editor?.isActive('heading', { level: 2 })}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={mode === 'rich' && !!editor?.isActive('bulletList')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={mode === 'rich' && !!editor?.isActive('orderedList')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={mode === 'rich' && !!editor?.isActive('blockquote')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          ”
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={mode === 'rich' && !!editor?.isActive('codeBlock')}
          disabled={mode !== 'rich'}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          {'</>'}
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={mode === 'rich' && !!editor?.isActive('link')}
          disabled={mode !== 'rich'}
          onClick={() => insertLink(editor)}
        >
          <LinkIcon />
        </ToolbarButton>
        {/* Spacer pushes the mode toggle to the right edge. */}
        <span className="rich-text-toolbar-spacer" aria-hidden="true" />
        <ToolbarButton
          label={mode === 'rich' ? 'Edit raw markdown' : 'Back to rich text'}
          active={mode === 'source'}
          onClick={mode === 'rich' ? switchToSource : switchToRich}
        >
          {mode === 'rich' ? '</>' : '✎'}
        </ToolbarButton>
      </div>

      {mode === 'rich' ? (
        <EditorContent editor={editor} className="rich-text-surface-wrap" />
      ) : (
        <div className="rich-text-surface-wrap rich-text-source-wrap">
          <textarea
            id={id}
            className="rich-text-source-input"
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              onChange(e.target.value);
            }}
            placeholder={placeholder}
          />
          <details className="rich-text-preview">
            <summary className="cursor-pointer text-xs text-muted">Preview</summary>
            <Markdown source={sourceText} className="mt-2" />
          </details>
        </div>
      )}
    </div>
  );
}

interface MarkdownStore {
  getMarkdown: () => string;
}

/**
 * Toolbar "Link" flow. Prompts for a URL and:
 *
 *   - if the cursor was inside a link and the user cleared the prompt,
 *     unlinks the existing mark (toggle-off UX);
 *   - if there is an extended selection, applies the link mark to it;
 *   - if there is no selection, inserts the URL as a fresh linked text
 *     node (so the user can see and edit the visible label afterwards).
 *
 * URLs are normalised so a bare `example.com` becomes
 * `https://example.com`. Downstream safety comes from the sanitized
 * render pipeline — `rehype-sanitize`'s default schema strips dangerous
 * protocols (`javascript:`, `data:` for link hrefs, etc.) to a null
 * href, so even a malicious URL the user pastes is inert in the
 * rendered body.
 */
function insertLink(editor: ReturnType<typeof useEditor>) {
  if (!editor) return;
  const previousHref = (editor.getAttributes('link').href as string | undefined) ?? '';
  const url = window.prompt('Link URL:', previousHref || 'https://');
  if (url === null) return; // cancelled
  if (url.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  const href = normalizeUrl(url);
  if (editor.state.selection.empty) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: href,
        marks: [{ type: 'link', attrs: { href } }],
      })
      .run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

/** Prepend `https://` when the user typed a schemeless host. */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed; // already has a scheme (http:, mailto:, tel:)
  return `https://${trimmed}`;
}

/** Feather-style link icon. Sized to match the toolbar's 0.875rem text. */
function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

interface ToolbarButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

function ToolbarButton({ label, active, onClick, disabled, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`rich-text-toolbar-btn${active ? ' on' : ''}${disabled ? ' dim' : ''}`}
      onClick={onClick}
      // Prevent the button from stealing focus from the editor surface.
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
