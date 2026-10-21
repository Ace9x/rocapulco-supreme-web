import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/', OUT = '/workspace/taxi-shots/v4/';
test.setTimeout(300000);
for (const [tag, vp, mob] of [['m', { width: 390, height: 844 }, true], ['d', { width: 1440, height: 900 }, false]]) {
  test(`v4 screens ${tag} ${vp.width}x${vp.height}, no console errors`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1, geolocation: { latitude: 40.6054, longitude: -73.7551 }, permissions: ['geolocation'] });
    const p = await ctx.newPage(), errs = [];
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|tile|ERR_/i.test(m.text())) errs.push(m.text()); });
    p.on('pageerror', e => errs.push(e.message));
    const u = (h) => `${BASE}?transport=local&ns=v4${tag}${Date.now()}&speed=20${h}`;
    await p.goto(u('#/')); await expect(p.locator('#onb')).toBeVisible();
    await p.waitForTimeout(1500); await p.screenshot({ path: OUT + `${tag}-01-onboarding.png` });
    await p.click('#onbnext'); await p.click('#onbnext'); await p.click('#onbnext'); await expect(p.locator('#onb')).toHaveCount(0);
    await expect(p.locator('#hcall')).toHaveAttribute('href', 'tel:+17184747100');
    await p.screenshot({ path: OUT + `${tag}-02-home.png` });
    const now = new Date(), day = now.toISOString().slice(0, 10);
    const seed = [['Beach 20th St', 40.605, -73.755], ['Beach 20th St', 40.605, -73.755], ['Mott Ave', 40.603, -73.754], ['Mott Ave', 40.603, -73.754], ['Mott Ave', 40.603, -73.754]].map(([n, a, b], i) => ({ pu: { lat: a, lng: b }, puName: n, doName: 'JFK', dow: now.getDay(), hour: now.getHours(), wait: 180 + i * 30, ride: 900, day }));
    await p.evaluate((s) => { localStorage.setItem('qc_learn', JSON.stringify(s)); localStorage.setItem('qc_profile_rider', JSON.stringify({ name: 'Ana Rivera', phone: '7185550123', id: 'rdr-x' })); localStorage.setItem('qc_history_rider', JSON.stringify([{ id: 't1', date: new Date(Date.now() - 864e5).toISOString(), from: 'Beach 20th St, Far Rockaway', to: 'JFK Airport, Queens', fare: 50, pay: 'zelle', driver: 'Marcus', stars: 5 }])); }, seed);
    await p.goto(u('#/rider')); await expect(p.locator('#pps')).toContainText('Mott Ave'); await expect(p.locator('#bh')).toContainText('learned from 5');
    await p.locator('#pop [data-p]').first().click(); await expect(p.locator('#fare')).toContainText('$', { timeout: 25000 });
    await expect(p.locator('#vc .ds-option')).toHaveCount(2); await expect(p.locator('#vc')).toContainText('min away', { timeout: 15000 });
    await p.locator('#vc [data-v=suv]').click(); await expect(p.locator('#vc [data-v=suv]')).toHaveAttribute('aria-checked', 'true');
    await p.waitForTimeout(1500); await p.screenshot({ path: OUT + `${tag}-03-rider-where-to.png` });
    await p.locator('#vc').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + `${tag}-04-vehicle-classes.png` });
    await p.click('#wal'); await expect(p.locator('#sheet')).toContainText('Wallet'); await p.screenshot({ path: OUT + `${tag}-05-wallet.png` });
    await p.click('#bk2'); await p.click('#hist'); await expect(p.locator('.hist.trip')).toHaveCount(1); await p.screenshot({ path: OUT + `${tag}-06-history.png` });
    await p.click('#bk'); await p.locator('#vc [data-v=sedan]').click(); await p.click('#req');
    await expect(p.locator('#st')).toBeVisible({ timeout: 40000 }); await expect(p.locator('.plate')).toBeVisible();
    await p.waitForTimeout(2500); await p.screenshot({ path: OUT + `${tag}-07-driver-arriving.png` });
    await expect(p.locator('#done')).toBeVisible({ timeout: 120000 }); await p.locator('.stars [data-s="5"]').click(); await expect(p.locator('#tags')).toBeVisible();
    await p.locator('#tags button').first().click(); await p.screenshot({ path: OUT + `${tag}-08-rating.png` });
    await p.evaluate(() => localStorage.setItem('qc_profile_driver', JSON.stringify({ name: 'Luis Ortiz', phone: '7185550111', car: 'Cadillac Escalade', plate: 'T778812C', id: 'drv-x' })));
    await p.goto(u('#/driver')); await expect(p.locator('#tg')).toBeVisible(); await p.waitForTimeout(1200); await p.screenshot({ path: OUT + `${tag}-09-driver.png` });
    await p.goto(u('#/admin')); await expect(p.locator('#sheet')).toContainText('Dispatch Center'); await p.waitForTimeout(1200); await p.screenshot({ path: OUT + `${tag}-10-dispatch.png` });
    expect(errs, errs.join('\n')).toEqual([]);
  });
}
