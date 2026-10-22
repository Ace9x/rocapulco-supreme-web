// Test helper: staff screens live in /driver/ and /dispatch/ behind an invite-only login. Sign the e2e dispatcher test
// account in once (creds outside the repo) and seed that session into every browser context.
import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../cloud.js', import.meta.url), 'utf8'), U = SRC.match(/url: '([^']+)'/)[1], K = SRC.match(/anonKey: '([^']+)'/)[1];
let sess = null;
export async function staffSession() { if (sess) return sess; const users = JSON.parse(fs.readFileSync(process.env.ROC_TEST_USERS || '/workspace/.rr-secrets/taxi_test_users.json', 'utf8'));
  const c = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } }); const { data, error } = await c.auth.signInWithPassword(users.dispatcher); if (error) throw error; sess = data.session;
  // one signing key for the whole test run (the server caps new device keys per hour), stored next to the creds, never in the repo
  const KF = '/workspace/.rr-secrets/taxi_test_staffkey.json'; let kk = null; try { kk = JSON.parse(fs.readFileSync(KF, 'utf8')); } catch {}
  if (kk?.uid === sess.user.id) { const { data: ok } = await c.rpc('staff_key', { p_kid: kk.kid }); if (!ok?.length) kk = null; } else kk = null;
  if (!kk) { const { subtle } = globalThis.crypto; const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await subtle.exportKey('jwk', pair.publicKey), priv = await subtle.exportKey('jwk', pair.privateKey);
    const { data: kid, error: e2 } = await c.rpc('register_staff_key', { p_pub: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y } }); if (e2) throw e2;
    kk = { uid: sess.user.id, kid, priv }; fs.writeFileSync(KF, JSON.stringify(kk), { mode: 0o600 }); }
  sess.__key = kk; return sess; }
export async function newCtx(browser, opt) { const ctx = await browser.newContext(opt); const s = await staffSession(); const { __key, ...plain } = s;
  await ctx.addInitScript(([v, k]) => { localStorage.setItem('roca-sb-auth', v); localStorage.setItem('roca_staff_key_' + k.uid, JSON.stringify({ kid: k.kid, priv: k.priv })); }, [JSON.stringify(plain), __key]); return ctx; }
// '#/driver' and '#/admin' now live in their own apps
export const appUrl = (base, qs, h) => h === '#/driver' ? `${base}driver/${qs}#/driver` : h === '#/admin' ? `${base}dispatch/${qs}#/admin` : `${base}${qs}${h}`;

// Driver app: make sure this test account has unexpired documents on file, then go online.
export async function goOnline(d) {
  await d.click('#tg'); if (await d.locator('#locyes').isVisible().catch(() => false)) await d.click('#locyes');
  if (await d.locator('#blocked').count() === 0) { try { await d.locator('#dst').filter({ hasText: 'Online' }).waitFor({ timeout: 4000 }); return; } catch {} }
  if (await d.locator('#blocked').count()) {
    const y = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
    await d.locator('#docs').evaluate(e => e.open = true);
    await d.fill('[name=tlc_driver_license]', '5512345'); await d.fill('[name=tlc_vehicle_license]', 'T123456C');
    for (const k of ['dmv_exp', 'tlc_exp', 'reg_exp', 'ins_exp']) await d.fill(`[name=${k}]`, y);
    await d.click('#docsave'); await d.locator('#docsave').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await d.click('#tg');
  }
  await d.locator('#dst').filter({ hasText: 'Online' }).waitFor({ timeout: 15000 });
}
