import { type Page, expect, test } from '@playwright/test';
import { Pool } from 'pg';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function create<T>(page: Page, path: string, body: object): Promise<T> {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method: 'POST',
    data: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test('unbroken adventure-log titles wrap inside their cards', async ({ page }, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated log fixtures can be removed',
  );
  test.setTimeout(90_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `adventure-log-responsive-${suffix()}@example.com`;
  const author = 'ExtremelyLongUnbrokenAdventureLogAuthorDisplayNameForNarrowScreens';
  const location = 'ExtremelyLongUnbrokenAdventureLogLocationForNarrowScreens';
  const title = 'TheUnreasonablyLongUnbrokenAdventureLogTitleForNarrowScreens';
  const tableTitle = 'GFM table round trip';
  const longCell = `UnbrokenAdventureLogTableCell${'Detail'.repeat(8)}`;
  const body = `The party recorded this detail: ${'UnbrokenAdventureLogBodyToken'.repeat(18)}`;
  const previewBody = [
    '| Participant | Location | Observation | Follow up |',
    '| --- | --- | --- | --- |',
    `| ${longCell} | ${longCell} | ${longCell} | ${longCell} |`,
  ].join('\n');
  let campaignId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(author);
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const campaign = await create<{ id: string }>(page, '/campaigns', {
      name: 'Responsive log titles',
    });
    campaignId = campaign.id;
    await create(page, `/campaigns/${campaign.id}/log`, {
      sessionDate: '2026-09-30',
      title,
      location,
      body,
    });
    await create(page, `/campaigns/${campaign.id}/log`, {
      sessionDate: '2026-09-29',
      title: 'Session',
      body: 'A short title keeps its ordinary one-line layout.',
    });
    await create(page, `/campaigns/${campaign.id}/log`, {
      sessionDate: '2026-09-28',
      title: tableTitle,
      body: previewBody,
    });

    await page.goto(`/campaigns/${campaign.id}/log`);
    const heading = page.getByRole('heading', { name: title, exact: true });
    const card = page.getByRole('article').filter({ has: heading });
    const authorName = card.getByText(author, { exact: true });
    const locationText = page.getByText(location, { exact: true });
    const bodyText = card.locator('.log-entry-body .markdown-body');
    const ordinaryHeading = page.getByRole('heading', { name: 'Session', exact: true });
    await expect(heading).toBeVisible();
    await expect(authorName).toBeVisible();
    await expect(locationText).toBeVisible();
    await expect(bodyText).toContainText('UnbrokenAdventureLogBodyToken');
    await expect(ordinaryHeading).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`list ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await card.scrollIntoViewIfNeeded();
        const [
          cardBox,
          headingBox,
          titleMetrics,
          authorBox,
          locationBox,
          locationMetrics,
          ordinaryOverflow,
        ] = await Promise.all([
          card.boundingBox(),
          heading.boundingBox(),
          heading.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
          authorName.boundingBox(),
          locationText.boundingBox(),
          locationText.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
          ordinaryHeading.evaluate((element) => element.scrollWidth - element.clientWidth),
        ]);
        expect(cardBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        if (!cardBox || !headingBox) return;
        expect(headingBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(titleMetrics.scrollWidth).toBeLessThanOrEqual(titleMetrics.clientWidth + 1);
        expect(locationMetrics.scrollWidth).toBeLessThanOrEqual(locationMetrics.clientWidth + 1);
        expect(ordinaryOverflow).toBeLessThanOrEqual(1);
        expect(authorBox).not.toBeNull();
        expect(locationBox).not.toBeNull();
        if (!authorBox || !locationBox) return;
        expect(authorBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(authorBox.x + authorBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(locationBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(locationBox.x + locationBox.width).toBeLessThanOrEqual(
          cardBox.x + cardBox.width + 1,
        );
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);

        if ([320, 375, 390, 568, 639, 640, 641, 768, 1024, 1280].includes(viewport.width)) {
          await page.screenshot({
            path: testInfo.outputPath(`log-title-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }

    const editButton = card.getByRole('button', { name: `Edit ${title}` });
    await editButton.click();
    const form = page.getByRole('form', { name: 'Edit adventure log entry' });
    const editBody = form.locator('.rich-text-surface');
    await expect(editBody).toContainText('UnbrokenAdventureLogBodyToken');
    for (const viewport of VIEWPORTS) {
      await test.step(`edit ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await editBody.scrollIntoViewIfNeeded();
        const [surfaceMetrics, documentWidth] = await Promise.all([
          editBody.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
          page.evaluate(() => document.documentElement.scrollWidth),
        ]);
        expect(
          surfaceMetrics.scrollWidth,
          `editor body overflow at ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(surfaceMetrics.clientWidth + 1);
        expect(
          documentWidth,
          `editor page overflow at ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(viewport.width);

        if (viewport.width === 568 && viewport.height === 320) {
          for (const action of [
            form.getByRole('button', { name: 'Cancel', exact: true }),
            form.getByRole('button', { name: 'Save changes', exact: true }),
          ]) {
            await action.scrollIntoViewIfNeeded();
            await expect(action).toBeVisible();
            const [box, visible] = await Promise.all([
              action.boundingBox(),
              page.evaluate(() => {
                const visual = window.visualViewport;
                const left = visual?.offsetLeft ?? 0;
                const top = visual?.offsetTop ?? 0;
                const width = visual?.width ?? window.innerWidth;
                const height = visual?.height ?? window.innerHeight;
                return { left, top, right: left + width, bottom: top + height };
              }),
            ]);
            expect(box).not.toBeNull();
            if (!box) continue;
            expect(box.x).toBeGreaterThanOrEqual(visible.left - 1);
            expect(box.y).toBeGreaterThanOrEqual(visible.top - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(visible.right + 1);
            expect(box.y + box.height).toBeLessThanOrEqual(visible.bottom + 1);
          }
          await page.screenshot({
            path: testInfo.outputPath('log-edit-long-body-568x320.png'),
            animations: 'disabled',
          });
        }
      });
    }

    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: '+ New entry' }).click();
    const newForm = page.getByRole('form', { name: 'New adventure log entry' });
    await newForm.getByRole('button', { name: 'Edit raw markdown' }).click();
    const sourceBody = newForm.locator('textarea.rich-text-source-input');
    await sourceBody.fill(previewBody);
    const preview = newForm.locator('.rich-text-preview');
    await preview.locator('summary').click();
    await expect(preview.locator('.markdown-body table')).toBeVisible();
    for (const viewport of VIEWPORTS) {
      await test.step(`markdown preview ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        const [pageWidth, previewBox] = await Promise.all([
          page.evaluate(() => document.documentElement.scrollWidth),
          preview.boundingBox(),
        ]);
        expect(
          pageWidth,
          `markdown preview page overflow at ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(viewport.width);
        expect(previewBox).not.toBeNull();
        if (!previewBox) return;
        expect(previewBox.x).toBeGreaterThanOrEqual(0);
        expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(viewport.width);
        const table = preview.locator('.markdown-body table');
        const tableReachability = await preview.evaluate((element) => {
          const tableElement = element.querySelector('.markdown-body table');
          if (!tableElement) return null;
          const rows = tableElement.querySelectorAll('tr');
          const lastRow = rows.item(rows.length - 1);
          const lastCell = lastRow?.lastElementChild;
          if (!(lastCell instanceof HTMLElement)) return null;
          element.scrollLeft = element.scrollWidth;
          const container = element.getBoundingClientRect();
          const lastCellBox = lastCell.getBoundingClientRect();
          return {
            containerLeft: container.left,
            containerRight: container.right,
            scrollLeft: element.scrollLeft,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            lastCellLeft: lastCellBox.left,
            lastCellRight: lastCellBox.right,
          };
        });
        expect(tableReachability).not.toBeNull();
        if (tableReachability) {
          expect(tableReachability.lastCellLeft).toBeGreaterThanOrEqual(
            tableReachability.containerLeft - 1,
          );
          expect(tableReachability.lastCellRight).toBeLessThanOrEqual(
            tableReachability.containerRight + 1,
          );
          if ([320, 568].includes(viewport.width)) {
            expect(tableReachability.scrollWidth).toBeGreaterThan(tableReachability.clientWidth);
            expect(tableReachability.scrollLeft).toBeGreaterThan(0);
          }
        }
        await expect(table).toBeVisible();
        if ([320, 568].includes(viewport.width)) {
          await preview.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              `log-markdown-table-preview-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }
      });
    }
    await newForm.getByRole('button', { name: 'Cancel', exact: true }).click();

    const tableCard = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: tableTitle, exact: true }),
    });
    await tableCard.getByRole('button', { name: `Edit ${tableTitle}` }).click();
    const tableForm = page.getByRole('form', { name: 'Edit adventure log entry' });
    const tableSource = tableForm.locator('textarea.rich-text-source-input');
    await expect(tableSource).toHaveValue(previewBody);
    await expect(
      tableForm.getByRole('button', { name: 'Rich text unavailable for tables' }),
    ).toBeDisabled();
    await expect(
      tableForm.getByText('This entry has a table. Edit it in Markdown mode to keep the table.'),
    ).toBeVisible();
    const editedTable = `${previewBody}\n| Scout | Follow up | ${longCell} | Tomorrow |`;
    await tableSource.fill(editedTable);
    await tableForm.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(tableForm).toHaveCount(0);
    await tableCard.getByRole('button', { name: `Edit ${tableTitle}` }).click();
    await expect(tableForm.locator('textarea.rich-text-source-input')).toHaveValue(editedTable);
    await tableForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    try {
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
