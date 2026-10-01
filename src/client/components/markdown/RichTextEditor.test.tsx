import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor.tsx';

describe('RichTextEditor — markdown safety and round trips', () => {
  it('keeps raw HTML source inert in preview and when switching editor modes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const canary = '<img src=x onerror="window.__markdownCanary = 1"> café 東京 مرحبا 🐉';
    const { container } = render(
      <RichTextEditor value="safe" onChange={onChange} aria-label="Adventure body" />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    const source = screen.getByRole('textbox', { name: 'Adventure body' });
    fireEvent.change(source, { target: { value: canary } });

    await user.click(container.querySelector('.rich-text-preview summary') as HTMLElement);
    const preview = container.querySelector('.rich-text-preview .markdown-body');
    await waitFor(() => expect(preview).toBeVisible());
    await waitFor(() => expect(preview?.textContent).toContain(canary));
    expect(preview?.querySelector('img, script, svg, iframe')).toBeNull();
    expect(preview?.querySelector('[onerror]')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(canary);
    const previewTextBeforeModeSwitch = preview?.textContent?.replace(/\s+/g, ' ').trim();

    await user.click(screen.getByRole('button', { name: 'Back to rich text' }));
    const richSurface = container.querySelector<HTMLElement>('[contenteditable="true"]');
    await waitFor(() => expect(richSurface).toBeVisible());
    await waitFor(() => expect(richSurface?.textContent).toContain(canary));
    expect(richSurface?.querySelector('img, script, svg, iframe')).toBeNull();
    expect(richSurface?.querySelector('[onerror]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    await user.click(container.querySelector('.rich-text-preview summary') as HTMLElement);
    const updatedPreview = container.querySelector('.rich-text-preview .markdown-body');
    await waitFor(() => expect(updatedPreview).toBeVisible());
    await waitFor(() =>
      expect(updatedPreview?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        previewTextBeforeModeSwitch,
      ),
    );
    expect(updatedPreview?.querySelector('img, script, svg, iframe, [onerror]')).toBeNull();
  });

  it('round-trips ordinary punctuation, Unicode, formatting, and safe links', async () => {
    const user = userEvent.setup();
    const value =
      'Quoted "text", café 東京 مرحبا 🐉 & ampersands\\slash —\n\n**strong** and [safe](https://example.com)';
    const { container } = render(
      <RichTextEditor value={value} onChange={() => undefined} aria-label="Description" />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    await user.click(container.querySelector('.rich-text-preview summary') as HTMLElement);
    const preview = container.querySelector('.rich-text-preview .markdown-body');
    await waitFor(() => expect(preview).toBeVisible());
    await waitFor(() => expect(preview?.textContent).toContain('café 東京 مرحبا 🐉'));
    const visibleText = preview?.textContent?.replace(/\s+/g, ' ').trim();
    expect(preview?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');

    await user.click(screen.getByRole('button', { name: 'Back to rich text' }));
    await user.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    await user.click(container.querySelector('.rich-text-preview summary') as HTMLElement);
    const updatedPreview = container.querySelector('.rich-text-preview .markdown-body');
    await waitFor(() => expect(updatedPreview).toBeVisible());
    await waitFor(() =>
      expect(updatedPreview?.textContent?.replace(/\s+/g, ' ').trim()).toBe(visibleText),
    );
    expect(updatedPreview?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('preserves GFM tables in source mode when loading, editing, and opening preview', async () => {
    const user = userEvent.setup();
    const value = [
      '| Participant | Observation |',
      '| --- | --- |',
      '| Scout | The eastern gate is open |',
    ].join('\n');
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor value={value} onChange={onChange} aria-label="Adventure body" />,
    );

    const source = screen.getByRole('textbox', { name: 'Adventure body' });
    expect(source).toHaveValue(value);
    expect(screen.getByRole('status')).toHaveTextContent(
      'This entry has a table. Edit it in Markdown mode to keep the table.',
    );
    expect(screen.getByRole('button', { name: 'Rich text unavailable for tables' })).toBeDisabled();

    const edited = `${value}\n| Healer | The party is ready |`;
    fireEvent.change(source, { target: { value: edited } });
    expect(onChange).toHaveBeenLastCalledWith(edited);

    await user.click(container.querySelector('.rich-text-preview summary') as HTMLElement);
    const preview = container.querySelector('.rich-text-preview .markdown-body');
    await waitFor(() => expect(preview).toBeVisible());
    expect(preview?.querySelectorAll('table tr')).toHaveLength(3);
    expect(preview?.textContent).toContain('The party is ready');
    expect(source).toHaveValue(edited);
  });

  it('locks rich mode when a table is entered in source and unlocks after removal', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor value="An observation." onChange={onChange} aria-label="Adventure body" />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit raw markdown' }));

    const value = [
      'An observation.',
      '',
      '| Participant | Observation |',
      '| --- | --- |',
      '| Scout | The eastern gate is open |',
    ].join('\n');
    const source = screen.getByRole('textbox', { name: 'Adventure body' });
    fireEvent.change(source, { target: { value } });
    expect(source).toHaveValue(value);
    expect(onChange).toHaveBeenLastCalledWith(value);
    expect(screen.getByRole('button', { name: 'Rich text unavailable for tables' })).toBeDisabled();

    const withoutTable = 'An observation.\n\nThe eastern gate is open.';
    fireEvent.change(source, { target: { value: withoutTable } });
    const richToggle = screen.getByRole('button', { name: 'Back to rich text' });
    expect(richToggle).toBeEnabled();
    await user.click(richToggle);
    await waitFor(() =>
      expect(container.querySelector('.rich-text-surface')).toHaveTextContent(
        'The eastern gate is open.',
      ),
    );
  });
});
