// TLC compliance tests: trip-record CSV format (59B-19) and rate-schedule parity (59B-23). Run: node --test tests/tlc.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { TLC_HEADER, validateTlcCsv, validateTlcRow, tlcFilename, tlcDueDate, parseCsv } from '../tlc.js';
import { RATE_SCHEDULE, estimateFare, ratesFor } from '../fare.js';
import { SUPABASE } from '../cloud.js';
const official = readFileSync(new URL('./fixtures/tlc_csv_spec_template_November2018.csv', import.meta.url), 'utf8').split(/\r?\n/)[0];
const good = 'B00639,09-15-2026,14:10:05,5123456,T654321C,B00639,Exact Address,"1 Beach 116th St, Queens, NY 11694",-73.836410,40.580610,09-15-2026,14:41:30,Airport,"JFK Airport (Terminal 4), Queens",-73.782200,40.644100,,N,N,N,Y,09-15-2026,13:55:00,,,';
test('header is exactly the official TLC CSV template (26 columns, same order)', () => { assert.equal(TLC_HEADER.join(','), official); assert.equal(TLC_HEADER.length, 26); });
test('file name and due date follow TLC rules', () => { assert.equal(tlcFilename('B00639', '2026-09-01', '2026-09-30'), 'B00639_20260901-20260930.csv'); assert.equal(tlcDueDate('2026-09-30'), '2026-10-31'); assert.equal(tlcDueDate('2026-10-31'), '2026-11-30'); assert.equal(tlcDueDate('2026-12-31'), '2027-01-31'); });
test('server-format row (from a live dry run) passes validation, commas in addresses quoted', () => { const v = validateTlcCsv(official + '\r\n' + good + '\r\n'); assert.deepEqual(v.errors, []); assert.equal(v.rows, 1); assert.equal(parseCsv(good)[0][7], '1 Beach 116th St, Queens, NY 11694'); });
test('missing or bad license numbers are rejected', () => {
  const r = parseCsv(good)[0]; const bad = (i, v) => { const x = [...r]; x[i] = v; return validateTlcRow(x); };
  assert.ok(bad(0, '').includes('dispatching_base_number')); assert.ok(bad(3, '').includes('TLC_drivers_license_number')); assert.ok(bad(4, '').includes('license_plate'));
  assert.ok(bad(5, 'B639').includes('affiliated_base_number')); assert.ok(bad(1, '2026-09-15').includes('pickup date/time')); assert.ok(bad(2, '2:10 PM').includes('pickup date/time'));
  assert.ok(bad(8, '-73.83').length); assert.ok(bad(20, '').includes('WAV_request_flag')); assert.ok(validateTlcRow(r.slice(0, 25)).length); });
test('wrong header is rejected', () => { assert.equal(validateTlcCsv('a,b\r\n').ok, false); });
test('rate schedule: no surge, no extra fees, single version', () => { assert.equal(RATE_SCHEDULE.priceMultiplier, false); assert.equal(RATE_SCHEDULE.extraFees.length, 0); for (const m of [0, 1609, 50000]) assert.equal(estimateFare({ meters: m, seconds: 900 }).surge, 1); });
test('every quote is itemized, binding (no range) and lines sum to the total', () => { for (let i = 0; i < 300; i++) { const f = estimateFare({ meters: Math.random() * 60000, seconds: Math.random() * 5400, vclass: i % 2 ? 'suv' : 'sedan' }); assert.equal(Math.round(f.lines.reduce((a, l) => a + l[1], 0) * 100), Math.round(f.total * 100)); assert.equal(f.low, f.total); assert.equal(f.high, f.total); assert.ok(f.binding); } });
const live = process.env.OFFLINE ? test.skip : test;
async function rest(path, body) { const r = await fetch(SUPABASE.url + '/rest/v1/' + path, { method: body ? 'POST' : 'GET', headers: { apikey: SUPABASE.anonKey, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; }
live('LIVE: server rate schedule equals fare.js RATE_SCHEDULE', async () => { const { json } = await rest('taxi_rate_schedule?select=*&order=version.desc&limit=1'); const s = json[0], c = RATE_SCHEDULE.sedan;
  assert.deepEqual([+s.base, +s.per_mile, +s.per_minute, +s.minimum, +s.jfk_flat, +s.lga_flat, +s.suv_mult, s.price_multiplier, s.extra_fees.length, s.version, s.filed_with_tlc_confirmed], [c.base, c.perMile, c.perMinute, c.minimum, c.jfk, c.laguardia, RATE_SCHEDULE.suvMultiplier, false, 0, RATE_SCHEDULE.version, RATE_SCHEDULE.filedConfirmed]); });
live('LIVE: server binding quote equals the app quote to the cent (60 random trips + flats)', async () => {
  const cases = [...Array(60)].map((_, i) => ({ meters: Math.random() * 70000, seconds: Math.random() * 6000, vclass: i % 3 ? 'sedan' : 'suv', dropoff: i % 20 === 0 ? 'JFK Airport' : i % 20 === 1 ? 'LaGuardia Airport' : 'Somewhere' }));
  for (const c of cases) { const f = estimateFare(c); const { json } = await rest('rpc/rate_quote', { p_miles: f.miles, p_minutes: f.minutes, p_flat: f.flat === 'jfk' ? 'JFK' : f.flat === 'laguardia' ? 'LGA' : null, p_class: c.vclass }); assert.equal(+json, f.total, JSON.stringify({ c, f: f.total, server: json })); } });
live('LIVE: anonymous users cannot read or build TLC files', async () => { for (const fn of ['tlc_reports', 'tlc_generate_report', 'tlc_rows']) { const r = await rest('rpc/' + fn, {}); assert.ok(r.status >= 400, fn + ' ' + r.status); } const r = await rest('tlc_report_files?select=id'); assert.ok(r.status >= 400 || (Array.isArray(r.json) && !r.json.length)); });
live('LIVE: ride audit and trip records are not readable anonymously', async () => { for (const t of ['rides', 'ride_audit']) { const r = await rest(t + '?select=ext_id&limit=1'); assert.ok(r.status >= 400 || !r.json.length, t); } });
live('LIVE: TLC override RPCs and tables are closed to anonymous users', async () => {
  for (const [fn, body] of [['set_tlc_override', { p_driver: '00000000-0000-0000-0000-000000000000', p_reason: 'anonymous attempt here' }], ['revoke_tlc_override', { p_driver: '00000000-0000-0000-0000-000000000000', p_reason: 'x' }], ['tlc_driver_status', {}], ['tlc_override_active', { p_user: '00000000-0000-0000-0000-000000000000' }]]) { const r = await rest('rpc/' + fn, body); assert.ok(r.status >= 400, fn + ' ' + r.status); }
  for (const t of ['taxi_tlc_overrides', 'taxi_tlc_override_log']) { const r = await rest(t + '?select=*&limit=1'); assert.ok(r.status >= 400 || !r.json.length, t); } });
