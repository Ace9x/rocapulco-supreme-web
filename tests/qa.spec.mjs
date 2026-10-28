import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/';
test.use({ geolocation: { latitude: 40.6054, longitude: -73.7551 }, permissions: ['geolocation'], viewport: { width: 390, height: 844 } });
test('real riders see no demo cars; /rider/ works; destination survives refresh; plain status', async ({ page: p }) => {
  await p.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
  await p.goto(BASE + 'rider/?transport=local&nosplash=1'); await expect(p).toHaveURL(/#\/rider$/); await expect(p.locator('#de')).toBeVisible();
  await expect(p.locator('#demo')).toHaveCount(0); await expect(p.locator('#demoban')).toHaveCount(0);
  await expect(p.locator('#pu')).not.toHaveValue('', { timeout: 20000 }); await p.waitForTimeout(3000); expect(await p.locator('.mk.sim').count()).toBe(0);
  await p.locator('#sc [data-sc=jfk]').click(); await expect(p.locator('#fare')).toHaveText('$75.00', { timeout: 25000 });
  await p.reload(); await expect(p.locator('#de')).toHaveValue(/JFK/, { timeout: 15000 }); await expect(p.locator('#fare')).toHaveText('$75.00', { timeout: 25000 });
  await expect(p.locator('#net')).toHaveText(/Test mode|Dispatch online/);
  await p.goto(BASE + '?nosplash=1#/rider'); await p.context().setOffline(true); await p.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(p.locator('#net a[href^="tel:"]')).toContainText('474-7100', { timeout: 5000 }); await p.context().setOffline(false);
  await p.goto(BASE + '?nosplash=1#/'); await p.click('#fares'); await expect(p.locator('#faresheet')).toContainText('Tolls'); await expect(p.locator('#faresheet')).toContainText('Extra stops');
  expect(await p.locator('.legal').innerText()).not.toMatch(/TLC Base #\s*(·|$)/);
});
