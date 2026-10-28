// node tests/rpc-audit.mjs — server-side role checks (signed in as the dispatcher test account; creds never printed)
import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs'; import assert from 'node:assert/strict';
const SRC = fs.readFileSync(new URL('../cloud.js', import.meta.url), 'utf8'), U = SRC.match(/url: '([^']+)'/)[1], K = SRC.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/taxi_test_users.json', 'utf8'));
const anon = createClient(U, K, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const c = createClient(U, K, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const { data: s, error } = await c.auth.signInWithPassword(users.dispatcher); if (error) throw error;
const role = (await c.rpc('taxi_role')).data;
// anon can't call staff RPCs
for (const [fn, a] of [['apply_review', { p_id: crypto.randomUUID(), p_status: 'approved', p_note: null, p_needs: null }], ['review_driver', { p_user: crypto.randomUUID(), p_status: 'approved', p_note: null, p_handle_ok: true }], ['save_driver_docs', { p: {} }], ['find_user', { p_query: 'x' }]])
  assert.ok((await anon.rpc(fn, a)).error, 'anon blocked: ' + fn);
assert.match((await c.rpc('apply_review', { p_id: crypto.randomUUID(), p_status: 'approved', p_note: null, p_needs: null })).error?.message || '', /not found/);
if (role !== 'owner') assert.match((await c.rpc('review_driver', { p_user: s.user.id, p_status: 'approved', p_note: null, p_handle_ok: true })).error?.message || '', /own documents/);
let blocked = false; for (let i = 0; i < 7; i++) { const r = await c.rpc('find_user', { p_query: `nobody${i}@example.invalid` }); if (r.error) { blocked = /too many/.test(r.error.message); break; } }
assert.ok(blocked, 'email lookups rate-limited');
assert.ok(!(await c.rpc('find_user', { p_query: 'some_username' })).error, 'username lookups still work');
console.log('rpc audit ok (role ' + role + ')');
