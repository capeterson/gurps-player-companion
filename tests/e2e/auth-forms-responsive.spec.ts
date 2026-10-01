import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

async function expectInsideViewport(
  locator: import('@playwright/test').Locator,
  viewport: { width: number; height: number },
) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('login, registration, and password recovery forms remain reachable on responsive viewports', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid credentials' }),
    }),
  );
  await page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'email already in use' }),
    }),
  );
  await page.route('**/api/v1/auth/forgot-password', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/login');
      const loginForm = page.locator('form').filter({
        has: page.getByRole('heading', { name: 'Sign in', exact: true }),
      });
      const loginEmail = loginForm.getByLabel('Email');
      const loginPassword = loginForm.getByLabel('Password');
      const loginButton = loginForm.getByRole('button', { name: 'Sign in', exact: true });
      const recoveryLink = page.getByRole('link', { name: 'Forgot your password?' });
      const registrationLink = page.getByRole('link', { name: 'Create an account' });
      await expect(loginForm.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(loginEmail).toBeVisible();
      await expect(loginPassword).toBeVisible();
      await expect(recoveryLink).toBeVisible();
      await expect(registrationLink).toBeVisible();
      for (const control of [loginEmail, loginPassword, recoveryLink, registrationLink]) {
        await expectInsideViewport(control, viewport);
      }
      await loginButton.click();
      expect(
        await loginEmail.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
      ).toBe(true);
      await loginEmail.fill('responsive@example.invalid');
      await loginPassword.fill('wrong-password');
      await loginButton.click();
      const loginError = loginForm.getByText('invalid credentials', { exact: true });
      await expect(loginError).toBeVisible();
      await expectInsideViewport(loginError, viewport);
      const loginRect = await loginForm.boundingBox();
      expect(loginRect).not.toBeNull();
      if (loginRect) {
        expect(loginRect.x).toBeGreaterThanOrEqual(0);
        expect(loginRect.x + loginRect.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await expectInsideViewport(loginButton, viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      if ([320, 568].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`login-error-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }

      await page.goto('/register');
      const registerForm = page.locator('form').filter({
        has: page.getByRole('heading', { name: 'Create an account', exact: true }),
      });
      const registerEmail = registerForm.getByLabel('Email');
      const displayName = registerForm.getByLabel('Display name');
      const registerPassword = registerForm.getByLabel('Password (min 8 chars)');
      const registerButton = registerForm.getByRole('button', {
        name: 'Create account',
        exact: true,
      });
      await expect(registerForm.getByRole('heading', { name: 'Create an account' })).toBeVisible();
      await expect(registerEmail).toBeVisible();
      await expect(displayName).toBeVisible();
      await expect(registerPassword).toBeVisible();
      const signInLink = page.getByRole('link', { name: 'Sign in', exact: true });
      await expect(signInLink).toBeVisible();
      for (const control of [registerEmail, displayName, registerPassword, signInLink]) {
        await expectInsideViewport(control, viewport);
      }
      await registerButton.click();
      expect(
        await registerEmail.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
      ).toBe(true);
      await registerEmail.fill('responsive@example.invalid');
      await displayName.fill('Long Name Responsive Test');
      await registerPassword.fill('CorrectHorseBatteryStaple1');
      await registerButton.click();
      const registerError = registerForm.getByText('email already in use', { exact: true });
      await expect(registerError).toBeVisible();
      await expectInsideViewport(registerError, viewport);
      const registerRect = await registerForm.boundingBox();
      expect(registerRect).not.toBeNull();
      if (registerRect) {
        expect(registerRect.x).toBeGreaterThanOrEqual(0);
        expect(registerRect.x + registerRect.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await expectInsideViewport(registerButton, viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      if ([320, 568].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`register-error-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }

      await page.goto('/forgot-password');
      const forgotCard = page.locator('.card').filter({
        has: page.getByRole('heading', { name: 'Forgot password', exact: true }),
      });
      const forgotForm = forgotCard.locator('form');
      const forgotEmail = forgotForm.getByLabel('Email');
      const forgotButton = forgotForm.getByRole('button', { name: 'Send reset link', exact: true });
      await expect(forgotCard.getByRole('heading', { name: 'Forgot password' })).toBeVisible();
      await expect(forgotEmail).toBeVisible();
      const forgotSignInLink = page.getByRole('link', { name: 'Sign in', exact: true });
      await expect(forgotSignInLink).toBeVisible();
      await expectInsideViewport(forgotEmail, viewport);
      await expectInsideViewport(forgotSignInLink, viewport);
      await forgotButton.click();
      expect(
        await forgotEmail.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
      ).toBe(true);
      await forgotEmail.fill('responsive@example.invalid');
      await forgotButton.click();
      await expect(
        page.getByText(
          "If that email address is registered, we've sent a password reset link. Check your inbox.",
          { exact: true },
        ),
      ).toBeVisible();
      const backToSignIn = page.getByRole('link', { name: 'Back to sign in', exact: true });
      await expect(backToSignIn).toBeVisible();
      await expectInsideViewport(backToSignIn, viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      if ([320, 568].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`forgot-success-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }
});
