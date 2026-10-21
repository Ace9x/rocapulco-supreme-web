import test from 'node:test'; import assert from 'node:assert/strict';
import { estimateFare } from '../fare.js';
import { rankDrivers, transition, haversine, cumulative, pointAlong, nearestIndex, instruction } from '../dispatch.js';
test('minimum fare applies to tiny trips', () => assert.equal(estimateFare({ meters: 100, seconds: 30 }).total, 8));
test('matches original fare.ts: 5mi/15min = $5+$12.50+$6 = $23.50', () => assert.equal(estimateFare({ meters: 5 * 1609.344, seconds: 900 }).total, 23.5));
test('airport flat rates', () => { assert.equal(estimateFare({ meters: 20000, seconds: 1800, dropoff: 'JFK Terminal 4' }).total, 45); assert.equal(estimateFare({ meters: 30000, seconds: 2400, dropoff: 'LaGuardia Airport' }).total, 55); });
test('fare grows with distance and time', () => {
  const a = estimateFare({ meters: 5000, seconds: 900 }), b = estimateFare({ meters: 10000, seconds: 1500 });
  assert.ok(b.total > a.total); assert.ok(a.low < a.total && a.high > a.total);
});

test('surge multiplies meter', () => assert.ok(estimateFare({ meters: 8000, seconds: 900, surge: 1.5 }).total > estimateFare({ meters: 8000, seconds: 900 }).total));
test('rejects bad input', () => assert.throws(() => estimateFare({ meters: -1, seconds: 1 })));
test('haversine ~1.11km per 0.01 lat', () => assert.ok(Math.abs(haversine({ lat: 40.7, lng: -73.8 }, { lat: 40.71, lng: -73.8 }) - 1112) < 5));
test('dispatch ranks nearest fresh available drivers, skips stale/busy/declined/far', () => {
  const now = 1e6, p = { lat: 40.75, lng: -73.85 };
  const ds = [
    { id: 'far', lat: 41.2, lng: -73.85, status: 'available', ts: now },
    { id: 'near', lat: 40.751, lng: -73.85, status: 'available', ts: now },
    { id: 'mid', lat: 40.76, lng: -73.85, status: 'available', ts: now },
    { id: 'busy', lat: 40.7501, lng: -73.85, status: 'busy', ts: now },
    { id: 'stale', lat: 40.7501, lng: -73.85, status: 'available', ts: now - 60000 },
    { id: 'declined', lat: 40.7502, lng: -73.85, status: 'available', ts: now },
  ];
  assert.deepEqual(rankDrivers(ds, p, { now, exclude: ['declined'] }).map(d => d.id), ['near', 'mid']);
});
test('trip state machine', () => {
  let s = 'requested';
  for (const e of ['offer', 'decline', 'offer', 'accept', 'arrive', 'start', 'complete']) s = transition(s, e);
  assert.equal(s, 'completed');
  assert.throws(() => transition('completed', 'cancel')); assert.throws(() => transition('requested', 'start'));
});
test('route geometry helpers', () => {
  const c = [[-73.8, 40.7], [-73.8, 40.71], [-73.8, 40.72]], cum = cumulative(c);
  assert.ok(Math.abs(pointAlong(c, cum, cum[2] / 2).lat - 40.71) < 1e-4);
  assert.equal(nearestIndex(c, { lat: 40.719, lng: -73.8 }).index, 2);
});
test('turn instructions', () => {
  assert.equal(instruction({ name: 'Queens Blvd', maneuver: { type: 'turn', modifier: 'left' } }), 'Turn left onto Queens Blvd');
  assert.equal(instruction({ maneuver: { type: 'arrive' } }), 'Arrive at destination');
});
import { offerEconomics, capSurge, SURGE_CAP } from '../fare.js';
import { homeFilterOk, rankByRoad, cancelStatus, noShowAllowed, scheduleState, smooth, FREE_CANCEL_MS, SCHED_LEAD_MS } from '../dispatch.js';
test('breakdown lines sum exactly to total (no hidden fees)', () => {
  for (const [m, s, sg] of [[100, 30, 1], [8000, 900, 1], [8000, 900, 1.4], [50000, 3000, 3]]) {
    const f = estimateFare({ meters: m, seconds: s, surge: sg });
    assert.equal(Math.round(f.lines.reduce((a, l) => a + l[1], 0) * 100) / 100, f.total);
  }
});
test('surge is off by default and capped', () => {
  assert.equal(estimateFare({ meters: 8000, seconds: 900 }).surge, 1);
  assert.equal(capSurge(3), SURGE_CAP); assert.equal(capSurge(0.5), 1);
  const a = estimateFare({ meters: 8000, seconds: 900 }).total, b = estimateFare({ meters: 8000, seconds: 900, surge: 9 }).total;
  assert.ok(Math.abs(b - a * SURGE_CAP) < 0.02);
});
test('surge never applies to airport flat rates', () => assert.equal(estimateFare({ meters: 20000, seconds: 1800, dropoff: 'JFK', surge: 1.5 }).total, 45));
test('offer economics $/mi', () => { const e = offerEconomics({ fare: 20, tripMeters: 1609.344 * 4, pickupMeters: 1609.344 }); assert.equal(e.perTripMile, 5); assert.equal(e.perTotalMile, 4); });
test('heading-home filter', () => {
  const home = { lat: 40.60, lng: -73.75 }, driver = { lat: 40.70, lng: -73.80 };
  assert.ok(homeFilterOk({ driver, home, dest: { lat: 40.62, lng: -73.76 } }));
  assert.ok(!homeFilterOk({ driver, home, dest: { lat: 40.78, lng: -73.85 } }));
  assert.ok(homeFilterOk({ driver, home: null, dest: { lat: 0, lng: 0 } }));
});
test('rank by road ETA beats straight line', () => {
  const r = rankByRoad([{ id: 'a', dist: 300 }, { id: 'b', dist: 900 }, { id: 'c', dist: 100 }], [600, 120, null]);
  assert.deepEqual(r.map(x => x.id), ['b', 'a', 'c']);
});
test('free-cancel window and late-driver exception', () => {
  assert.ok(cancelStatus({ matchedAt: 0, now: 1000, promisedEtaSec: 300, currentEtaSec: 280 }).free);
  assert.ok(!cancelStatus({ matchedAt: 0, now: FREE_CANCEL_MS + 1, promisedEtaSec: 600, currentEtaSec: 100 }).free);
  assert.ok(cancelStatus({ matchedAt: 0, now: FREE_CANCEL_MS + 1, promisedEtaSec: 120, currentEtaSec: 600 }).late);
});
test('no-show allowed 5 min after promised arrival', () => {
  assert.ok(!noShowAllowed({ matchedAt: 0, now: 400e3, promisedEtaSec: 300, arrived: false }));
  assert.ok(noShowAllowed({ matchedAt: 0, now: 601e3, promisedEtaSec: 300, arrived: false }));
  assert.ok(!noShowAllowed({ matchedAt: 0, now: 9e9, promisedEtaSec: 300, arrived: true }));
});
test('schedule states', () => {
  const T = 10 * SCHED_LEAD_MS;
  assert.equal(scheduleState({ pickupAt: T, now: T - SCHED_LEAD_MS - 1, matched: false }), 'waiting');
  assert.equal(scheduleState({ pickupAt: T, now: T - SCHED_LEAD_MS + 1, matched: false }), 'dispatching');
  assert.equal(scheduleState({ pickupAt: T, now: T - 1000, matched: true }), 'matched');
  assert.equal(scheduleState({ pickupAt: T, now: T + 16 * 60e3, matched: false }), 'expired');
});
test('eta smoothing', () => { assert.equal(smooth(null, 100), 100); assert.ok(smooth(100, 200) > 100 && smooth(100, 200) < 200); });
