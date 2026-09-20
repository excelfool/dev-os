import { test, expect, type Page } from '@playwright/test';

/**
 * Spec 03 §13 — the auth flow through the real UI.
 *
 * Every signup before this ran through the API, so the submit gate had never
 * been exercised. It shipped silently broken: the button is driven by the zod
 * schema, but the error state was only written inside handleSubmit, which the
 * disabled button prevents from running. The user saw a permanently disabled
 * button and no statement of which rule was unmet.
 */

function uniqueEmail(label: string): string {
  return `e2e.${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;
}

async function fields(page: Page) {
  return {
    email: page.getByLabel('Email'),
    password: page.getByLabel('Password'),
    submit: page.getByRole('button', { name: 'Create account' }),
  };
}

test.describe('signup submit gate', () => {
  test('a 13-character password alone does not enable submit, and the form says why', async ({
    page,
  }) => {
    await page.goto('/signup');
    const { email, password, submit } = await fields(page);

    await expect(submit).toBeDisabled();

    // The exact reported case: a 13-character password, typed, nothing else.
    await password.fill('passwordabcde');
    await expect(password).toHaveValue('passwordabcde');
    await expect(submit).toBeDisabled();

    // The form must state the unmet rule rather than leaving a dead end.
    await expect(page.getByText(/at least 8 characters including a letter and a number/i)).toBeVisible();

    // 13 characters but no digit — still invalid, and now said out loud.
    await expect(
      page.getByText('Use at least 8 characters, including a letter and a number.'),
    ).toBeVisible();

    await email.fill('not-an-email');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(submit).toBeDisabled();
  });

  test('each rule is reported as it is broken, and submit enables once all pass', async ({
    page,
  }) => {
    await page.goto('/signup');
    const { email, password, submit } = await fields(page);

    await email.fill('someone@example.com');
    await expect(page.getByText('Enter a valid email address.')).toHaveCount(0);
    await expect(submit).toBeDisabled(); // password still empty

    await password.fill('short1');
    await expect(
      page.getByText('Use at least 8 characters, including a letter and a number.'),
    ).toBeVisible();
    await expect(submit).toBeDisabled();

    await password.fill('1234567890123'); // long enough, no letter
    await expect(
      page.getByText('Use at least 8 characters, including a letter and a number.'),
    ).toBeVisible();
    await expect(submit).toBeDisabled();

    await password.fill('Password12345'); // all four rules satisfied
    await expect(submit).toBeEnabled();
  });

  test('the invalid field is marked for assistive tech', async ({ page }) => {
    await page.goto('/signup');
    const { email, password } = await fields(page);

    await email.fill('nope');
    await expect(email).toHaveAttribute('aria-invalid', 'true');

    await password.fill('abc');
    await expect(password).toHaveAttribute('aria-invalid', 'true');

    await email.fill('someone@example.com');
    await password.fill('Password12345');
    await expect(email).toHaveAttribute('aria-invalid', 'false');
    await expect(password).toHaveAttribute('aria-invalid', 'false');
  });

  test('the whole gate is operable with the keyboard alone', async ({ page }) => {
    await page.goto('/signup');

    await page.getByLabel('Email').focus();
    await page.keyboard.type('someone@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Password12345');

    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});

test.describe('signup and sign-in round trip', () => {
  test('creates an account, lands on the dashboard, signs out and back in', async ({ page }) => {
    const email = uniqueEmail('roundtrip');
    const password = 'Password12345';

    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);

    const started = Date.now();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    // US-001: the auth flow completes in under 10 seconds.
    expect(Date.now() - started).toBeLessThan(10_000);

    await expect(
      page.getByText('No contracts reviewed yet — upload your first contract to begin'),
    ).toBeVisible();

    await page.getByRole('button', { name: new RegExp(email.split('@')[0]!, 'i') }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(/\/$/);

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  });

  test('invalid credentials never disclose which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('WrongPassword1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  });
});

test.describe('route protection', () => {
  test('a protected route redirects to login and returns after signing in', async ({ page }) => {
    const email = uniqueEmail('protected');
    const password = 'Password12345';

    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    await page.getByRole('button', { name: new RegExp(email.split('@')[0]!, 'i') }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(/\/$/);

    await page.goto('/settings');
    await page.waitForURL(/\/login\?next=%2Fsettings/);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Lands on the originally requested page, not the dashboard.
    await page.waitForURL('**/settings', { timeout: 20_000 });
  });
});
