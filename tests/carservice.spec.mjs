import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/';
test.setTimeout(150000);
const SH = '/workspace/taxi-shots/v7/';
async function driver(ctx, qs, name, plate) {
  const d = await ctx.newPage(); await d.goto(BASE + 'driver/' + qs); if (await d.locator('input[name=name]').count() === 0) { await d.evaluate(() => localStorage.removeItem('qc_profile_driver')); await d.reload(); }
  await d.fill('input[name=name]', name); await d.fill('input[name=phone]', '7185550100'); await d.fill('input[name=car]', 'Black Camry'); await d.fill('input[name=plate]', plate); await d.click('text=Continue');
  await d.check('#sim'); await d.click('#tg'); if (await d.locator('#locyes').isVisible().catch(() => false)) await d.click('#locyes'); await expect(d.locator('#dst')).toContainText('Online'); return d;
}
test('car service: JFK queue, phone booking cascade (sandbox)', async ({ browser }) => {
  const qs = `?sandbox=1&transport=local&ns=sbxcs${Date.now()}&testfast=1&nosplash=1`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 40.6441, longitude: -73.7822 }, permissions: ['geolocation'] });
  const d1 = await driver(ctx, qs, 'Queue One', 'T000001C'); await expect(d1.locator('#qpos')).toHaveText(/#1 of/, { timeout: 15000 });
  const d2 = await driver(ctx, qs, 'Queue Two', 'T000002C'); await expect(d2.locator('#qpos')).toHaveText('#2 of 2', { timeout: 20000 });
  await d2.screenshot({ path: SH + 'cs-01-driver-queue.png' });
  const a = await ctx.newPage(); await a.setViewportSize({ width: 1280, height: 900 }); await a.goto(BASE + 'dispatch/' + qs + '#/admin');
  await expect(a.locator('#zq [data-zone=JFK]')).toContainText('1. Queue One · 2. Queue Two', { timeout: 20000 });
  await a.click('#phb summary'); await a.fill('#phphone', '718 555 0199'); await a.fill('#phname', 'Phone Caller');
  await a.fill('#phpu', 'JFK Terminal 4'); await a.locator('#phpul li').first().click({ timeout: 20000 });
  await a.fill('#phde', 'Far Rockaway'); await a.locator('#phdel li').first().click({ timeout: 20000 });
  await expect(a.locator('#phfare')).toHaveText(/\$/, { timeout: 25000 }); await a.click('#phgo');
  await expect(a.locator('#phpin')).toHaveText(/^\d{4}$/);
  await a.screenshot({ path: SH + 'cs-02-phone-booking.png' });
  await expect(d1.locator('#acc')).toBeVisible({ timeout: 20000 }); await d1.locator('#dec').click({ timeout: 5000 }); 
  await expect(d2.locator('#acc')).toBeVisible({ timeout: 20000 }); await a.click('#qtabs [data-q=assigned]'); await expect(a.locator('.dcl')).toContainText('Queue One: declined'); await expect(a.locator('.ocd')).toContainText('Queue Two'); await a.screenshot({ path: SH + 'cs-03-cascade.png' }); await d2.click('#acc');
  await expect(a.locator('body')).toContainText('driver en route', { timeout: 15000 }); await d2.click('#act'); await expect(d2.locator('#wt')).toBeVisible({ timeout: 10000 });
  await expect(d2.locator('#dcx')).toBeDisabled(); await expect(d2.locator('#dcx')).toBeEnabled({ timeout: 15000 }); await d2.screenshot({ path: SH + 'cs-04-noshow.png' }); await d2.click('#dcx');
  await expect(a.locator('body')).toContainText('rider no-show', { timeout: 15000 });
  await ctx.close();
});
