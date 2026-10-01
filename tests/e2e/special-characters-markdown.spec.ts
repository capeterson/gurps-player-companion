import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

function assertNoExecutableMarkdown(page: import('@playwright/test').Page, scope: string) {
  return page.locator(scope).evaluate((node) => ({
    text: node.textContent ?? '',
    activeElements: node.querySelectorAll(
      'script, img, svg, iframe, object, embed, [onerror], [onload], [onclick], [onfocus]',
    ).length,
    links: [...node.querySelectorAll('a')].map((link) => ({
      text: link.textContent,
      href: link.getAttribute('href'),
    })),
  }));
}

async function readCharacterFromApi(
  page: import('@playwright/test').Page,
  characterId: string,
  accessToken: string,
) {
  const response = await page.request.get(`/api/v1/characters/${characterId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    appearance: string | null;
    traits: Array<{ name: string; notes: string | null }>;
  };
}

test('Markdown source stays inert and readable through editor toggles, save, and reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const runId = suffix();
  const account = `markdown-security-${runId}@example.com`;
  const campaignName = `Markdown security ${runId}`;
  const characterName = `Description canary ${runId}`;
  const entryTitle = `Adventure canary ${runId}`;
  const traitName = `Notes canary ${runId}`;
  const characterMarkdown = [
    'Quotes: "double" and \'single\'; ampersand &; backslash \\slash; café; 東京; مرحبا; 🐉',
    '',
    '<script>window.__markdownCanary = 1</script>',
    '',
    '<img src=x onerror="window.__markdownCanary = 2">',
    '',
    '<svg onload="window.__markdownCanary = 3"><text>SVG canary</text></svg>',
    '',
    '<a href="javascript:window.__markdownCanary=4" onclick="alert(4)">raw link canary</a>',
    '',
    '[safe reference](https://example.com/reference)',
    '',
    '[uppercase safe reference](HTTPS://example.com/Cased/Path?q=Case)',
    '',
    '[mixed-case safe reference](hTtPs://example.com/mixed-case)',
    '',
    '```html',
    '<img src=x onerror="window.__markdownCanary = 6">',
    '```',
  ].join('\n');
  const logMarkdown = [characterMarkdown, '', '[unsafe markdown link](JaVaScRiPt:alert(5))'].join(
    '\n\n',
  );
  const dialogs: string[] = [];
  const externalRequests: string[] = [];
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001').origin;

  await page.addInitScript(() => {
    (window as Window & { __markdownCanary: number }).__markdownCanary = 0;
  });
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(account);
  await page.getByLabel(/display name/i).fill(`Markdown QA ${runId}`);
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(campaignName);
  await page.getByRole('button', { name: /^create$/i }).click();
  const campaignLink = page.getByRole('link', { name: campaignName, exact: true });
  await expect(campaignLink).toBeVisible();
  const campaignId = (await campaignLink.getAttribute('href'))?.split('/').at(-1);
  expect(campaignId).toBeTruthy();

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(characterName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+$/i, { timeout: 10_000 });
  const characterId = new URL(page.url()).pathname.split('/').at(-1) as string;
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  await expect(page.getByRole('group', { name: 'Character description' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit description', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const initialRichSurface = page.locator('.rich-text-surface[contenteditable="true"]');
  await expect(initialRichSurface).toBeVisible();
  const clipboardPaste = await initialRichSurface.evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.focus();

    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p>Clipboard canary: café 東京 مرحبا 🐉</p><img src=x onerror="window.__markdownCanary=8"><a href="javascript:window.__markdownCanary=9">unsafe clipboard link</a>',
    );
    data.setData('text/plain', 'Clipboard canary: café 東京 مرحبا 🐉');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    return { prevented: !node.dispatchEvent(event) };
  });
  expect(clipboardPaste.prevented).toBe(true);
  await expect(initialRichSurface).toContainText('Clipboard canary: café 東京 مرحبا 🐉');
  const pastedRichText = await assertNoExecutableMarkdown(page, '.rich-text-surface');
  expect(pastedRichText.activeElements).toBe(0);
  expect(
    pastedRichText.links.every(
      (link) => link.href === null || !/^\s*(?:javascript|data|vbscript):/i.test(link.href),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);

  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  await page.getByRole('textbox', { name: 'description' }).fill(characterMarkdown);
  const descriptionDetails = page.locator('.rich-text-preview').last();
  await descriptionDetails.locator('summary').click();
  const descriptionPreview = descriptionDetails.locator('.markdown-body');
  await expect(descriptionPreview).toBeVisible();
  await expect(descriptionPreview).toContainText('café; 東京; مرحبا; 🐉');
  const beforeModeSwitch = await assertNoExecutableMarkdown(
    page,
    '.rich-text-preview .markdown-body',
  );
  expect(beforeModeSwitch.activeElements).toBe(0);
  expect(beforeModeSwitch.text).toContain('<script>window.__markdownCanary = 1</script>');
  expect(beforeModeSwitch.text).toContain('backslash \\slash');
  expect(beforeModeSwitch.links.find((link) => link.text === 'safe reference')?.href).toBe(
    'https://example.com/reference',
  );
  expect(
    beforeModeSwitch.links.find((link) => link.text === 'uppercase safe reference')?.href,
  ).toBe('https://example.com/Cased/Path?q=Case');
  expect(
    beforeModeSwitch.links.find((link) => link.text === 'mixed-case safe reference')?.href,
  ).toBe('https://example.com/mixed-case');

  await page.getByRole('button', { name: 'Back to rich text' }).click();
  const richSurface = page.locator('.rich-text-surface[contenteditable="true"]');
  await expect(richSurface).toBeVisible();
  await expect(richSurface).toContainText('<script>window.__markdownCanary = 1</script>');
  expect(
    await richSurface.locator('script, img, svg, iframe, [onerror], [onload], [onclick]').count(),
  ).toBe(0);
  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  await page.locator('.rich-text-preview').last().locator('summary').click();
  const switchedDescriptionPreview = page.locator('.rich-text-preview .markdown-body').last();
  await expect(switchedDescriptionPreview).toBeVisible();
  await expect(switchedDescriptionPreview).toContainText('café; 東京; مرحبا; 🐉');
  const afterModeSwitch = await assertNoExecutableMarkdown(
    page,
    '.rich-text-preview .markdown-body',
  );
  expect(afterModeSwitch.activeElements).toBe(0);
  expect(afterModeSwitch.text.replace(/\s+/g, ' ').trim()).toBe(
    beforeModeSwitch.text.replace(/\s+/g, ' ').trim(),
  );

  await page.getByRole('button', { name: 'Back to rich text' }).click();
  await expect
    .poll(
      async () =>
        (await readCharacterFromApi(page, characterId, accessToken)).appearance?.includes(
          'safe reference',
        ) ?? false,
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  await page.reload();
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  await expect(page.getByRole('group', { name: 'Character description' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  await page.locator('.rich-text-preview').last().locator('summary').click();
  const reloadedDescriptionPreview = page.locator('.rich-text-preview .markdown-body').last();
  await expect(reloadedDescriptionPreview).toBeVisible();
  await expect(reloadedDescriptionPreview).toContainText('café; 東京; مرحبا; 🐉');
  const reloadedDescription = await assertNoExecutableMarkdown(
    page,
    '.rich-text-preview .markdown-body',
  );
  expect(reloadedDescription.activeElements).toBe(0);
  expect(reloadedDescription.text).toContain('café; 東京; مرحبا; 🐉');
  expect(reloadedDescription.links.find((link) => link.text === 'safe reference')?.href).toBe(
    'https://example.com/reference',
  );

  await selectCharacterSection(page, 'Traits');
  await page.getByRole('button', { name: '+ Add trait' }).click();
  await page.getByLabel('Trait name').fill(traitName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const editTraitButton = page.getByRole('button', { name: `Edit ${traitName}`, exact: true });
  await expect(editTraitButton).toBeVisible();
  await editTraitButton.click();
  const traitNotes = [
    'Trait notes: quotes " and \' plus &; café 東京 مرحبا 🐉',
    '',
    '<img src=x onerror="window.__markdownCanary = 7">',
    '',
    '[safe notes link](https://example.com/trait-notes)',
  ].join('\n');
  const traitNotesEditor = page.getByRole('textbox', {
    name: `${traitName} description and notes`,
  });
  await traitNotesEditor.fill(traitNotes);
  const traitDetailRow = traitNotesEditor.locator('xpath=ancestor::tr').last();
  const traitPreviewToggle = traitDetailRow.getByRole('button', { name: 'Preview description' });
  await traitPreviewToggle.click();
  const traitPreview = traitDetailRow.locator('.markdown-body');
  await expect(traitPreview).toBeVisible();
  await expect(traitPreview).toContainText('café 東京 مرحبا 🐉');
  const renderedTraitNotes = await assertNoExecutableMarkdown(
    page,
    'table[aria-label="Traits"] .markdown-body',
  );
  expect(renderedTraitNotes.activeElements).toBe(0);
  expect(renderedTraitNotes.text).toContain('<img src=x onerror="window.__markdownCanary = 7">');
  expect(renderedTraitNotes.links.find((link) => link.text === 'safe notes link')?.href).toBe(
    'https://example.com/trait-notes',
  );
  await expect(traitPreview.getByRole('link', { name: 'safe notes link', exact: true })).toHaveCSS(
    'text-decoration-line',
    'underline',
  );
  await expect
    .poll(
      async () =>
        (await readCharacterFromApi(page, characterId, accessToken)).traits.find(
          (trait) => trait.name === traitName,
        )?.notes,
      { timeout: 20_000 },
    )
    .toBe(traitNotes);
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  await page.reload();
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  await selectCharacterSection(page, 'Traits');
  await page.getByRole('button', { name: `Edit ${traitName}`, exact: true }).click();
  const reloadedTraitNotesEditor = page.getByRole('textbox', {
    name: `${traitName} description and notes`,
  });
  const reloadedTraitDetail = reloadedTraitNotesEditor.locator('xpath=ancestor::tr').last();
  const reloadedTraitPreviewToggle = reloadedTraitDetail.getByRole('button', {
    name: 'Preview description',
  });
  if ((await reloadedTraitPreviewToggle.getAttribute('aria-expanded')) !== 'true') {
    await reloadedTraitPreviewToggle.click();
  }
  const reloadedTraitPreview = reloadedTraitDetail.locator('.markdown-body');
  await expect(reloadedTraitPreview).toBeVisible();
  await expect(reloadedTraitPreview).toContainText('café 東京 مرحبا 🐉');
  const reloadedTraitRender = await assertNoExecutableMarkdown(
    page,
    'table[aria-label="Traits"] .markdown-body',
  );
  expect(reloadedTraitRender.activeElements).toBe(0);
  expect(reloadedTraitRender.text).toContain('Trait notes: quotes');

  await page.goto(`/campaigns/${campaignId}/log`);
  await page.getByRole('button', { name: '+ New entry' }).click();
  await page.getByLabel(/^title$/i).fill(entryTitle);
  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  await page.locator('textarea.rich-text-source-input').fill(logMarkdown);
  const logPreviewDetails = page.locator('.rich-text-preview').last();
  await logPreviewDetails.locator('summary').click();
  await expect(logPreviewDetails.locator('.markdown-body')).toBeVisible();
  await expect(logPreviewDetails.locator('.markdown-body')).toContainText('café; 東京; مرحبا; 🐉');
  const logPreview = await assertNoExecutableMarkdown(page, '.rich-text-preview .markdown-body');
  expect(logPreview.activeElements).toBe(0);

  await page.getByRole('button', { name: 'Save entry' }).click();
  const logArticle = page.locator('article').filter({
    has: page.getByRole('heading', { name: entryTitle, exact: true }),
  });
  await expect(logArticle).toBeVisible();
  await expect(logArticle.locator('.log-entry-body .markdown-body')).toContainText(
    'café; 東京; مرحبا; 🐉',
  );
  const renderedLog = await assertNoExecutableMarkdown(
    page,
    'article .log-entry-body .markdown-body',
  );
  expect(renderedLog.activeElements).toBe(0);
  expect(renderedLog.links.find((link) => link.text === 'safe reference')?.href).toBe(
    'https://example.com/reference',
  );
  expect(renderedLog.links.find((link) => link.text === 'uppercase safe reference')?.href).toBe(
    'https://example.com/Cased/Path?q=Case',
  );
  expect(renderedLog.links.find((link) => link.text === 'mixed-case safe reference')?.href).toBe(
    'https://example.com/mixed-case',
  );
  const unsafeLink = renderedLog.links.find((link) => link.text === 'unsafe markdown link');
  await expect(logArticle.getByText('unsafe markdown link', { exact: true })).toBeVisible();
  if (unsafeLink) {
    expect(
      unsafeLink.href === null || !/^\s*(?:javascript|data|vbscript):/i.test(unsafeLink.href),
    ).toBe(true);
    const unsafeAnchor = logArticle
      .locator('.log-entry-body a')
      .filter({ hasText: 'unsafe markdown link' })
      .first();
    await expect(unsafeAnchor).toHaveCSS('text-decoration-line', 'none');
    const beforeClick = page.url();
    await unsafeAnchor.click();
    expect(page.url()).toBe(beforeClick);
  }
  const safeAnchor = logArticle
    .locator('.log-entry-body a')
    .filter({ hasText: 'safe reference' })
    .first();
  await expect(safeAnchor).toHaveAttribute('href', 'https://example.com/reference');
  await expect(safeAnchor).toHaveCSS('text-decoration-line', 'underline');

  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  await page.reload();
  const reloadedArticle = page.locator('article').filter({
    has: page.getByRole('heading', { name: entryTitle, exact: true }),
  });
  await expect(reloadedArticle).toBeVisible();
  await expect(reloadedArticle.locator('.log-entry-body .markdown-body')).toContainText(
    'café; 東京; مرحبا; 🐉',
  );
  const reloadedLog = await assertNoExecutableMarkdown(
    page,
    'article .log-entry-body .markdown-body',
  );
  expect(reloadedLog.activeElements).toBe(0);
  expect(reloadedLog.text).toContain('café; 東京; مرحبا; 🐉');
  expect(reloadedLog.links.find((link) => link.text === 'safe reference')?.href).toBe(
    'https://example.com/reference',
  );
  await expect(
    reloadedArticle.getByRole('link', { name: 'uppercase safe reference', exact: true }),
  ).toHaveAttribute('href', 'https://example.com/Cased/Path?q=Case');
  await expect(reloadedArticle.getByText('unsafe markdown link', { exact: true })).toBeVisible();
  await expect(
    reloadedArticle.getByRole('link', { name: 'unsafe markdown link', exact: true }),
  ).toHaveCount(0);
  await captureReviewScreenshot(reloadedArticle, {
    path: testInfo.outputPath('markdown-log-links.png'),
  });
  expect(
    await page.evaluate(() => (window as Window & { __markdownCanary: number }).__markdownCanary),
  ).toBe(0);
  expect(dialogs).toEqual([]);
  expect(externalRequests).toEqual([]);
});
