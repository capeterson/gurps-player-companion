import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const longDescription = Array.from(
  { length: 24 },
  (_, index) =>
    `Synthetic paragraph ${index + 1}: a long library description with ordinary wrapped prose, several sentences, and enough detail to make the rich text editor taller than the visible editing area. Players can continue reading, correcting, and extending descriptions as they move between portrait and landscape screens. This paragraph contains no unusually long unbroken token.`,
).join('\n\n');

test.use({
  viewport: { width: 568, height: 320 },
  screen: { width: 568, height: 320 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function createCampaign(page: import('@playwright/test').Page) {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Synthetic library multiline caret QA' },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(
    response.ok(),
    `Campaign creation failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as { id: string };
}

async function putCaretAtFraction(editor: import('@playwright/test').Locator, fraction: number) {
  await editor.evaluate((element, targetFraction) => {
    const editable = element as HTMLElement;
    editable.focus({ preventScroll: true });

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let totalLength = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      nodes.push(text);
      totalLength += text.data.length;
    }
    const lastNode = nodes.at(-1);
    if (!lastNode || totalLength === 0) throw new Error('Rich editor has no selectable text');

    let remaining = Math.floor(totalLength * targetFraction);
    let targetNode = lastNode;
    let targetOffset = targetNode.data.length;
    for (const node of nodes) {
      if (remaining <= node.data.length) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= node.data.length;
    }

    const range = document.createRange();
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) throw new Error('Browser selection is unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  }, fraction);
}

async function expectCollapsedCaretReachable(page: import('@playwright/test').Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const editor = document.querySelector<HTMLElement>('[contenteditable="true"]');
          const selection = window.getSelection();
          if (!editor || !selection?.isCollapsed || selection.rangeCount === 0)
            return 'no collapsed editor caret';
          const range = selection.getRangeAt(0);
          if (!editor.contains(range.startContainer)) return 'caret is outside the rich editor';
          const caret = range.getBoundingClientRect();
          const visual = window.visualViewport;
          const visualTop = visual?.offsetTop ?? 0;
          const visualBottom = visualTop + (visual?.height ?? window.innerHeight);
          const toolbar = document.querySelector('.library-toolbar')?.getBoundingClientRect();
          const toolbarBottom =
            toolbar && toolbar.bottom > visualTop && toolbar.top < visualBottom
              ? toolbar.bottom
              : visualTop;
          const lineHeight = Number.parseFloat(
            getComputedStyle(range.startContainer.parentElement ?? editor).lineHeight,
          );
          const caretHeight = caret.height || (Number.isFinite(lineHeight) ? lineHeight : 16);
          const caretMiddle = caret.top + caretHeight / 2;
          const hit = document.elementFromPoint(caret.left, caretMiddle);
          const details = {
            caret: {
              left: caret.left,
              top: caret.top,
              bottom: caret.top + caretHeight,
              width: caret.width,
              height: caret.height,
            },
            visual: {
              left: visual?.offsetLeft ?? 0,
              top: visualTop,
              right: (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth),
              bottom: visualBottom,
              scale: visual?.scale ?? 1,
            },
            toolbarBottom,
            hit: hit?.tagName,
            hitInsideEditor: !!hit && editor.contains(hit),
            scroll: { x: scrollX, y: scrollY },
          };
          if (
            caret.left >= (visual?.offsetLeft ?? 0) &&
            caret.left <= (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) &&
            caret.top >= toolbarBottom + 1 &&
            caret.top + caretHeight <= visualBottom - 1 &&
            details.hitInsideEditor
          )
            return true;
          return JSON.stringify(details);
        }),
      {
        timeout: 2500,
        message:
          'Collapsed text caret should remain visible in the visual viewport below the sticky library toolbar',
      },
    )
    .toBe(true);
}

async function expectFooterPointerReachable(button: import('@playwright/test').Locator) {
  await expect
    .poll(async () => {
      // Zoom and caret reflow can move the footer after an earlier scroll.
      // Reapply the scroll while checking the actual viewport and pointer hit.
      await button.scrollIntoViewIfNeeded();
      return button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const visual = window.visualViewport;
        const visualTop = visual?.offsetTop ?? 0;
        const visualBottom = visualTop + (visual?.height ?? innerHeight);
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const toolbarBottom =
          document.querySelector('.library-toolbar')?.getBoundingClientRect().bottom ?? 0;
        return (
          bounds.left >= (visual?.offsetLeft ?? 0) &&
          bounds.right <= (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) &&
          bounds.top >= Math.max(visualTop, toolbarBottom) &&
          bounds.bottom <= visualBottom &&
          !!hit &&
          (hit === element || element.contains(hit))
        );
      });
    })
    .toBe(true);
}

async function expectTextareaCaretReachable(textarea: import('@playwright/test').Locator) {
  await expect
    .poll(() =>
      textarea.evaluate((element) => {
        const input = element as HTMLTextAreaElement;
        const bounds = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        const mirror = document.createElement('div');
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
          width: `${input.clientWidth + Number.parseFloat(style.borderLeftWidth || '0') + Number.parseFloat(style.borderRightWidth || '0')}px`,
          borderStyle: 'solid',
          whiteSpace: input.wrap === 'off' ? 'pre' : 'pre-wrap',
          overflowWrap: 'break-word',
        });
        const offset =
          input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
        mirror.textContent = input.value.slice(0, offset);
        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        mirror.append(marker, document.createTextNode(input.value.slice(offset)));
        document.body.append(mirror);
        const markerBounds = marker.getBoundingClientRect();
        const caretLeft = markerBounds.left - input.scrollLeft;
        const caretTop = markerBounds.top - input.scrollTop;
        const caretBottom =
          caretTop + (markerBounds.height || Number.parseFloat(style.lineHeight) || 16);
        mirror.remove();

        const visual = window.visualViewport;
        const visualTop = visual?.offsetTop ?? 0;
        const visualBottom = visualTop + (visual?.height ?? innerHeight);
        const toolbar = document.querySelector('.library-toolbar')?.getBoundingClientRect();
        const toolbarBottom =
          toolbar && toolbar.bottom > visualTop && toolbar.top < visualBottom
            ? toolbar.bottom
            : visualTop;
        const lineHeight =
          Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
        const textBottom =
          bounds.bottom -
          Number.parseFloat(style.borderBottomWidth || '0') -
          Number.parseFloat(style.paddingBottom || '0');
        const endLineTop = textBottom - lineHeight;
        const hit = document.elementFromPoint(
          caretLeft + 1,
          caretTop + (caretBottom - caretTop) / 2,
        );
        const result = {
          caret: {
            left: caretLeft,
            top: caretTop,
            bottom: caretBottom,
            markerTop: markerBounds.top - input.scrollTop,
          },
          endLine: { top: endLineTop, bottom: textBottom, height: lineHeight },
          input: {
            top: bounds.top,
            bottom: bounds.bottom,
            scrollTop: input.scrollTop,
            scrollHeight: input.scrollHeight,
            clientHeight: input.clientHeight,
            selectionStart: input.selectionStart,
            selectionEnd: input.selectionEnd,
            valueLength: input.value.length,
          },
          visual: {
            left: visual?.offsetLeft ?? 0,
            top: visualTop,
            right: (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth),
            bottom: visualBottom,
            scale: visual?.scale ?? 1,
          },
          toolbarBottom,
          hitInsideInput: !!hit && (hit === input || input.contains(hit)),
        };
        const caretVisible =
          caretLeft >= (visual?.offsetLeft ?? 0) &&
          caretLeft <= (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) &&
          caretTop >= Math.max(visualTop, toolbarBottom) &&
          caretBottom <= visualBottom &&
          endLineTop >= Math.max(visualTop, toolbarBottom) &&
          textBottom <= visualBottom &&
          bounds.bottom <= visualBottom &&
          result.hitInsideInput;
        const selectionAtEnd =
          input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
        const scrolledToEnd =
          input.scrollTop + input.clientHeight >= input.scrollHeight - lineHeight;
        return caretVisible && selectionAtEnd && scrolledToEnd ? true : JSON.stringify(result);
      }),
    )
    .toBe(true);
}

test('long library rich-text caret stays reachable through resize, rotation, zoom, typing, and save', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-multiline-focus-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Library Multiline Focus QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).tap();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = await createCampaign(page);
  await page.goto(`/campaigns/${campaign.id}/library?section=traits`);
  await page.getByRole('button', { name: '+ Add trait', exact: true }).tap();
  await page
    .getByRole('textbox', { name: 'Name' })
    .fill('Synthetic multiline caret regression trait');

  await page.getByLabel('Description setting').selectOption('value');
  const editor = page.locator('[contenteditable="true"]');
  await editor.fill(longDescription);
  await expect(editor).toContainText('Synthetic paragraph 24');

  const cases = [
    { width: 568, height: 320, fraction: 0.04, marker: 'caret-beginning-' },
    { width: 320, height: 568, fraction: 0.5, marker: 'caret-middle-' },
    { width: 568, height: 320, fraction: 0.96, marker: 'caret-end-' },
    { width: 639, height: 320, fraction: 0.08, marker: 'caret-639-' },
    { width: 640, height: 320, fraction: 0.5, marker: 'caret-640-' },
    { width: 641, height: 320, fraction: 0.92, marker: 'caret-641-' },
  ];
  for (const viewport of cases) {
    await test.step(`${viewport.width}×${viewport.height} caret`, async () => {
      await putCaretAtFraction(editor, viewport.fraction);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectCollapsedCaretReachable(page);
      await page.keyboard.type(viewport.marker);
      await expect(editor).toContainText(viewport.marker);
      await expectCollapsedCaretReachable(page);
      if ([320, 639, 640, 641].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`library-caret-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }

  const cdp = await page.context().newCDPSession(page);
  for (const scale of [1.25, 1.5]) {
    await putCaretAtFraction(editor, 0.98);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await expectCollapsedCaretReachable(page);
    const marker = `caret-zoom-${String(scale).replace('.', '-')}-`;
    await page.keyboard.type(marker);
    await expect(editor).toContainText(marker);
    await expectCollapsedCaretReachable(page);
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`library-caret-zoom-${scale}.png`),
      animations: 'disabled',
    });
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

  await page.setViewportSize({ width: 568, height: 320 });
  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  const source = page.getByRole('textbox', { name: 'Description' });
  await source.focus();
  await source.press('Control+End');
  await expectTextareaCaretReachable(source);
  for (const scale of [1.25, 1.5]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await expectTextareaCaretReachable(source);
    const marker = `source-zoom-${String(scale).replace('.', '-')}-`;
    await page.keyboard.type(marker);
    await expect(source).toHaveValue(new RegExp(marker));
    await expectTextareaCaretReachable(source);
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`library-source-caret-zoom-${scale}.png`),
      animations: 'disabled',
    });
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.getByRole('button', { name: 'Back to rich text' }).click();

  const finalMarker = 'final-saved-marker-';
  await putCaretAtFraction(editor, 0.999);
  await expectCollapsedCaretReachable(page);
  await page.keyboard.type(finalMarker);
  await expect(editor).toContainText(finalMarker);
  await expectCollapsedCaretReachable(page);

  const add = page.getByRole('button', { name: 'Add trait', exact: true });
  await expectFooterPointerReachable(add);
  await add.tap();
  const trait = page.getByRole('button', {
    name: 'Synthetic multiline caret regression trait',
    exact: true,
  });
  await expect(trait).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('button', { name: 'Edit Synthetic multiline caret regression trait', exact: true })
    .tap();
  const savedEditor = page.locator('[contenteditable="true"]');
  await expect(savedEditor.locator('p')).toHaveCount(24);
  await expect(savedEditor).toContainText('unusually long unbroken token.');
  await expect(savedEditor).toContainText(finalMarker);
  await page
    .getByRole('textbox', { name: 'Name' })
    .fill('Synthetic multiline caret regression trait saved from edit');
  const saveChanges = page.getByRole('button', { name: 'Save changes', exact: true });
  await expectFooterPointerReachable(saveChanges);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('library-edit-save-changes-reachable.png'),
    animations: 'disabled',
  });
  await saveChanges.tap();
  await expect(
    page.getByRole('button', {
      name: 'Synthetic multiline caret regression trait saved from edit',
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
});
