import { test, expect } from '@playwright/test';
test('device shop persists inventory, records a sale and keeps demo separate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await page.getByLabel('Shop name').fill('Test Corner');
  await page.getByRole('button', { name: 'Open my shop' }).click();
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await page.getByLabel('Product name').fill('Test rice');
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByLabel('You buy at').fill('80');
  await page.getByLabel('You sell at').fill('100');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('button', { name: /Test rice/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Test rice/ })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).last().click();
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await page.getByRole('button', { name: /Test rice/ }).click();
  await page.getByRole('button', { name: 'Save sale' }).click();
  await expect(page.getByText('Sale recorded')).toBeVisible();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await expect(page.getByRole('button', { name: /Test rice/ })).toContainText('9');
  await page.getByRole('button', { name: 'Home', exact: true }).last().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Switch shop' }).click();
  await page.getByRole('button', { name: 'Explore sample shop' }).click();
  await expect(page.getByText('Sample shop', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await expect(page.getByRole('button', { name: /Test rice/ })).toHaveCount(0);
});
test('phone screens stay within the viewport', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?demo=1');
    for (const label of ['Stock', 'Payments', 'Growth', 'Home']) {
      await page.getByRole('button', { name: label, exact: true }).last().click();
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test('server account can register, sign out and sign in again', async ({ page }) => {
  const email = `browser-${Date.now()}@example.test`;
  await page.goto('/');
  // Served by a GreenBiz server, accounts are a first-class path on the welcome screen.
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByLabel('Shop name').fill('Connected Corner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Browser-Test-9182');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connected Corner' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  // Served by a GreenBiz server, accounts are a first-class path on the welcome screen.
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Browser-Test-9182');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Connected Corner' })).toBeVisible();
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Session expired' }),
    }),
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create my shop' })).toBeVisible();
});

test('public customer submits a claim and merchant records receipt without fake verification', async ({
  page,
  browser,
}) => {
  const email = `invoice-${Date.now()}@example.test`;
  const headers = { Origin: `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}` };
  const registered = await page.request.post('/api/auth/register', {
    headers,
    data: {
      email,
      password: 'Invoice-Test-9182',
      shopName: 'Invoice Corner',
      owner: 'Test owner',
      location: 'Dhaka',
      phone: '01700000000',
      bkash: '01700000000',
    },
  });
  expect(registered.ok()).toBe(true);
  const product = await page.request.post('/api/actions', {
    headers,
    data: {
      type: 'product.save',
      product: {
        name: 'Invoice rice',
        category: 'Rice & lentils',
        unit: 'Bag',
        description: 'Test product',
        quantity: 10,
        cost: 80,
        price: 100,
        lowAt: 2,
        source: 'manual',
      },
    },
  });
  expect(product.ok()).toBe(true);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('greenbiz-mode', 'server'));
  await page.goto('/#/orders');
  await page.reload();
  await page.getByLabel('Customer name').fill('Invoice customer');
  await page.getByLabel('Order quantity Invoice rice').fill('2');
  await page.getByLabel('Delivery charge').fill('10');
  await page.getByRole('button', { name: 'Create payment link', exact: true }).click();
  const link = await page.locator('.created-link p').innerText();
  const context = await browser.newContext();
  const customer = await context.newPage();
  await customer.goto(link);
  await expect(customer.getByText('৳210', { exact: true })).toBeVisible();
  await customer.getByLabel('bKash TrxID').fill('ABCD123456');
  await customer.getByRole('button', { name: 'Submit for review' }).click();
  await expect(
    customer.getByRole('heading', { name: 'Your reference is with the shop' }),
  ).toBeVisible();
  await page.goto('/#/payments');
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByLabel('Review note').fill('Please correct the transaction reference.');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await customer.getByRole('button', { name: 'Refresh status' }).click();
  await customer.getByLabel('bKash TrxID').fill('ABCD654321');
  await customer.getByRole('button', { name: 'Submit corrected reference' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByLabel('Received amount').fill('210');
  await page.getByLabel('Review note').fill('Checked receipt in the shop account.');
  await page.getByRole('button', { name: 'Record receipt', exact: true }).click();
  await expect(page.getByText('Recorded manually', { exact: true })).toBeVisible();
  await customer.getByRole('button', { name: 'Refresh status' }).click();
  await expect(customer.getByRole('heading', { name: 'Receipt recorded by shop' })).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Payment verified' })).toHaveCount(0);
  await context.close();
});
