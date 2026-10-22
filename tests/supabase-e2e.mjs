// Live server test: guest books a ride via book_ride (fare rules checked), Dispatch Center signs in, sees it in realtime, assigns + completes; rider cancel path. Cleans up.
// BASE=url RR_TEST_USERS=/path node tests/supabase-e2e.mjs
import { chromium } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../cloud.js', import.meta.url), 'utf8'), U = SRC.match(/url: '([^']+)'/)[1], K = SRC.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync(process.env.ROC_TEST_USERS || '/workspace/.rr-secrets/taxi_test_users.json')), BASE = process.env.BASE || 'http://localhost:8767/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const G = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } });
const PH = '+1555' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const book = async (x) => (await G.rpc('book_ride', { p: { ext_id: 't-e2e-' + crypto.randomUUID(), rider_name: 'E2E Test Rider', rider_phone: PH.slice(0, -2) + String(Math.floor(Math.random() * 100)).padStart(2, '0'), pickup_address: 'Beach 20th St, Far Rockaway', dropoff_address: x.to, est_miles: x.mi, est_minutes: x.min, flat_rate: x.flat, vehicle_class: x.cls, payment_method: 'venmo' } }));
const a = await book({ to: 'Jamaica Center', mi: 6, min: 20 }), j = await book({ to: 'JFK Terminal 4', mi: 9, min: 25, flat: 'JFK' }), l = await book({ to: 'LaGuardia', mi: 15, min: 35, flat: 'LGA' });
ok(!a.error && Number(a.data[0].fare_estimate) === 26.5, 'guest booking, metered fare $26.50'); ok(Number(j.data[0].fare_estimate) === 75 && Number(l.data[0].fare_estimate) === 82.5, 'Sedan JFK $75 / LGA $82.50 flat');
const sv = await Promise.all([book({ to: 'Jamaica Center', mi: 6, min: 20, cls: 'suv' }), book({ to: 'JFK', mi: 9, min: 25, flat: 'JFK', cls: 'suv' }), book({ to: 'LGA', mi: 15, min: 35, flat: 'LGA', cls: 'suv' }), book({ to: 'corner', mi: 0.3, min: 2, cls: 'suv' }), book({ to: 'corner', mi: 0.3, min: 2 })]);
const fe = sv.map(x => Number(x.data?.[0]?.fare_estimate)); ok(fe.join() === '39.75,112.5,123.75,15,10', 'server SUV fares 1.5x (metered $39.75, JFK $112.50, LGA $123.75, min $15; Sedan min $10): ' + fe.join());
const rs = await G.from('ride_stats').insert({ pu_lat: 40.6, pu_lng: -73.75, pu_name: 'E2E', do_name: 'E2E', dow: 3, hour: 18, wait_sec: 240, ride_sec: 900 }); ok(!rs.error, 'ride_stats: anon insert');
const rr = await G.from('ride_stats').select('id'); ok((rr.data || []).length === 0, 'ride_stats: anon cannot read');
const { data: peek } = await G.from('taxi_bookings').select('id'); ok(peek.length === 0, 'guests cannot list bookings');
const st = (await G.rpc('ride_status', { p_id: a.data[0].id, p_token: a.data[0].token })).data[0]; ok(st.status === 'requested', 'rider can check own status with token');
ok((await G.rpc('rider_cancel', { p_id: l.data[0].id, p_token: crypto.randomUUID() })).data == null, 'wrong token cannot cancel');
ok((await G.rpc('rider_cancel', { p_id: l.data[0].id, p_token: l.data[0].token })).data === 'cancelled_rider', 'rider cancel with token');
const b = await chromium.launch(), p = await b.newPage(); p.on('pageerror', e => console.log('PAGE ERROR', e.message)); p.on('dialog', d => d.accept());
await p.goto(BASE + 'dispatch/'); await p.waitForSelector('#gf', { timeout: 30000 }); await p.click('#gup');
const reqs = []; p.on('request', r => { if (/\/auth\/v1\/signup/.test(r.url())) reqs.push(r.url()); });
const msgAfter = async () => { await p.click('#ggo'); await p.waitForTimeout(600); return p.textContent('#gm'); };
ok(/Enter your email/.test(await msgAfter()), 'empty form: clear email error');
await p.fill('#gf [name=email]', 'not-an-email'); ok(/doesn.t look right/.test(await msgAfter()), 'bad email format rejected');
await p.fill('#gf [name=email]', 'a@b.co'); await p.fill('#gf [name=password]', 'short'); ok(/at least 8/.test(await msgAfter()), 'short password rejected');
ok(reqs.length === 0, 'no sign-up request sent for invalid input (no 422)'); await p.click('#gin'); await p.fill('#gf [name=email]', users.dispatcher.email); await p.fill('#gf [name=password]', users.dispatcher.password); await p.click('#ggo');
const card = `[data-sb="${a.data[0].id}"]`; ok(await p.waitForSelector(card, { timeout: 20000 }).then(() => true).catch(() => false), 'Dispatch Center (signed in) lists server booking');
await p.fill(card + ' [data-dn]', 'Test Driver'); await p.click(card + ' [data-as]'); ok(await p.waitForSelector(card + ' [data-st="assigned"]', { timeout: 15000 }).then(() => true).catch(() => false), 'one-tap assign saved');
for (const s of ['en_route', 'arrived', 'in_progress', 'completed']) { await p.click(card + ' [data-nx]'); await p.waitForSelector(card + ` [data-st="${s}"]`, { timeout: 15000 }); }
ok((await G.rpc('ride_status', { p_id: a.data[0].id, p_token: a.data[0].token })).data[0].status === 'completed', 'rider sees completed'); await p.screenshot({ path: '/workspace/queens-cab-shots-supabase.png', fullPage: true });
const nb = await book({ to: 'Rockaway Beach', mi: 2, min: 8 }); ok(await p.waitForSelector(`[data-sb="${nb.data[0].id}"]`, { timeout: 15000 }).then(() => true).catch(() => false), 'new booking appears live (realtime)');
await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); fs.writeFileSync('/tmp/qc-e2e-ids.json', JSON.stringify([a, j, l, nb, ...sv].map(x => x.data[0].id))); process.exit(fails ? 1 : 0);
