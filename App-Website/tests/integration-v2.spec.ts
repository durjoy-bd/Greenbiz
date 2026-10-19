import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}` };
async function device(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await page.getByLabel('Shop name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Open my shop' }).click();
}
async function connected(page: Page, name: string) {
  const response = await page.request.post('/api/auth/register', {
    headers,
    data: {
      email: `v2-${crypto.randomUUID()}@example.test`,
      password: 'Integration-Test-9182',
      shopName: name,
      owner: '',
      location: '',
      phone: '',
      bkash: '',
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('greenbiz-mode', 'server'));
  await page.reload();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
async function addProduct(page: Page, name: string) {
  await page.goto('/#/product');
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByLabel('You sell at').fill('100');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
}
test('SMS review links a fractional sale once and reports business expenses', async ({ page }) => {
  await device(page, 'Payments Corner');
  await addProduct(page, 'Miniket rice');
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Paste SMS', exact: true }).click();
  await page
    .getByLabel('Payment message', { exact: true })
    .fill('You received Tk 250.00 from 01712345678. Balance Tk 900. TrxID AA12345678.');
  await page.getByRole('button', { name: 'Review parsed payment' }).click();
  await page.getByRole('checkbox', { name: /These are business/ }).check();
  await page.getByRole('button', { name: 'Save reviewed records' }).click();
  await expect(page.locator('.transaction-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Create a linked sale' }).click();
  await page.getByLabel('Describe the sale').fill('2.5 Miniket rice');
  await page.getByRole('button', { name: 'Match names' }).click();
  await expect(page.getByLabel('quantity of Miniket rice', { exact: true })).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Save sale', exact: true }).click();
  await expect(page.getByText('Sale recorded', { exact: true })).toBeVisible();
  await page.goto('/#/transactions');
  await expect(page.getByText('Linked to sale', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Direction', { exact: true }).selectOption('out');
  await page.getByLabel('Amount', { exact: true }).fill('75');
  await page.getByLabel('Note', { exact: true }).fill('Shop rent');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await page.goto('/#/finance');
  await expect(page.locator('.finance-total')).toHaveText('৳175');
  await expect(page.locator('.finance-split')).toContainText('৳250');
});
test('multiple device shops remain isolated across switching and restart', async ({ page }) => {
  await device(page, 'First branch');
  await addProduct(page, 'Private first item');
  await page.goto('/#/settings');
  await page.getByLabel('New shop name').fill('Second branch');
  await page.getByRole('button', { name: 'Add shop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second branch' })).toBeVisible();
  await page.goto('/#/stock');
  await expect(page.getByRole('button', { name: /Private first item/ })).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Switch active shop').selectOption({ label: 'First branch' });
  await page.goto('/#/stock');
  await expect(page.getByRole('button', { name: /Private first item/ })).toBeVisible();
});
test('server keeps offline stock through restart and replays a lost-response operation exactly once', async ({
  page,
}) => {
  await connected(page, 'Offline branch');
  let disconnected = true;
  await page.route('**/api/**', (route) =>
    disconnected ? route.abort('failed') : route.continue(),
  );
  await addProduct(page, 'Offline rice');
  await expect(page.getByText(/1 pending/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Offline rice/ })).toBeVisible();
  let lost = false;
  await page.route('**/api/sync', async (route) => {
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  disconnected = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => lost).toBe(true);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
  const state = await (await page.request.get('/api/workspace')).json();
  expect(state.products.filter((p: { name: string }) => p.name === 'Offline rice')).toHaveLength(1);
});
test('offline revision conflict preserves server records and requires explicit discard', async ({
  page,
  context,
}) => {
  await connected(page, 'Conflict branch');
  await context.setOffline(true);
  await addProduct(page, 'Queued rice');
  const remote = await page.request.post('/api/actions', {
    headers,
    data: { type: 'shop.update', shop: { name: 'Changed remotely' } },
  });
  expect(remote.ok()).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText(/Sync paused:/).first()).toBeVisible();
  const server = await (await page.request.get('/api/workspace')).json();
  expect(server.products).toHaveLength(0);
  expect(server.shop.name).toBe('Changed remotely');
  await page.goto('/#/settings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Discard pending', exact: true }).click();
  await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
  await page.goto('/#/stock');
  await expect(page.getByRole('button', { name: /Queued rice/ })).toHaveCount(0);
});
test('new reports and transaction screens fit small phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/?demo=1');
  for (const route of ['finance', 'transactions', 'sale', 'settings']) {
    await page.goto('/?demo=1#/' + route);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('an expired session can reconnect without losing its pending stock', async ({ page }) => {
  await connected(page, 'Session recovery');
  let rejected = false;
  await page.route('**/api/sync', (route) => {
    if (!rejected) {
      rejected = true;
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Session expired.' }),
      });
    }
    return route.continue();
  });
  await page.goto('/#/product');
  await page.getByLabel('Product name').fill('Recovery rice');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByText(/Session expired/).first()).toBeVisible();
  await page.goto('/#/settings');
  await page.getByLabel('Sign in again · account password').fill('Integration-Test-9182');
  await page.getByRole('button', { name: 'Sign in & sync', exact: true }).click();
  await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
  const state = await (await page.request.get('/api/workspace')).json();
  expect(state.products.filter((p: { name: string }) => p.name === 'Recovery rice')).toHaveLength(
    1,
  );
});
test('an uncached offline branch never renders or copies the previous branch settings', async ({
  page,
}) => {
  await connected(page, 'Original shop');
  const created = await (
    await page.request.post('/api/shops', { headers, data: { name: 'Uncached branch' } })
  ).json();
  await page.request.post('/api/actions', {
    headers,
    data: { type: 'shop.update', shop: { phone: '01711111111', bkash: '01711111111' } },
  });
  await page.request.post('/api/actions', {
    headers: { ...headers, 'x-greenbiz-shop': created.id },
    data: { type: 'shop.update', shop: { phone: '01822222222', bkash: '01822222222' } },
  });
  await page.reload();
  await page.goto('/#/settings');
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('01711111111');
  let offline = true;
  await page.route('**/api/workspace', (route) =>
    offline && route.request().headers()['x-greenbiz-shop'] === created.id
      ? route.abort('failed')
      : route.continue(),
  );
  await page.getByLabel('Switch active shop').selectOption(created.id);
  await expect(page.getByRole('heading', { name: 'Let’s reconnect' })).toBeVisible();
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveCount(0);
  offline = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.goto('/#/settings');
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('01822222222');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  const state = await (
    await page.request.get('/api/workspace', { headers: { 'x-greenbiz-shop': created.id } })
  ).json();
  expect(state.shop).toMatchObject({
    name: 'Uncached branch',
    phone: '01822222222',
    bkash: '01822222222',
  });
});
test('fractional decrement stays valid and reduced motion disables transitions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await device(page, 'Quiet shop');
  await page.goto('/#/product');
  await page.getByLabel('Product name').fill('Weighted rice');
  await page.getByLabel('Quantity', { exact: true }).fill('2.3');
  await page.getByRole('button', { name: 'Decrease Quantity', exact: true }).click();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('1.3');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('button', { name: /Weighted rice/ })).toContainText('1.3');
  expect(
    await page.locator('.main-content').evaluate((e) => getComputedStyle(e).animationName),
  ).toBe('none');
});
