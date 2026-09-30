import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useDialogState } from './useDialogState.ts';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

function ConfirmationDialog({ open = true }: { open?: boolean }) {
  const dialogRef = useDialogState(open);
  return (
    <dialog ref={dialogRef} aria-labelledby="confirmation-title">
      <h2 id="confirmation-title">Schedule account purge?</h2>
      <p>This suspends the account after 30 days.</p>
      <button type="button">Cancel</button>
      <button type="button">Schedule purge</button>
    </dialog>
  );
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterAll(() => {
  if (originalShowModal) HTMLDialogElement.prototype.showModal = originalShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) HTMLDialogElement.prototype.close = originalClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDialogState', () => {
  it('renders confirmation content and follows visual viewport resize and scroll offsets', () => {
    const visual = Object.assign(new EventTarget(), {
      offsetLeft: 12,
      offsetTop: 18,
      width: 360,
      height: 640,
    });
    vi.stubGlobal('visualViewport', visual);

    const { container } = render(<ConfirmationDialog />);
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('data-viewport-bounded', 'true');
    expect(screen.getByRole('heading', { name: 'Schedule account purge?' })).toBeVisible();
    expect(screen.getByText('This suspends the account after 30 days.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Schedule purge' })).toBeVisible();
    expect(dialog?.style.getPropertyValue('--dialog-viewport-left')).toBe('12px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-top')).toBe('18px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-width')).toBe('360px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-height')).toBe('640px');

    visual.offsetLeft = 30;
    visual.offsetTop = 42;
    visual.width = 320;
    visual.height = 480;
    visual.dispatchEvent(new Event('resize'));
    expect(dialog?.style.getPropertyValue('--dialog-viewport-left')).toBe('30px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-top')).toBe('42px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-width')).toBe('320px');
    expect(dialog?.style.getPropertyValue('--dialog-viewport-height')).toBe('480px');

    visual.offsetTop = 72;
    visual.dispatchEvent(new Event('scroll'));
    expect(dialog?.style.getPropertyValue('--dialog-viewport-top')).toBe('72px');
  });

  it('removes visual viewport listeners when the dialog unmounts', () => {
    const visual = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      width: 320,
      height: 480,
    });
    vi.stubGlobal('visualViewport', visual);

    const { container, unmount } = render(<ConfirmationDialog />);
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    const initialTop = dialog?.style.getPropertyValue('--dialog-viewport-top');
    unmount();

    visual.offsetTop = 99;
    visual.height = 300;
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    expect(dialog?.style.getPropertyValue('--dialog-viewport-top')).toBe(initialTop);
    expect(dialog?.style.getPropertyValue('--dialog-viewport-height')).toBe('480px');
  });
});
