import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('output/screenshots', { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(e.message));
  for (const screen of [
    'home',
    'stock',
    'payments',
    'growth',
    'finance',
    'transactions',
    'sale',
    'advisor',
    'camera',
    'product',
    'settings',
    'orders',
    'customer',
  ]) {
    await page.goto('http://127.0.0.1:5173/?demo=1#/' + screen);
    await page.waitForSelector(
      screen === 'camera'
        ? '.camera-screen'
        : screen === 'customer'
          ? '.customer-page .card'
          : '.main-content',
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))));
    await page.screenshot({ path: `output/screenshots/greenbiz-${screen}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5173/?demo=1#/home');
  await page.waitForSelector('.kpi-grid');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'output/screenshots/greenbiz-dashboard.png' });
  await writeFile('output/screenshots/browser-errors.json', JSON.stringify(errors, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write('14 app screenshots captured; no browser page errors.\n');
} finally {
  await browser.close();
}
