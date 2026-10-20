import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { totpCode, totpStep } from '../server/totp';
import { emailedToken, origin, registerVerified } from './support';

// Needs a Super Admin created with `server/admin.ts create-super-admin` on the test database.
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
// The authenticator secret is kept between runs so a re-run can still produce codes.
const secretFile = 'tmp/e2e-admin-secret.txt';

test.skip(!email || !password, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the admin journeys.');

async function freshCode(secret: string) {
  // A code can be used once; wait for the next 30-second window if this one was just used.
  const used = existsSync(secretFile + '.step') ? Number(readFileSync(secretFile + '.step', 'utf8')) : 0;
  while (totpStep(new Date()) <= used) await new Promise((r) => setTimeout(r, 1000));
  const step = totpStep(new Date());
  writeFileSync(secretFile + '.step', String(step));
  return totpCode(secret, step);
}
async function adminSignIn(page: Page) {
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Continue' }).click();
  const setup = page.getByRole('heading', { name: 'Set up two-step verification' });
  const verify = page.getByRole('heading', { name: 'Two-step verification' });
  await expect(setup.or(verify)).toBeVisible();
  if (await setup.isVisible()) {
    const secret = (await page.getByLabel('Setup key').textContent())!.replace(/\s/g, '');
    mkdirSync('tmp', { recursive: true });
    writeFileSync(secretFile, secret);
    await page.getByLabel('Code from the app').fill(await freshCode(secret));
    await page.getByRole('button', { name: 'Turn on and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await expect(page.locator('.recovery-codes li')).toHaveCount(10);
    await page.getByLabel('I have stored these codes somewhere safe').check();
    await page.getByRole('button', { name: 'Continue to the admin panel' }).click();
  } else {
    await page.getByLabel('Authentication code').fill(await freshCode(readFileSync(secretFile, 'utf8')));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('an administrator finds a real account, inspects it, suspends and reactivates it with a reason, and sends a reset email', async ({ page, browser }) => {
  const owner = `owner-${crypto.randomUUID()}@example.test`;
  const ownerContext = await browser.newContext();
  const created = await registerVerified(ownerContext.request, { email: owner, password: 'Integration-Test-9182', shopName: 'Admin Test Store', fullName: 'Rina Akter' });

  await adminSignIn(page);
  await expect(page.getByText('Registered users')).toBeVisible();
  await expect(page.getByText(/Last updated/)).toBeVisible();

  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByLabel('Search users').fill(owner);
  // The search waits for a pause in typing; then only the header row and this account remain.
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('row', { name: /Open Rina Akter/ })).toBeVisible();
  await page.getByRole('row', { name: /Open Rina Akter/ }).click();
  await expect(page.getByRole('heading', { name: 'Rina Akter' })).toBeVisible();
  await page.getByRole('tab', { name: /Related records/ }).click();
  await expect(page.getByText('Admin Test Store').first()).toBeVisible();
  await page.getByRole('tab', { name: /^Activity/ }).click();
  await expect(page.getByText('Confirmed email address')).toBeVisible();

  await page.getByRole('button', { name: 'Suspend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suspend this account' });
  await expect(dialog.getByRole('button', { name: 'Suspend account' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Browser test of suspension');
  await dialog.getByRole('button', { name: 'Suspend account' }).click();
  await expect(page.getByText('Account suspended.')).toBeVisible();
  // The owner's existing session stops working at once.
  expect((await ownerContext.request.get('/api/workspace')).status()).toBe(401);
  expect((await ownerContext.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: owner, password: 'Integration-Test-9182' } })).status()).toBe(403);

  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('dialog', { name: 'Reactivate this account' }).getByLabel('Reason').fill('Checked and cleared');
  await page.getByRole('dialog', { name: 'Reactivate this account' }).getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText('Account reactivated.')).toBeVisible();

  await page.getByRole('button', { name: 'Send password reset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send reset email' }).click();
  await expect(page.getByText('Password reset email sent.')).toBeVisible();
  expect(await emailedToken(owner, 'reset-password')).toMatch(/^[a-f0-9]{64}$/);

  await page.getByRole('tab', { name: /Admin history/ }).click();
  await expect(page.getByRole('cell', { name: 'Browser test of suspension' })).toBeVisible();

  await page.getByRole('button', { name: 'Audit log' }).click();
  await page.getByLabel('Search the audit log').fill(created.user.id);
  await expect(page.getByText('Suspended Rina Akter (' + owner + ')')).toBeVisible();
  await page.getByRole('button', { name: 'Activity log' }).click();
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await ownerContext.close();
});

test('a regular user is refused by the admin panel even with the right password', async ({ page }) => {
  const owner = `plain-${crypto.randomUUID()}@example.test`;
  await registerVerified(page.request, { email: owner, password: 'Integration-Test-9182', shopName: 'Plain Shop' });
  expect((await page.request.get('/api/admin/users')).status()).toBe(401);
  await page.goto('/#/admin');
  await page.getByLabel('Email').fill(owner);
  await page.getByLabel('Password', { exact: true }).fill('Integration-Test-9182');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'This account can’t open the admin panel' })).toBeVisible();
});

test('/admin opens the admin panel, which fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await adminSignIn(page);
  for (const section of ['Users', 'Activity log']) {
    await page.goto('/#/admin/' + (section === 'Users' ? 'users' : 'activity'));
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
