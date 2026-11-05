import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/';
const OUT = process.env.OUT || 'qa/v25';
for (const vp of [{ w: 390, h: 844 }, { w: 412, h: 915 }]) {
  test.describe(`gate ${vp.w}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h }, geolocation: { latitude: 40.6054, longitude: -73.7551 }, permissions: ['geolocation'] });
    test(`rider quote+reload+offline ${vp.w}`, async ({ page: p }) => {
      const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(String(e)));
      await p.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
      await p.goto(BASE + '?transport=local&nosplash=1#/rider'); await expect(p.locator('#de')).toBeVisible();
      await expect(p.locator('link[href="highbeam.css"]')).toHaveCount(1);
      expect(await p.locator('#sheet').evaluate(e => getComputedStyle(e).borderTopLeftRadius)).toBe('28px');
      await p.locator('#sc [data-sc=jfk]').click(); await expect(p.locator('#fare')).toHaveText('$75.00', { timeout: 25000 });
      const req = p.locator('#req'); if (await req.count()) { const bg = await req.evaluate(e => getComputedStyle(e).backgroundColor); expect(bg).toBe('rgb(6, 193, 103)'); const bb = await req.boundingBox(); if (bb) expect(bb.height).toBeGreaterThanOrEqual(56); }
      // tap targets & overlap among visible sheet buttons
      const bad = await p.evaluate(() => { const r = []; const els = [...document.querySelectorAll('#sheet button, #sheet a.btn, header a, header button')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden'; });
        for (const e of els) { const b = e.getBoundingClientRect(); if (b.height < 44 && !e.closest('.sugg,.legal,.fine')) r.push('small:' + (e.id || e.textContent.trim().slice(0, 20)) + ':' + Math.round(b.height)); if (b.right > innerWidth + 1 && !e.closest('.pop,.shortcuts')) r.push('clip:' + (e.id || e.textContent.trim().slice(0, 20))); }
        return r; });
      expect(bad).toEqual([]);
      await p.screenshot({ path: `${OUT}/rider-quote-${vp.w}.png` });
      const txt = await p.locator('body').innerText(); expect(txt).not.toMatch(/\b(taxi|cab)\b/i);
      await p.reload(); await expect(p.locator('#fare')).toHaveText('$75.00', { timeout: 25000 });
      await p.context().setOffline(true); await p.evaluate(() => dispatchEvent(new Event('offline')));
      await expect(p.locator('#net a[href^="tel:"]')).toContainText('474-7100', { timeout: 5000 });
      await p.screenshot({ path: `${OUT}/rider-offline-${vp.w}.png` }); await p.context().setOffline(false);
      await p.goto(BASE + '?nosplash=1#/'); await expect(p.locator('body')).toContainText('B00639');
      await p.screenshot({ path: `${OUT}/home-${vp.w}.png` });
      await p.goto(BASE + 'rates.html'); await expect(p.locator('body')).toContainText(/no surge/i);
      console.log('ERRS', JSON.stringify(errs)); expect(errs.filter(e => !/tiles|Failed to load resource|ERR_INTERNET/.test(e))).toEqual([]);
    });
    test(`driver loads ${vp.w}`, async ({ page: p }) => {
      const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
      await p.goto(BASE + 'driver/?transport=local&nosplash=1'); await p.waitForTimeout(2500);
      await expect(p.locator('link[href="../highbeam.css"]')).toHaveCount(1);
      await p.screenshot({ path: `${OUT}/driver-${vp.w}.png` });
      const over = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.right > innerWidth + 1; }).map(e => e.id || e.textContent.trim().slice(0, 20)));
      expect(over).toEqual([]);
      expect(errs.filter(e => !/tiles|Failed to load resource/.test(e))).toEqual([]);
    });
  });
}
