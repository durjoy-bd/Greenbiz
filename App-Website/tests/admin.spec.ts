import { test, expect } from '@playwright/test';

// Needs an administrator created with `server/admin.ts create-admin` on the test database.
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const origin = `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}`;

test.skip(!email || !password, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the admin journey.');

test('administrator sees every shop, opens its records and manages the owner account', async ({ page }) => {
  const owner = `owner-${crypto.randomUUID()}@example.test`;
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: origin },
    data: { email: owner, password: 'Integration-Test-9182', shopName: 'Admin Test Store', owner: 'Rina', location: 'Sylhet', phone: '', bkash: '' },
  });
  expect(registered.ok()).toBe(true);
  await page.request.post('/api/auth/logout', { headers: { Origin: origin } });

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await page.getByLabel('Administrator email').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();

  await page.getByRole('button', { name: 'Shops', exact: true }).click();
  await page.getByLabel('Search shops').fill('Admin Test Store');
  await page.getByRole('row', { name: /Admin Test Store/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Admin Test Store' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Credit profile/ })).toBeVisible();

  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByLabel('Search accounts').fill(owner);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('dialog', { name: 'Temporary password' })).toBeVisible();
  const temporary = (await page.locator('.secret-box code').textContent())!;
  await page.getByRole('button', { name: 'Done' }).click();
  const login = await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: owner, password: temporary } });
  expect(login.ok()).toBe(true);

  await page.getByRole('button', { name: 'Audit log' }).click();
  await expect(page.getByText('account.reset-password').first()).toBeVisible();
  await expect(page.getByText('shop.view').first()).toBeVisible();
});

test('the admin console fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
