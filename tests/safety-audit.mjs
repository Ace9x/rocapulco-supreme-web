// node tests/safety-audit.mjs — 014 safety/verification checks against the live project (test accounts; creds never printed)
import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs'; import assert from 'node:assert/strict';
const SRC = fs.readFileSync(new URL('../cloud.js', import.meta.url), 'utf8'), U = SRC.match(/url: '([^']+)'/)[1], K = SRC.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/taxi_test_users.json', 'utf8'));
const mk = () => createClient(U, K, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const anon = mk(), rider = mk(), disp = mk();
await rider.auth.signInWithPassword(users.rider); const { data: ds } = await disp.auth.signInWithPassword(users.dispatcher);
// RLS: riders see no other rider's data, no driver docs, no rides table rows, no complaints/applications
for (const t of ['taxi_driver_docs', 'rides', 'ride_events', 'taxi_complaints', 'taxi_applications', 'taxi_application_docs', 'lookup_log']) {
  const r = await rider.from(t).select('*').limit(5); assert.ok(r.error || r.data.length === 0, 'rider sees nothing in ' + t);
  const a = await anon.from(t).select('*').limit(5); assert.ok(a.error || a.data.length === 0, 'anon sees nothing in ' + t); }
const rb = await rider.from('taxi_bookings').select('rider').limit(50); const rid = (await rider.auth.getUser()).data.user.id;
assert.ok(!rb.error && rb.data.every(b => b.rider === rid), 'rider only sees own bookings');
// staff-only RPCs refused for riders/anon
for (const [fn, a] of [['save_driver_photo', { p_photo: null, p_car: 'x' }], ['expiring_docs', { p_days: 30 }]]) assert.ok((await anon.rpc(fn, a)).error, 'anon blocked: ' + fn);
assert.match((await rider.rpc('save_driver_photo', { p_photo: null, p_car: 'x' })).error?.message || '', /staff only/);
assert.deepEqual((await rider.rpc('expiring_docs', { p_days: 30 })).data, [], 'rider sees no expiring docs');
// photo column rejects non-JPEG payloads
assert.ok((await disp.rpc('save_driver_photo', { p_photo: '<svg onload=alert(1)>', p_car: null })).error, 'non-jpeg photo refused');
// share link: bogus tokens reveal nothing; share-token mint needs the rider token
assert.deepEqual((await anon.rpc('ride_shared', { p_share: crypto.randomUUID() })).data, []);
assert.match((await anon.rpc('ride_share_token', { p_id: crypto.randomUUID(), p_token: crypto.randomUUID() })).error?.message || '', /not your booking/);
// TLC Open Data edge function: anon refused, rider refused, dispatcher gets a structured answer or a clear error
const fa = await fetch(U + '/functions/v1/tlc-verify', { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: '{}' }); assert.equal(fa.status, 401);
const rr = await rider.functions.invoke('tlc-verify', { body: {} }); assert.ok(rr.error, 'rider refused by tlc-verify');
const dv = await disp.functions.invoke('tlc-verify', { body: {} }); let body = dv.data; if (dv.error) body = await dv.error.context.json();
assert.ok('driver_active' in body || /documents first|minute/.test(body.error), 'tlc-verify responds: ' + JSON.stringify(body).slice(0, 120));
// go-online gate lists the new verification requirements
const gate = (await disp.rpc('driver_ready')).data?.[0]; assert.ok(gate && Array.isArray(gate.problems));
// NYC Open Data datasets reachable (the live check depends on them)
for (const ds of ['xjfq-wh2d', '8wbx-tsch']) assert.equal((await fetch(`https://data.cityofnewyork.us/resource/${ds}.json?$limit=1`)).status, 200);
console.log('safety audit ok', JSON.stringify({ tlc: 'driver_active' in body ? 'checked' : body.error, gate: gate.problems.length + ' open items' }));
