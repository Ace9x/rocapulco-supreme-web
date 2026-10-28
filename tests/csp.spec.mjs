import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/';
// CSP is on every page and nothing the app needs is blocked by it; hostile names render as text, never as HTML
for (const path of ['', 'driver/', 'dispatch/', 'privacy.html', 'terms.html', 'driver/join/', 'driver/join/apply.html']) test('csp ok: /' + path, async ({ page }) => {
  const bad = []; page.on('console', m => { if (/Content Security Policy/i.test(m.text())) bad.push(m.text()); }); page.on('pageerror', e => bad.push(e.message));
  await page.goto(BASE + path + (path === '' ? '?nosplash=1#/rider' : '')); await page.waitForTimeout(4000);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()).toBe(1); expect(bad).toEqual([]);
});
test('stored XSS payloads render as text', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('qc_onboarded', 'true'); localStorage.setItem('qc_history_rider', JSON.stringify([{ id: '<img src=x onerror=window.__x=1>', date: new Date().toISOString(), from: '<img src=x onerror=window.__x=1>', to: '<b>x</b>, Q', flat: 40.7, flng: -73.8, dlat: 40.75, dlng: -73.84, fare: 20, pay: 'cash', driver: '<svg onload=window.__x=1>', plate: '<i>p</i>' }])); });
  await page.goto(BASE + '?nosplash=1#/rider'); await page.click('#hist'); await page.locator('[data-h]').first().click(); await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__x)).toBeUndefined(); expect(await page.locator('#sheet img[src=x], #sheet svg[onload]').count()).toBe(0);
  await expect(page.locator('#sheet')).toContainText('<svg onload');
});
