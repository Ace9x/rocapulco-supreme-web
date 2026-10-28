import { test, expect } from '@playwright/test'; import { newCtx, appUrl } from './staff-session.mjs';
const BASE = process.env.BASE || 'http://localhost:8099/', OUT = '/workspace/taxi-shots/v7/', ns = 'gr' + Date.now();
test.setTimeout(300000);
const mob = { viewport: { width: 390, height: 844 }, isMobile: true, geolocation: { latitude: 40.7128, longitude: -73.8314 }, permissions: ['geolocation'] };
test('fare first, deep link + referral, rating actions, rebook/reverse', async ({ browser }) => {
  const ctx = await browser.newContext(mob); const r = await ctx.newPage(); r.on('pageerror', e => console.log('PAGEERR', e.message));
  // deep link from a flyer / driver QR: lands on a priced SUV quote to JFK, no form first
  await r.goto(`${BASE}?transport=local&ns=${ns}&speed=20&nosplash=1&demo=1&to=JFK&car=suv&ref=DT555555C`);
  await expect(r.locator('#fare')).toContainText('$112.50', { timeout: 30000 });
  await expect(r.locator('#gname')).toHaveValue(''); await r.locator('#contact').scrollIntoViewIfNeeded();
  await r.screenshot({ path: OUT + 'growth-01-fare-first-deeplink.png' });
  expect(await r.evaluate(() => JSON.parse(localStorage.getItem('qc_ref_in')).code)).toBe('DT555555C');
  await r.check('#agree'); await r.click('#req'); await expect(r.locator('#gname')).toBeFocused();  // asks for contact only now
  await r.click('[data-v=sedan]').catch(() => {}); // back to sedan for a quicker demo trip if the class picker uses data-v
  await r.fill('#de', 'Flushing Meadows Corona Park'); await r.locator('#del li[data-i]').first().click({ timeout: 15000 });
  await expect(r.locator('#fare')).toContainText('$', { timeout: 20000 });
  await r.fill('#gname', 'Growth Rider'); await r.fill('#gphone', '718' + String(Math.random()).slice(2, 9));
  const sent = r.evaluate(() => new Promise(res => { window.__qc.bus.subscribe('trip/+', (m) => { if (m?.type === 'request') res(m.trip.ref); }); setTimeout(() => res('timeout'), 30000); }));
  await r.click('#req'); await expect(r.locator('.demo')).toBeVisible({ timeout: 20000 });
  expect(await sent).toBe('DT555555C');
  await expect(r.locator('#done')).toBeVisible({ timeout: 200000 });
  await expect(r.locator('#paidst')).toContainText('confirmed', { timeout: 15000 });
  await r.locator('.stars button[data-s="5"]').click(); await expect(r.locator('#shareask')).toBeVisible(); await expect(r.locator('#smsref')).toHaveAttribute('href', /ref%3DR[2-9A-Z]{5}/);
  await r.locator('#shareask').scrollIntoViewIfNeeded(); await r.screenshot({ path: OUT + 'growth-02-five-stars-share.png' });
  await r.locator('.stars button[data-s="2"]').click(); await expect(r.locator('#sorry')).toBeVisible(); await expect(r.locator('#probf')).not.toBeEmpty();
  await r.screenshot({ path: OUT + 'growth-03-two-stars-report.png' });
  await r.click('#fin'); await r.click('#hist'); await expect(r.locator('[data-rb]').first()).toBeVisible();
  await r.screenshot({ path: OUT + 'growth-04-rebook-reverse.png' });
  await r.locator('[data-rv]').first().click(); await expect(r.locator('#de')).not.toHaveValue(/Flushing Meadows/, { timeout: 10000 }); await expect(r.locator('#pu')).toHaveValue(/Flushing Meadows|Corona/, { timeout: 10000 });
  await expect(r.locator('#fare')).toContainText('$', { timeout: 25000 });
  await expect(r.locator('#gname')).toHaveValue('Growth Rider');   // remembered after the first ride
  await r.screenshot({ path: OUT + 'growth-05-reversed-quote.png' });
  await r.goto(`${BASE}?transport=local&ns=${ns}&nosplash=1`); await expect(r.locator('#drivecta')).toHaveAttribute('href', 'driver/join/');
  await ctx.close();
});
test('driver seatback QR card encodes the referral deep link', async ({ browser }) => {
  const ctx = await newCtx(browser, { viewport: { width: 390, height: 844 } }); const d = await ctx.newPage();
  await d.goto(appUrl(BASE, `?transport=local&ns=${ns}&nosplash=1`, '#/driver'));
  if (await d.locator('input[name=car]').isVisible({ timeout: 15000 }).catch(() => false)) { await d.fill('input[name=name]', 'QR Driver'); await d.fill('input[name=phone]', '7185550123'); await d.fill('input[name=car]', 'Black Camry'); await d.fill('input[name=plate]', 'T555555C'); await d.click('text=Continue'); }
  await d.locator('#qrc summary').scrollIntoViewIfNeeded(); await d.locator('#qrc summary').click(); await expect(d.locator('#qrbox svg')).toBeVisible();
  expect(await d.locator('#qrbox svg').getAttribute('aria-label')).toMatch(/\?ref=D[A-Z0-9]+$/);
  await d.locator('#qrc').scrollIntoViewIfNeeded(); await d.screenshot({ path: OUT + 'growth-06-driver-qr.png' });
  await ctx.close();
});
