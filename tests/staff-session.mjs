// Test helper: staff screens live in /driver/ and /dispatch/ behind an invite-only login. Sign the e2e dispatcher test
// account in once (creds outside the repo) and seed that session into every browser context.
import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../cloud.js', import.meta.url), 'utf8'), U = SRC.match(/url: '([^']+)'/)[1], K = SRC.match(/anonKey: '([^']+)'/)[1];
let sess = null;
export async function staffSession() { if (sess) return sess; const users = JSON.parse(fs.readFileSync(process.env.ROC_TEST_USERS || '/workspace/.rr-secrets/taxi_test_users.json', 'utf8'));
  const c = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } }); const { data, error } = await c.auth.signInWithPassword(users.dispatcher); if (error) throw error; return (sess = data.session); }
export async function newCtx(browser, opt) { const ctx = await browser.newContext(opt); const s = await staffSession(); await ctx.addInitScript(v => localStorage.setItem('roca-sb-auth', v), JSON.stringify(s)); return ctx; }
// '#/driver' and '#/admin' now live in their own apps
export const appUrl = (base, qs, h) => h === '#/driver' ? `${base}driver/${qs}#/driver` : h === '#/admin' ? `${base}dispatch/${qs}#/admin` : `${base}${qs}${h}`;
