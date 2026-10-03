import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

test('app update toast keeps its message and buttons readable inside the viewport', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

  for (const state of ['available', 'outdated'] as const) {
    await page.evaluate((state) => {
      window.dispatchEvent(
        state === 'available'
          ? new CustomEvent('gpc:sw-update-ready', {
              detail: {
                reload: () => document.body.setAttribute('data-reload-clicked', 'true'),
              },
            })
          : new CustomEvent('gpc:client-outdated'),
      );
    }, state);

    const message =
      state === 'available'
        ? 'A new version of the app is available.'
        : 'Updating the app so your changes can sync. It will reload shortly.';
    const alert = page.getByRole('alert').filter({ hasText: message });
    const action = alert.getByRole('button', {
      name: state === 'available' ? 'Reload' : 'Reload now',
      exact: true,
    });
    const dismiss = alert.getByRole('button', { name: 'Dismiss notification' });

    // Reuse the same page across mobile widths and either side of the toast's
    // 640px breakpoint (and daisyUI's 768px breakpoint).
    for (const width of [320, 393, 639, 640, 641, 767, 768, 769, 1024]) {
      await page.setViewportSize({ width, height: 720 });
      await expect(alert.getByText(message, { exact: true })).toBeVisible();
      await expect(action).toBeVisible();
      await expect(dismiss).toBeVisible();

      const geometry = await alert.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const viewport = window.visualViewport;
        const parts = [...element.children].map((child) => {
          const bounds = child.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(child);
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            text: [...range.getClientRects()].map((line) => ({
              left: line.left,
              top: line.top,
              right: line.right,
              bottom: line.bottom,
            })),
          };
        });
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          overflow: element.scrollWidth > element.clientWidth,
          viewport: {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
            bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
          },
          parts,
        };
      });

      expect(geometry.left).toBeGreaterThanOrEqual(geometry.viewport.left - 1);
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewport.top - 1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport.right + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + 1);
      expect(geometry.overflow).toBe(false);
      for (const part of geometry.parts) {
        expect(part.left).toBeGreaterThanOrEqual(geometry.left);
        expect(part.top).toBeGreaterThanOrEqual(geometry.top);
        expect(part.right).toBeLessThanOrEqual(geometry.right);
        expect(part.bottom).toBeLessThanOrEqual(geometry.bottom);
        for (const line of part.text) {
          expect(line.left).toBeGreaterThanOrEqual(part.left - 1);
          expect(line.right).toBeLessThanOrEqual(part.right + 1);
          expect(line.top).toBeGreaterThanOrEqual(part.top - 1);
          expect(line.bottom).toBeLessThanOrEqual(part.bottom + 1);
        }
      }
      expect(geometry.parts[1]?.text).toHaveLength(1);
      expect(geometry.parts[0]?.right).toBeLessThanOrEqual(geometry.parts[1]?.left ?? 0);
      expect(geometry.parts[1]?.right).toBeLessThanOrEqual(geometry.parts[2]?.left ?? 0);

      if ([320, 640, 1024].includes(width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`update-toast-${state}-${width}.png`),
          animations: 'disabled',
        });
      }
    }

    if (state === 'available') {
      await action.click();
      await expect(page.locator('body')).toHaveAttribute('data-reload-clicked', 'true');
    } else {
      await dismiss.click();
    }
    await expect(alert).toHaveCount(0);
  }
});
