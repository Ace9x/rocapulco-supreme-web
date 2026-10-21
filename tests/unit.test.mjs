import test from 'node:test'; import assert from 'node:assert/strict';
import { estimateFare } from '../fare.js';
import { rankDrivers, transition, haversine, cumulative, pointAlong, nearestIndex, instruction } from '../dispatch.js';
test('minimum fare applies to tiny trips', () => assert.equal(estimateFare({ meters: 100, seconds: 30 }).total, 9.5));
test('fare grows with distance and time', () => {
  const a = estimateFare({ meters: 5000, seconds: 900 }), b = estimateFare({ meters: 10000, seconds: 1500 });
  assert.ok(b.total > a.total); assert.ok(a.low < a.total && a.high > a.total);
});
test('JFK-ish 15mi trip in plausible NYC range', () => { const f = estimateFare({ meters: 24140, seconds: 2400 }).total; assert.ok(f > 45 && f < 90, f); });
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
