// Accounts / separate apps / invite-only staff, against the live Supabase project. Needs test creds outside the repo:
// ROC_TEST_USERS=/workspace/.rr-secrets/taxi_test_users.json  PHASE=1 (signups) then (operator confirms emails) PHASE=2 (invited driver signs in)
import { test, expect } from '@playwright/test'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8099/', OUT = '/workspace/taxi-shots/', PHASE = process.env.PHASE || '2';
const U = JSON.parse(fs.readFileSync(process.env.ROC_TEST_USERS || '/workspace/.rr-secrets/taxi_test_users.json', 'utf8'));
const VIEWS = { m: { width: 390, height: 844 }, d: { width: 1440, height: 900 } };
const signIn = async (p, u) => { await p.click('#gin'); await p.fill('#gf [name=email]', u.email); await p.fill('#gf [name=password]', u.password); await p.click('#ggo'); };
test.describe.configure({ mode: 'serial' });
for (const [tag, vp] of Object.entries(VIEWS)) {
  test(`rider app ${tag}: no staff links, OAuth buttons render (hidden until enabled, live when enabled)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
    await p.goto(BASE + '#/'); await expect(p.locator('#go-rider')).toBeVisible();
    expect(await p.locator('a[href*="driver"], a[href*="#/admin"], a[href*="dispatch/"], #go-driver').count()).toBe(0);
    await expect(p.locator('nav.tabs')).toHaveCount(0); await p.screenshot({ path: OUT + `${tag}-rider-home.png` });
    await p.goto(BASE + '#/rider'); await expect(p.locator('#og')).toHaveCount(1); await expect(p.locator('#og')).toBeHidden(); await expect(p.locator('#oa')).toBeHidden(); // providers off on the server today
    // with Google enabled on the server, the button shows and starts the Supabase OAuth redirect back to this site
    const ctx2 = await browser.newContext({ viewport: vp }); const q = await ctx2.newPage(); await q.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
    await q.route('**/auth/v1/settings', r => r.fulfill({ json: { external: { google: true, apple: false, email: true } } }));
    await q.goto(BASE + '#/rider'); await expect(q.locator('#og')).toBeVisible(); await expect(q.locator('#oa')).toBeHidden(); await expect(q.locator('#pf input[name=phone]')).toBeVisible();
    await q.screenshot({ path: OUT + `${tag}-rider-account-google.png`, fullPage: true });
    const [req] = await Promise.all([q.waitForRequest(r => /\/auth\/v1\/authorize\?provider=google/.test(r.url()), { timeout: 10000 }), q.click('#og')]);
    expect(decodeURIComponent(req.url())).toContain('redirect_to=' + BASE);
    // apple button too (hidden until enabled)
    const ctx3 = await browser.newContext({ viewport: vp }); const a = await ctx3.newPage(); await a.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
    await a.route('**/auth/v1/settings', r => r.fulfill({ json: { external: { google: true, apple: true } } })); await a.goto(BASE + '#/rider'); await expect(a.locator('#oa')).toBeVisible(); await a.screenshot({ path: OUT + `${tag}-rider-account-google-apple.png`, fullPage: true });
    // old hash links to staff screens leave the rider app
    await p.goto(BASE + '#/driver'); await expect(p).toHaveURL(/\/driver\//); await expect(p.locator('#gf')).toBeVisible();
    expect(errs).toEqual([]); await ctx.close(); await ctx2.close(); await ctx3.close(); });
  test(`staff apps ${tag}: login screens, own manifests`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp }); const p = await ctx.newPage();
    for (const [app, name] of [['driver', 'Rocapulco Driver'], ['dispatch', 'Rocapulco Dispatch']]) { await p.goto(BASE + app + '/'); await expect(p.locator('#sheet h1')).toHaveText(name); await expect(p.locator('#gf')).toBeVisible();
      const m = await (await p.request.get(BASE + app + '/manifest.json')).json(); expect(m.name).toBe(name); await p.screenshot({ path: OUT + `${tag}-${app}-login.png` }); }
    await ctx.close(); });
}
test('rider account cannot open driver or dispatch apps (server role check)', async ({ browser }) => {
  const p = await (await browser.newContext({ viewport: VIEWS.m })).newPage(); await p.goto(BASE + 'driver/'); await signIn(p, U.rider);
  await expect(p.locator('#noaccess')).toBeVisible({ timeout: 15000 }); await expect(p.locator('#noaccess')).toContainText('rider account'); await p.screenshot({ path: OUT + 'm-rider-blocked-driver.png' });
  await p.goto(BASE + 'dispatch/'); await expect(p.locator('#noaccess')).toBeVisible({ timeout: 15000 }); await expect(p.locator('#sbk')).toHaveCount(0);
  // and the data itself is closed: a rider session cannot read the dispatch queue or create invites
  const r = await p.evaluate(async () => { const c = await import('../cloud.js'); const s = await c.sb(); const q = await s.from('taxi_bookings').select('id').neq('rider', (await c.session()).user.id); const i = await s.from('invites').insert({ role: 'driver' }); return { rows: q.data?.length ?? -1, inv: !!i.error }; });
  expect(r.rows).toBe(0); expect(r.inv).toBe(true); });
test('invite-only: bogus code rejected; dispatcher redeems invite, creates a driver invite link + QR', async ({ browser }) => {
  const p = await (await browser.newContext({ viewport: VIEWS.d })).newPage(); await p.goto(BASE + 'driver/?invite=NOTREAL123');
  await p.fill('#gf [name=name]', 'X'); await p.fill('#gf [name=email]', 'nobody@example.com'); await p.fill('#gf [name=password]', 'longenough1');
  const sent = []; p.on('request', r => { if (/auth\/v1\/signup/.test(r.url())) sent.push(1); }); await p.click('#ggo'); await expect(p.locator('#gm')).toContainText('invalid, expired or already used'); expect(sent.length).toBe(0);
  await p.goto(BASE + 'dispatch/'); await signIn(p, U.dispatcher); await expect(p.locator('#rdm, #sbk')).toBeVisible({ timeout: 15000 });
  if (await p.locator('#rdm').count()) { await p.fill('#rdm [name=code]', U.dispInvite); await p.click('#rdm button'); } await expect(p.locator('#sheet')).toContainText('Dispatch Center', { timeout: 15000 });
  await expect(p.locator('#invD')).toBeVisible({ timeout: 15000 }); await p.click('#invD'); await expect(p.locator('#invLink')).toHaveValue(/\/driver\/\?invite=[0-9A-F]{12}$/); await expect(p.locator('#invQR')).toHaveAttribute('src', /^data:image/, { timeout: 10000 });
  await p.screenshot({ path: OUT + 'd-dispatch-invite.png' }); U.driverInvite = await p.locator('#invLink').inputValue(); fs.writeFileSync(process.env.ROC_TEST_USERS || '/workspace/.rr-secrets/taxi_test_users.json', JSON.stringify(U));
  // reuse is impossible: the same code can't be redeemed twice
  const again = await p.evaluate(async code => { const c = await import('../cloud.js'); return (await (await c.sb()).rpc('check_invite', { p_code: code })).data; }, U.dispInvite); expect(again).toBeNull(); });
test('driver sign-up via invite link creates a staff account; sign-up without invite stays a rider', async ({ browser }) => {
  test.skip(PHASE !== '1', 'signup emails are rate limited; run once with PHASE=1');
  const p = await (await browser.newContext({ viewport: VIEWS.m })).newPage(); await p.goto(U.driverInvite.replace(/^https?:\/\/[^/]+\/(rocapulco-supreme-web\/)?/, BASE));
  await expect(p.locator('#gf [name=code]')).toHaveValue(/[0-9A-F]{12}/); await p.fill('#gf [name=name]', 'Invited Test Driver'); await p.fill('#gf [name=email]', U.newdriver.email); await p.fill('#gf [name=password]', U.newdriver.password);
  await p.click('#ggo'); await expect(p.locator('#gm')).toContainText(/Check your email|Dispatch|Driver/, { timeout: 20000 }); await p.screenshot({ path: OUT + 'm-driver-invite-signup.png' });
  // without an invite: even asking for role=driver in metadata, the server makes a rider
  const r = await p.evaluate(async u => { const c = await import('../cloud.js'); const s = await c.sb(); const { error } = await s.auth.signUp({ email: u.email, password: u.password, options: { data: { role: 'driver', taxi_role: 'driver' } } }); return error?.message || 'ok'; }, U.noinvite);
  expect(r).toBe('ok'); });
test('invited driver signs in to the driver app; no-invite account is rejected', async ({ browser }) => {
  test.skip(PHASE !== '2', 'after confirming PHASE=1 emails');
  const p = await (await browser.newContext({ viewport: VIEWS.m })).newPage(); await p.goto(BASE + 'driver/'); await signIn(p, U.newdriver);
  await expect(p.locator('#gf, #noaccess')).toHaveCount(0, { timeout: 15000 }); await expect(p.locator('#pf input[name=car]')).toBeVisible(); await p.screenshot({ path: OUT + 'm-driver-app-in.png' });
  const q = await (await browser.newContext({ viewport: VIEWS.m })).newPage(); await q.goto(BASE + 'driver/'); await signIn(q, U.noinvite); await expect(q.locator('#noaccess')).toBeVisible({ timeout: 15000 }); await q.screenshot({ path: OUT + 'm-noinvite-rejected.png' });
  await q.goto(BASE + 'dispatch/'); await expect(q.locator('#noaccess')).toBeVisible({ timeout: 15000 }); });
