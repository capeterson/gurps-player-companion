/** Locate the editing end without changing the user's selection or draft. */
export function editingFocusBounds(element: HTMLElement): DOMRect {
  const bounds = element.getBoundingClientRect();
  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (selection?.focusNode && element.contains(selection.focusNode)) {
      const caret = document.createRange();
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
      const rect = caret.getBoundingClientRect();
      if (rect.height > 0) return rect;
    }
  }
  if (!(element instanceof HTMLTextAreaElement)) return bounds;

  // Textareas do not expose a DOM Range. Mirror their text layout, then subtract
  // the internal scroll so the marker represents the visible editing end.
  const mirror = document.createElement('div');
  const style = getComputedStyle(element);
  for (const property of [
    'box-sizing',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-align',
    'text-indent',
    'tab-size',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${element.clientWidth + Number.parseFloat(style.borderLeftWidth || '0') + Number.parseFloat(style.borderRightWidth || '0')}px`,
    borderStyle: 'solid',
    whiteSpace: element.wrap === 'off' ? 'pre' : 'pre-wrap',
    overflowWrap: 'break-word',
  });
  const offset =
    element.selectionDirection === 'backward' ? element.selectionStart : element.selectionEnd;
  mirror.textContent = element.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker, document.createTextNode(element.value.slice(offset)));
  document.body.append(mirror);
  try {
    const caret = marker.getBoundingClientRect();
    return new DOMRect(
      caret.x - element.scrollLeft,
      caret.y - element.scrollTop,
      caret.width,
      caret.height,
    );
  } finally {
    mirror.remove();
  }
}
