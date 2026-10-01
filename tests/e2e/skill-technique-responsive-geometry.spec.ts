import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test('Skills and techniques keep long names and default references inside the sheet', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `skill-technique-responsive-${runId()}@example.com`;
  const skillName = 'S'.repeat(160);
  const specialization = 'P'.repeat(160);
  const skillDisplayName = `${skillName}/${specialization}`;
  const techniqueName = 'T'.repeat(160);
  const defaultSkillName = 'D'.repeat(160);
  const notes = 'N'.repeat(2_000);
  let characterId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Skill Geometry QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function post(path: string, data: object) {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json() as Promise<{ id: string }>;
    }
    const character = await post('/characters', { name: 'Skill Geometry Surveyor' });
    characterId = character.id;
    await post(`/characters/${characterId}/skills`, {
      name: skillName,
      specialization,
      attribute: 'DX',
      difficulty: 'A',
      points: 1,
      notes,
    });
    await post(`/characters/${characterId}/techniques`, {
      name: techniqueName,
      defaultSkillName,
      difficulty: 'A',
      defaultModifier: -6,
      points: 1,
      notes,
    });

    await page.goto(`/characters/${characterId}`);
    await selectCharacterSection(page, 'Skills');
    const skillsTable = page.getByRole('table', { name: 'Skills', exact: true });
    const skillRow = page.getByRole('row').filter({ hasText: skillDisplayName }).first();
    const skillEditorToggle = page.getByRole('button', {
      name: `Edit ${skillDisplayName}`,
      exact: true,
    });
    await expect(skillsTable).toBeVisible();
    await expect(skillRow).toBeVisible();
    await skillEditorToggle.click();
    const skillEditorHeading = page.getByRole('heading', { name: `Edit ${skillDisplayName}` });
    await expect(skillEditorHeading).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: `${skillDisplayName} description and notes` }),
    ).toHaveValue(notes);

    const techniquesTable = page.getByRole('table', { name: 'Techniques', exact: true });
    const techniqueRow = techniquesTable
      .getByRole('row')
      .filter({ hasText: techniqueName })
      .first();
    const techniqueEditorToggle = page.getByRole('button', {
      name: `Edit ${techniqueName}`,
      exact: true,
    });
    await expect(techniquesTable).toBeVisible();
    await expect(techniqueRow).toBeVisible();
    await techniqueEditorToggle.click();
    const techniqueEditorHeading = page.getByText(`Edit ${techniqueName}`, { exact: true });
    await expect(techniqueEditorHeading).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: `${techniqueName} default skill` }),
    ).toHaveValue(defaultSkillName);
    await expect(page.getByRole('textbox', { name: `${techniqueName} name` })).toHaveValue(
      techniqueName,
    );
    const addSkill = page.getByRole('button', { name: '+ Add skill', exact: true });
    await addSkill.click();
    await expect(page.getByRole('textbox', { name: 'Skill', exact: true })).toBeVisible();
    const addTechnique = page.getByRole('button', { name: '+ Add technique', exact: true });
    await addTechnique.click();
    await expect(page.getByRole('textbox', { name: 'Technique', exact: true })).toBeVisible();

    for (const viewport of viewports) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(skillEditorHeading).toBeVisible();
        await expect(techniqueEditorHeading).toBeVisible();
        await expect(page.getByRole('textbox', { name: `${skillDisplayName} name` })).toHaveValue(
          skillName,
        );
        await expect(
          page.getByRole('combobox', { name: `${techniqueName} default skill` }),
        ).toHaveValue(defaultSkillName);
        await expect(page.getByRole('textbox', { name: `${techniqueName} name` })).toHaveValue(
          techniqueName,
        );
        const geometry = await Promise.all(
          [skillEditorHeading, techniqueEditorHeading, skillRow, techniqueRow].map((element) =>
            element.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return {
                x: rect.x,
                right: rect.right,
                documentWidth: document.documentElement.scrollWidth,
              };
            }),
          ),
        );
        for (const item of geometry) {
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.right).toBeLessThanOrEqual(viewport.width);
          expect(item.documentWidth).toBeLessThanOrEqual(viewport.width);
        }
        for (const control of [
          page.getByRole('textbox', { name: `${skillDisplayName} name` }),
          page.getByRole('combobox', { name: `${techniqueName} default skill` }),
          page.getByRole('textbox', { name: `${techniqueName} name` }),
          page.getByRole('textbox', { name: 'Skill', exact: true }),
          page.getByRole('textbox', { name: 'Technique', exact: true }),
        ]) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box?.x).toBeGreaterThanOrEqual(0);
          expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        }
        if ([320, 568, 640, 1024, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `skill-technique-${viewport.width}x${viewport.height}`,
            { animations: 'disabled' },
          );
        }
      });
    }
  } finally {
    try {
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
