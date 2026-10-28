import { test, expect } from '@playwright/test'; import { newCtx, appUrl } from './staff-session.mjs';
const BASE = process.env.BASE || 'http://localhost:8099/', OUT = '/workspace/taxi-shots/v7/';
test.setTimeout(240000);
// synthetic document photos: a sharp high-contrast card, and the same card blurred
const photo = async (p, blur) => p.evaluate(async (blur) => { const c = document.createElement('canvas'); c.width = 900; c.height = 560; const x = c.getContext('2d');
  x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, 900, 560); x.fillStyle = '#123'; x.font = 'bold 44px sans-serif'; x.fillText('NEW YORK STATE', 40, 80); x.font = '28px monospace';
  for (let i = 0; i < 9; i++) x.fillText('ID 123 456 789  DOB 01-01-1990  CLASS E ' + i, 40, 150 + i * 42);
  if (blur) { const o = document.createElement('canvas'); o.width = 900; o.height = 560; const y = o.getContext('2d'); y.filter = 'blur(9px)'; y.drawImage(c, 0, 0); return o.toDataURL('image/png'); } return c.toDataURL('image/png'); }, blur);
const setFile = async (p, sel, dataUrl, name) => p.setInputFiles(sel, { name, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
test('careers page works without JS (JobPosting + OG); 3-step apply saves progress; blur check; dispatch review → invite', async ({ browser }) => {
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }); const c = await nojs.newPage();
  await c.goto(BASE + 'driver/join/'); await expect(c.locator('h1')).toHaveText('Drive with Rocapulco'); await expect(c.locator('#apply')).toBeVisible();
  const ld = JSON.parse(await c.locator('script[type="application/ld+json"]').textContent()); expect(ld['@type']).toBe('JobPosting'); expect(ld.hiringOrganization.name).toBe('Rocapulco Supreme'); expect(ld.jobLocation.address.addressLocality).toBe('Queens');
  expect(await c.locator('meta[property="og:title"]').getAttribute('content')).toContain('Drive with Rocapulco'); expect(await c.locator('meta[property="og:image"]').getAttribute('content')).toMatch(/og\.png$/);
  expect(await c.locator('body').innerText()).not.toMatch(/\b(taxi|cab)\b/i);
  await c.screenshot({ path: OUT + 'apply-01-careers.png', fullPage: true });
  await c.goto(BASE + 'driver/join/es.html'); await expect(c.locator('h1')).toHaveText('Maneja con Rocapulco'); await c.screenshot({ path: OUT + 'apply-02-careers-es.png' }); await nojs.close();

  const actx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const a = await actx.newPage(); const name = 'Test Applicant ' + Date.now().toString(36);
  await a.goto(BASE + 'driver/join/apply.html'); await a.click('#next'); await expect(a.locator('#msg')).toContainText('required');
  await a.fill('#name', name); await a.fill('#phone', '718' + String(Math.floor(1e6 + Math.random() * 8e6))); await a.selectOption('#area', 'Queens'); await a.click('#next');
  await expect(a.locator('#msg')).toContainText('Saved'); await a.check('#has_tlc'); await a.fill('#tlc_license', '5512345'); await a.fill('#vehicle', '2021 Toyota Camry'); await a.fill('#fhv_plate', 't123456c');
  await a.screenshot({ path: OUT + 'apply-03-step2.png' }); await a.click('#next'); await expect(a.locator('.steps')).toHaveAttribute('aria-label', 'Step 3 of 3');
  await a.reload(); await expect(a.locator('.steps')).toHaveAttribute('aria-label', 'Step 3 of 3');  // progress survives reload
  const sharp = await photo(a, false), blurry = await photo(a, true);
  await setFile(a, '#f-license', sharp, 'license.png'); await expect(a.locator('#m-license')).toContainText('clear', { timeout: 20000 });
  await a.fill('#e-license', '2029-05-01');
  await setFile(a, '#f-tlc', blurry, 'tlc.png'); await expect(a.locator('#m-tlc')).toContainText('blurry', { timeout: 20000 });
  await a.screenshot({ path: OUT + 'apply-04-docs-blur.png', fullPage: true });
  await setFile(a, '#f-insurance', sharp, 'ins.png'); await expect(a.locator('#m-insurance')).toContainText('clear', { timeout: 20000 });
  await a.click('#next'); await expect(a.locator('#apst')).toContainText('Application received', { timeout: 20000 });
  await a.screenshot({ path: OUT + 'apply-05-submitted.png' });

  const dctx = await newCtx(browser, { viewport: { width: 1280, height: 900 } }); const d = await dctx.newPage();
  await d.goto(appUrl(BASE, '?transport=local&nosplash=1', '#/admin')); const card = d.locator('.rev', { hasText: name });
  await expect(card).toBeVisible({ timeout: 30000 }); await expect(card).toContainText('TLC #5512345'); await expect(card.locator('.adoc img')).toHaveCount(3); await expect(card).toContainText('blurry'); await expect(card).toContainText('missing');
  await card.scrollIntoViewIfNeeded(); await d.screenshot({ path: OUT + 'apply-06-dispatch-review.png' });
  await card.locator('[data-act=ask]').click(); await card.locator('input[value=tlc]').check(); await card.locator('input[value=registration]').check(); await card.locator('.rnote').fill('TLC photo is blurry, and registration is missing');
  await card.locator('[data-go]').click(); await expect(d.locator('.rev', { hasText: name })).toContainText('waiting on docs', { timeout: 15000 });

  await a.click('#chk'); await expect(a.locator('#apst')).toContainText('TLC Driver License', { timeout: 15000 }); await expect(a.locator('#apst')).toContainText('registration is missing');
  await setFile(a, '#f-tlc', sharp, 'tlc2.png'); await expect(a.locator('#m-tlc')).toContainText('clear', { timeout: 20000 });
  await setFile(a, '#f-registration', sharp, 'reg.png'); await expect(a.locator('#m-registration')).toContainText('clear', { timeout: 20000 });
  await a.click('#next'); await expect(a.locator('#apst')).toContainText('Application received', { timeout: 20000 });

  await d.reload(); const c2 = d.locator('.rev', { hasText: name }); await expect(c2.locator('.adoc img')).toHaveCount(4, { timeout: 30000 }); await expect(c2).not.toContainText('blurry');
  await c2.locator('[data-act=approve]').click(); await expect(d.locator('.card.hist', { hasText: name }).locator('[data-copy]')).toBeVisible({ timeout: 15000 });
  await a.click('#chk'); await expect(a.locator('#invlink')).toHaveAttribute('href', /driver\/\?invite=[0-9A-F]{12}$/, { timeout: 15000 });
  await a.screenshot({ path: OUT + 'apply-07-approved.png' });
  await actx.close(); await dctx.close();
});
