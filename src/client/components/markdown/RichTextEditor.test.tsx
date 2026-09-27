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
});
