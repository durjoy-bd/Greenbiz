import { test, expect } from '@playwright/test';
import { emailedToken, registerVerified } from './support';

const password = 'Account-Test-9182';

test('opening a protected page signed out returns there after signing in, and profile edits survive a reload', async ({ page, browser }) => {
  const email = `return-${crypto.randomUUID()}@example.test`;
  const setup = await browser.newContext();
  await registerVerified(setup.request, { email, password, shopName: 'Return Shop', fullName: 'Nusrat Jahan' });
  await setup.close();

  await page.goto('/#/account');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('We’ll take you back to the page you asked for.')).toBeVisible();
  const field = page.getByLabel('Password', { exact: true });
  await field.fill(password);
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Profile & account' })).toBeVisible();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(page.getByLabel('Full name')).toHaveValue('Nusrat Jahan');
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await page.getByLabel('Full name').fill('Nusrat J. Rahman');
  await page.getByLabel('Phone number (optional)').fill('+880 1711-000000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.getByLabel('Phone number (optional)').fill('not a phone');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Use digits, spaces and + ( ) - only')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Full name')).toHaveValue('Nusrat J. Rahman');
  await expect(page.getByLabel('Phone number (optional)')).toHaveValue('+880 1711-000000');
  await expect(page.getByText('This device')).toBeVisible();

  // The account menu shows the name, the account page and sign-out; no admin link for a regular user.
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'Account menu' }).first().click();
  await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Admin panel' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('a forgotten password is reset with a single-use emailed link', async ({ page, browser }) => {
  const email = `forgot-${crypto.randomUUID()}@example.test`;
  const setup = await browser.newContext();
  await registerVerified(setup.request, { email, password, shopName: 'Forgot Shop' });
  await setup.close();

  await page.goto('/#/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const token = await emailedToken(email, 'reset-password');
  await page.goto('/#/reset-password/' + token);
  await expect(page.getByText(/For f•••@example\.test/)).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('Changed-Pass-4321');
  await page.getByLabel('Confirm new password').fill('Different-4321!');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();
  await page.getByLabel('Confirm new password').fill('Changed-Pass-4321');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  // Opening the same link again explains that it has been used.
  await page.goto('/#/reset-password/' + token);
  await page.reload();
  await expect(page.getByText(/already been used/)).toBeVisible();
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Changed-Pass-4321');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forgot Shop' })).toBeVisible();
});

test('sign-up explains problems beside each field and an unconfirmed account cannot sign in yet', async ({ page }) => {
  const email = `unconfirmed-${crypto.randomUUID()}@example.test`;
  await page.goto('/#/register');
  await page.getByLabel('Full name').fill('Karim');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await page.getByLabel('Shop or business name').fill('Karim Store');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Confirm your email address before signing in.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new confirmation link' })).toBeVisible();
});

test('account pages fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const hash of ['#/login', '#/register', '#/forgot-password']) {
    await page.goto('/' + hash);
    await expect(page.locator('main.auth-page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), hash).toBe(true);
  }
  const email = `phone-${crypto.randomUUID()}@example.test`;
  await registerVerified(page.request, { email, password, shopName: 'Phone Shop' });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('greenbiz-mode', 'server'));
  await page.goto('/#/account');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Profile & account' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
