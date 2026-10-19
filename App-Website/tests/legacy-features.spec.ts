import { test, expect, type Page } from '@playwright/test';

async function device(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await page.getByLabel('Shop name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Open my shop' }).click();
}
async function addProduct(page: Page, name: string, price = '100') {
  await page.goto('/#/product');
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByLabel('You sell at').fill(price);
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
}

test('mobile money sale attaches a payment that includes the cash-out charge and shows a receipt', async ({ page }) => {
  await device(page, 'Picker Store');
  await addProduct(page, 'Soybean oil');
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Paste SMS', exact: true }).click();
  await page
    .getByLabel('Payment message', { exact: true })
    .fill('You have received Tk 1,015.00 from 01712345678. Fee Tk 0.00. Balance Tk 9,000.00. TrxID BK12345678');
  await page.getByRole('button', { name: 'Review parsed payment' }).click();
  await page.getByRole('checkbox', { name: /These are business/ }).check();
  await page.getByRole('button', { name: 'Save reviewed records' }).click();
  await page.goto('/#/sale');
  await page.getByRole('button', { name: /Soybean oil/ }).click();
  await page.getByLabel('quantity of Soybean oil', { exact: true }).fill('10');
  await page.getByRole('button', { name: '← Mobile money' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mobile money payment' });
  await expect(sheet.getByText('+৳15 cash-out charge')).toBeVisible();
  await sheet.getByRole('button', { name: /BK12345678/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale recorded' })).toBeVisible();
  await expect(page.getByText('BK12345678', { exact: true })).toBeVisible();
  await expect(page.getByText(/Your credit profile is now \d+\/100/)).toBeVisible();
  await page.goto('/#/transactions');
  await expect(page.getByText('Linked to sale', { exact: true })).toBeVisible();
  await page.goto('/#/finance');
  // The sale counts once at its own total; the linked receipt is not added again.
  await expect(page.locator('.finance-split')).toContainText('৳1,000');
});

test('a far-off payment is recorded separately only after the owner agrees', async ({ page }) => {
  await device(page, 'Mismatch Store');
  await addProduct(page, 'Basmati');
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Paste SMS', exact: true }).click();
  await page.getByLabel('Payment message', { exact: true }).fill('You have received Tk 500.00 from 01712345678. TrxID FAR1234567');
  await page.getByRole('button', { name: 'Review parsed payment' }).click();
  await page.getByRole('checkbox', { name: /These are business/ }).check();
  await page.getByRole('button', { name: 'Save reviewed records' }).click();
  await page.goto('/#/sale');
  await page.getByRole('button', { name: /Basmati/ }).click();
  await page.getByRole('button', { name: '← Mobile money' }).click();
  await page.getByRole('button', { name: 'Look further back' }).click();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/totals do not match/);
    void dialog.accept();
  });
  await page.getByRole('dialog', { name: 'Payment messages' }).getByRole('button', { name: /FAR1234567/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale recorded' })).toBeVisible();
  await page.goto('/#/transactions');
  await expect(page.getByText('Linked to sale', { exact: true })).toHaveCount(0);
});

test('credit profile and the 39-product loan directory are available', async ({ page }) => {
  await page.goto('/?demo=1#/growth');
  await expect(page.getByRole('heading', { name: 'Credit profile' })).toBeVisible();
  await expect(page.getByText('What shapes your score')).toBeVisible();
  await expect(page.getByText(/\d+\/100 · 30% weight/)).toBeVisible();
  await page.getByRole('button', { name: 'Loan plans', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How much you can borrow' })).toBeVisible();
  await page.getByRole('button', { name: 'Browse all 39 products' }).click();
  await expect(page.locator('.plan-card')).toHaveCount(39);
  await page.getByLabel('Bank').selectOption({ label: 'BRAC Bank' });
  await expect(page.locator('.plan-card').first()).toContainText('BRAC Bank');
});

test('reports offer calendar periods with overview figures', async ({ page }) => {
  await page.goto('/?demo=1#/finance');
  await page.getByRole('button', { name: 'This year' }).click();
  await expect(page.getByText('Month by month')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Business overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top payers' })).toBeVisible();
  await page.getByRole('button', { name: 'Pick a month' }).click();
  await expect(page.getByLabel('Month', { exact: true })).toBeVisible();
});

test('quick restock saves a count without the full form', async ({ page }) => {
  await device(page, 'Restock Store');
  await addProduct(page, 'Lentils');
  await page.getByRole('button', { name: /Lentils/ }).click();
  await page.getByRole('button', { name: '+5', exact: true }).click();
  await page.getByRole('button', { name: 'Update stock' }).click();
  await expect(page.getByText('Stock updated to 15')).toBeVisible();
  await page.goto('/#/stock');
  await expect(page.getByRole('button', { name: /Lentils/ })).toContainText('15');
  await expect(page.getByRole('heading', { name: 'Stock at a glance' })).toBeVisible();
});

test('restored screens fit small phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ['growth', 'loans', 'advisor', 'finance', 'stock']) {
    await page.goto('/?demo=1#/' + route);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
