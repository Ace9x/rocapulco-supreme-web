// Rocapulco Supreme fare model — ported from Fan's original packages/shared/src/fare.ts
// (Ace9x/rocapulco-supreme): $5 base + $2.50/mi + $0.40/min, $8 minimum, airport flat rates.
export const RATES = { base: 5.00, perMile: 2.50, perMinute: 0.40, minimum: 8.00 };
export const FLAT_RATES = { jfk: 45.00, laguardia: 55.00 };
export const SURGE_CAP = 1.5; // hard cap; surge is off (1.0) unless the dispatcher turns it on with a reason
const r2 = (n) => Math.round(n * 100) / 100;
export function matchFlatRate(dropoff = '') {
  const s = dropoff.toLowerCase();
  if (s.includes('jfk') || s.includes('john f. kennedy') || s.includes('kennedy international')) return 'jfk';
  if (s.includes('laguardia') || s.includes('la guardia') || /\blga\b/.test(s)) return 'laguardia';
  return null;
}
export const capSurge = (s) => Math.min(SURGE_CAP, Math.max(1, +s || 1));
// Returns total plus an itemized breakdown whose lines always sum to the total (no hidden fees).
export function estimateFare({ meters, seconds, dropoff = '', surge = 1, rates = RATES }) {
  if (!(meters >= 0) || !(seconds >= 0)) throw new Error('bad input');
  const miles = meters / 1609.344, minutes = seconds / 60, flat = matchFlatRate(dropoff);
  const s = flat ? 1 : capSurge(surge);
  let lines;
  if (flat) lines = [[`${flat === 'jfk' ? 'JFK' : 'LaGuardia'} flat rate`, FLAT_RATES[flat]]];
  else {
    lines = [['Base fare', rates.base], [`Distance ${miles.toFixed(1)} mi × $${rates.perMile.toFixed(2)}`, r2(miles * rates.perMile)], [`Time ${Math.round(minutes)} min × $${rates.perMinute.toFixed(2)}`, r2(minutes * rates.perMinute)]];
    const sub = lines.reduce((a, l) => a + l[1], 0);
    if (sub < rates.minimum) lines.push(['Minimum fare adjustment', r2(rates.minimum - sub)]);
    if (s > 1) { const cur = lines.reduce((a, l) => a + l[1], 0); lines.push([`Busy-time ×${s.toFixed(2)} (capped at ×${SURGE_CAP})`, r2(cur * (s - 1))]); }
  }
  const total = r2(lines.reduce((a, l) => a + l[1], 0));
  return { miles: +miles.toFixed(2), minutes: Math.round(minutes), total, flat, surge: s, lines,
    low: flat ? total : r2(total * 0.9), high: flat ? total : r2(total * 1.15) };
}
export const money = (n) => '$' + n.toFixed(2);
// Driver economics shown on the offer card before accepting.
export function offerEconomics({ fare, tripMeters, pickupMeters }) {
  const tm = tripMeters / 1609.344, pm = pickupMeters / 1609.344;
  return { perTripMile: tm > 0 ? r2(fare / tm) : 0, perTotalMile: tm + pm > 0 ? r2(fare / (tm + pm)) : 0, pickupMiles: +pm.toFixed(1) };
}
