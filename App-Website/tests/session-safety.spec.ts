import { test, expect, type Page } from '@playwright/test';
async function connected(page: Page, label: string) {
  const r = await page.request.post('/api/auth/register', {
    headers: { Origin: `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}` },
    data: {
      email: `${label.toLowerCase().replace(/\s/g, '')}-${Date.now()}@example.test`,
      password: 'Session-Test-9182',
      shopName: label,
      owner: '',
      location: '',
      phone: '',
      bkash: '',
    },
  });
  expect(r.ok()).toBe(true);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('greenbiz-mode', 'server'));
  await page.reload();
  await expect(page.getByRole('heading', { name: label })).toBeVisible();
}
async function cacheKeys(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('keyval', 'readonly');
          const keys = tx.objectStore('keyval').getAllKeys();
          keys.onsuccess = () => {
            resolve(keys.result.map(String).filter((k) => k.startsWith('greenbiz-cache:')));
            db.close();
          };
          keys.onerror = () => reject(keys.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}
test('deleting a server account clears its cached business records', async ({ page }) => {
  await connected(page, 'Delete Corner');
  expect((await cacheKeys(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByLabel('Confirm password').fill('Session-Test-9182');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create my shop' })).toBeVisible();
  expect(await cacheKeys(page)).toEqual([]);
});
test('a delayed response from a previously selected shop cannot replace the current shop', async ({
  page,
}) => {
  await connected(page, 'Old Account');
  const next = await page.request.post('/api/shops', {
    headers: { Origin: `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}` },
    data: { name: 'New Selected Shop' },
  });
  expect(next.ok()).toBe(true);
  await page.reload();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const ready = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/api/sync', async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await page.getByLabel('Product name').fill('Old private item');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await ready;
  await page.getByRole('button', { name: 'Home', exact: true }).last().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByLabel('Switch active shop').selectOption({ label: 'New Selected Shop' });
  release();
  await expect(page.getByRole('heading', { name: 'New Selected Shop' })).toBeVisible();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await expect(page.getByRole('button', { name: /Old private item/ })).toHaveCount(0);
  expect((await cacheKeys(page)).length).toBe(2);
});
test('sample camera drafts are discarded before opening a real shop', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Snap stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Try sample', exact: true }).click();
  await page.getByRole('button', { name: 'Review 2', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).last().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Switch shop' }).click();
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await page.getByLabel('Shop name').fill('Real Corner');
  await page.getByRole('button', { name: 'Open my shop' }).click();
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await expect(page.getByLabel('Product name')).toHaveValue('');
});

test('delayed private server errors are discarded after switching shops', async ({ page }) => {
  await connected(page, 'Error Account');
  const next = await page.request.post('/api/shops', {
    headers: { Origin: `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}` },
    data: { name: 'Clean Selected Shop' },
  });
  expect(next.ok()).toBe(true);
  await page.reload();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let ready!: () => void;
  const received = new Promise<void>((r) => {
    ready = r;
  });
  await page.route('**/api/sync', async (route) => {
    ready();
    await gate;
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Private Account A stock detail' }),
    });
  });
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await page.getByLabel('Product name').fill('Old draft');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await received;
  await page.getByRole('button', { name: 'Home', exact: true }).last().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByLabel('Switch active shop').selectOption({ label: 'Clean Selected Shop' });
  const response = page.waitForResponse('**/api/sync');
  release();
  await response;
  await expect(page.getByRole('heading', { name: 'Clean Selected Shop' })).toBeVisible();
  await expect(page.getByText('Private Account A stock detail', { exact: true })).toHaveCount(0);
});

test('same-shop writes serialize while a previous response is delayed', async ({ page }) => {
  await connected(page, 'Ordered Account');
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let ready!: () => void;
  const received = new Promise<void>((r) => {
    ready = r;
  });
  let count = 0;
  await page.route('**/api/sync', async (route) => {
    if (++count === 1) {
      const response = await route.fetch();
      ready();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await page.getByLabel('Product name').fill('First item');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await received;
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Product name').fill('Second item');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
  const done = page.waitForResponse('**/api/sync');
  release();
  await done;
  await expect(page.getByRole('button', { name: /Second item/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Second item/ })).toBeVisible();
});
