import { test, expect } from '@playwright/test';
const BASE = process.env.BASE || 'http://localhost:8099/';
test.use({ browserName: process.env.BRW || 'chromium' });
const OUT = process.env.OUT || 'qa/v26';
test.setTimeout(120000);
const audit = p => p.evaluate(() => { const vis = [...document.querySelectorAll('#sheet button, #sheet a.btn, header button, header a')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && b.bottom > 0 && b.top < innerHeight; });
  const r = []; for (const e of vis) { const b = e.getBoundingClientRect(); const n = (e.id || e.textContent.trim()).slice(0, 24);
    if (b.height < 44 && !e.closest('.sugg,.legal,.fine')) r.push('small:' + n + ':' + Math.round(b.height));
    if (b.right > innerWidth + 1 && !e.closest('.pop,.shortcuts')) r.push('clip:' + n); }
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const a = vis[i].getBoundingClientRect(), c = vis[j].getBoundingClientRect();
    if (vis[i].contains(vis[j]) || vis[j].contains(vis[i]) || vis[i].closest('.pop,.shortcuts')) continue;
    const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (ox > 2 && oy > 2) r.push('overlap:' + (vis[i].id || vis[i].textContent.trim().slice(0, 15)) + '/' + (vis[j].id || vis[j].textContent.trim().slice(0, 15))); }
  return r; });
for (const vp of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 1280, height: 800 }]) {
  test(`dispatch sandbox ${vp.width}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, geolocation: { latitude: 40.6054, longitude: -73.7551 }, permissions: ['geolocation'] });
    if (process.env.BRW === 'webkit') await (typeof ctx !== 'undefined' ? ctx : p.context()).route(/^https:/, async r => { try { r.fulfill({ response: await r.fetch() }); } catch { r.abort(); } }); const errs = []; const watch = pg => { pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => m.type() === 'error' && !/Failed to load resource|tiles|TLS support is not available/.test(m.text()) && errs.push((m.text() + ' @' + (m.location()?.url||'')).slice(0, 220))); };
    const d = await ctx.newPage(); watch(d); await d.goto(BASE + 'driver/'); await d.click('#sbxgo'); await expect(d.locator('#sbxban')).toBeVisible();
    const qs = new URL(d.url()).search;
    const a = await ctx.newPage(); watch(a); await a.goto(BASE + 'dispatch/' + qs + '#/admin'); await expect(a.locator('#qtabs')).toBeVisible({ timeout: 20000 });
    await expect(a.locator('link[href="../highbeam.css"]')).toHaveCount(1);
    expect(await a.locator('body').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(0, 0, 0)');
    // every queue tab does what its label says: selects itself only
    const tabs = a.locator('#qtabs [data-q]'); const n = await tabs.count(); expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) { await tabs.nth(i).click(); for (let j = 0; j < n; j++) await expect(tabs.nth(j)).toHaveAttribute('aria-selected', String(i === j)); }
    await tabs.first().click();
    expect(await audit(a)).toEqual([]);
    await a.screenshot({ path: `${OUT}/dispatch-${vp.width}.png` });
    await a.reload(); await expect(a.locator('#qtabs')).toBeVisible({ timeout: 20000 });
    await ctx.setOffline(true); await a.reload().catch(() => {}); await a.waitForTimeout(2500);
    expect(await a.locator('body').innerText()).not.toMatch(/ERR_INTERNET|can.t be reached/i); await a.screenshot({ path: `${OUT}/dispatch-offline-${vp.width}.png` });
    await ctx.setOffline(false);
    const g = await ctx.newPage(); watch(g); await g.goto(BASE + 'owner-guide/');
    expect(await g.locator('body').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(0, 0, 0)');
    const pdf = await g.request.get(BASE + 'owner-guide/rocapulco_owner_guide.pdf'); expect(pdf.status()).toBe(200);
    expect(await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await g.screenshot({ path: `${OUT}/owner-guide-${vp.width}.png` });
    await g.goto(BASE + 'rates.html'); await expect(g.locator('body')).toContainText(/no surge/i);
    console.log('ERRS', vp.width, JSON.stringify(errs)); expect(errs).toEqual([]);
    await ctx.close();
  });
}
