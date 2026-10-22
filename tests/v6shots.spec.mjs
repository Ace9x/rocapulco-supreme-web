import { test, expect } from '@playwright/test'; import { newCtx, appUrl } from './staff-session.mjs';
const BASE = process.env.BASE || 'http://localhost:8099/', OUT = '/workspace/taxi-shots/v6/';
test.setTimeout(480000);
for (const [tag, vp, mob] of [['m', { width: 390, height: 844 }, true], ['d', { width: 1440, height: 900 }, false]]) {
  test(`v6 screens ${tag}`, async ({ browser }) => {
    const ctx = await newCtx(browser, { viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1, geolocation: { latitude: 40.6054, longitude: -73.7551 }, permissions: ['geolocation'] });
    const p = await ctx.newPage(), errs = [];
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|tile|ERR_/i.test(m.text())) errs.push(m.text()); });
    p.on('pageerror', e => errs.push(e.message));
    const NSV = `?transport=local&ns=v6${tag}${Date.now()}&speed=20`, u = (h) => appUrl(BASE, NSV, h);
    await p.goto(u('#/')); await expect(p.locator('#splash')).toBeVisible(); await p.waitForTimeout(700); await p.screenshot({ path: OUT + `${tag}-00-splash.png` });
    await expect(p.locator('#splash')).toHaveCount(0, { timeout: 4000 });
    await p.click('#onbskip');
    await expect(p.locator('#sheet')).not.toContainText('Channel'); await expect(p.locator('.rates')).toHaveCount(0);
    const fineC = await p.evaluate(() => getComputedStyle(document.querySelector('.fine') || document.body).color); expect(fineC).toBe('rgb(163, 163, 163)');
    const ab = await p.locator('.maplibregl-ctrl-attrib').boundingBox(), hb = await p.locator('header').boundingBox(); if (ab) expect(ab.y).toBeGreaterThanOrEqual(hb.y + hb.height - 4);
    await p.screenshot({ path: OUT + `${tag}-01-home.png` }); await p.click('#fares'); await p.screenshot({ path: OUT + `${tag}-01b-fares.png` });
    await p.evaluate(() => { localStorage.setItem('qc_profile_rider', JSON.stringify({ name: 'Ana Rivera', phone: '7185550123', id: 'rdr-x' })); });
    await p.goto(u('#/rider')); await expect(p.locator('#sc [data-sc=jfk]')).toContainText('$75'); await expect(p.locator('#sc [data-sc=lga]')).toContainText('$82.50');
    await expect(p.locator('#pu')).not.toHaveValue('', { timeout: 15000 });
    await p.screenshot({ path: OUT + `${tag}-02-where-to.png` });
    await p.locator('#sc [data-sc=jfk]').click(); await expect(p.locator('#fare')).toHaveText('$75.00', { timeout: 25000 });
    await expect(p.locator('#vc [data-v=sedan] .ds-badge.flat')).toContainText("Flat — won't change");
    await expect(p.locator('#vc [data-v=suv] .vp')).toHaveText('$112.50');
    await expect(p.locator('#vc')).toContainText('min away', { timeout: 15000 });
    await p.waitForTimeout(800); await p.screenshot({ path: OUT + `${tag}-03-car-cards-flat.png` });
    // count solid gold buttons: only #req
    const solid = await p.evaluate(() => [...document.querySelectorAll('button,a.btn')].filter(b => b.offsetParent && getComputedStyle(b).backgroundColor === 'rgb(230, 194, 90)').map(b => b.id));
    expect(solid).toEqual(['req']);
    if (mob) { const sb = await p.locator('#sheet').boundingBox(); await p.mouse.move(195, sb.y + 10); await p.mouse.down(); await p.mouse.move(195, sb.y + 300, { steps: 8 }); await p.mouse.up();
      await expect(p.locator('#sheet')).toHaveAttribute('data-snap', 'peek'); await p.waitForTimeout(500); await p.screenshot({ path: OUT + `${tag}-03b-sheet-peek.png` });
      const sb2 = await p.locator('#sheet').boundingBox(); await p.mouse.move(195, sb2.y + 10); await p.mouse.down(); await p.mouse.move(195, 150, { steps: 8 }); await p.mouse.up(); await expect(p.locator('#sheet')).toHaveAttribute('data-snap', 'full'); }
    await p.locator('#req').scrollIntoViewIfNeeded(); await p.check('#agree'); await p.click('#req');
    await expect(p.locator('.radar-ui')).toBeVisible(); await p.screenshot({ path: OUT + `${tag}-03c-searching-radar.png` });
    await expect(p.locator('#st')).toBeVisible({ timeout: 40000 }); await expect(p.locator('#trust')).toContainText('$75.00');
    await p.waitForTimeout(1500); await p.screenshot({ path: OUT + `${tag}-04-trip-trust-banner.png` });
    await p.click('#ropt'); await expect(p.locator('#rmenu')).toBeVisible(); await expect(p.locator('#rmenu .ra')).toHaveCount(await p.locator('#rmenu .ra').count());
    await expect(p.locator('#rmenu')).toContainText('Share trip'); await expect(p.locator('#rmenu')).toContainText('Edit drop-off'); await expect(p.locator('#rmenu')).toContainText('Safety');
    const last = await p.locator('#rmenu .ra').last().getAttribute('id'); expect(last).toBe('cx');
    await p.locator('#rmenu').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + `${tag}-05-ride-options.png` });
    await expect(p.locator('#done')).toBeVisible({ timeout: 150000 });
    await expect(p.locator('#rcpt')).toContainText('Booking #'); await expect(p.locator('#rcpt .plate')).toBeVisible(); await expect(p.locator('#rcpt .thumb')).toBeVisible();
    await expect(p.locator('#trust')).toBeVisible();
    await p.screenshot({ path: OUT + `${tag}-06-receipt.png` });
    await p.click('#prob'); await p.locator('input[value=charged_more]').check(); await p.fill('#ptx', 'test report'); await p.click('#psend'); await expect(p.locator('#probok')).toContainText('report #r-');
    await p.locator('#probok').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + `${tag}-07-report-sent.png` });
    await p.click('#fin'); await p.click('#hist'); await p.locator('.hist.trip').first().click(); await expect(p.locator('#rcpt')).toBeVisible(); await p.screenshot({ path: OUT + `${tag}-08-history-receipt.png` });
    // dispatch: seed a stale + a fresh driver and a waiting trip
    await p.goto(u('#/admin')); await expect(p.locator('#qtabs')).toBeVisible({ timeout: 20000 });
    await p.evaluate(() => { const b = window.__qc.bus, now = Date.now();
      b.publish('drivers/dx1', { id: 'dx1', name: 'Marcus', car: 'Cadillac XTS', plate: 'T710', status: 'available', lat: 40.606, lng: -73.757, ts: now }, { localOnly: true });
      b.publish('drivers/dx2', { id: 'dx2', name: 'Priya', car: 'Escalade', plate: 'T427', status: 'available', lat: 40.600, lng: -73.748, ts: now - 95000 }, { localOnly: true });
      b.publish('drivers/dx3', { id: 'dx3', name: 'Luis', car: 'CT6', plate: 'T944', status: 'available', lat: 40.612, lng: -73.762, ts: now - 4000 }, { localOnly: true });
      b.publish('trip/tq1', { type: 'request', trip: { id: 'tq1', rider: { name: 'Joan' }, pickup: { lat: 40.605, lng: -73.755, label: 'Mott Ave' }, dest: { label: 'JFK Airport, Queens' }, fare: 75, pay: 'card', ts: now - 60000 } }, { localOnly: true }); });
    await expect(p.locator('#qn')).toHaveText('1'); await expect(p.locator('.mk.ride')).toHaveCount(1);
    await expect(p.locator('#sheet .nosurge')).toHaveCount(0); await expect(p.locator('#nf')).toHaveCount(0);
    for (const b of await p.locator('#open [data-a]').all()) { const bb = await b.boundingBox(); expect(bb.height).toBeGreaterThanOrEqual(44); }
    await expect(p.locator('#dfresh .row.stale')).toContainText('Stale — not assignable'); await expect(p.locator('#open [data-a]')).toHaveCount(2);
    await expect(p.locator('#dfresh .row.stale')).toContainText('Priya'); await expect(p.locator('.mk.stale')).toHaveCount(1);
    await p.waitForTimeout(1500); await p.screenshot({ path: OUT + `${tag}-09-dispatch-queue.png` });
    await expect(p.locator('#dfresh .row.dragok')).toHaveCount(2); await expect(p.locator('#dfresh .row.stale')).not.toHaveClass(/dragok/);
    const pinF = await p.locator('.mk.car img').first().evaluate(e => getComputedStyle(e).filter); expect(pinF).toContain('grayscale');
    if (!mob) { const sb = await p.locator('#sheet').boundingBox(); expect(sb.y + sb.height).toBeGreaterThan(vp.height - 30); }
    await p.locator('#open .card.assign').dragTo(p.locator('#dfresh [data-fd=dx3]')); await expect(p.locator('#qa')).toHaveText('1'); await expect(p.locator('#qn')).toHaveText('0');
    await p.click('#qtabs [data-q=assigned]'); await expect(p.locator('#open')).toContainText('assigned to Luis');
    await p.screenshot({ path: OUT + `${tag}-10-dispatch-assigned.png` });
    await p.evaluate(() => localStorage.setItem('qc_profile_driver', JSON.stringify({ name: 'Luis Ortiz', phone: '7185550111', car: 'Cadillac Escalade', plate: 'T778812C', id: 'drv-x' })));
    await p.goto(u('#/driver')); await expect(p.locator('#tg')).toBeVisible({ timeout: 20000 }); await p.waitForTimeout(1000); await p.screenshot({ path: OUT + `${tag}-11-driver-steel.png` });
    expect(errs, errs.join('\n')).toEqual([]);
  });
}
