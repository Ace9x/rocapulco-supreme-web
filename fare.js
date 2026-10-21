// Rocapulco Supreme fare model — ported from Fan's original packages/shared/src/fare.ts
// (Ace9x/rocapulco-supreme): $5 base + $2.50/mi + $0.40/min, $8 minimum, airport flat rates.
export const RATES = { base: 5.00, perMile: 2.50, perMinute: 0.40, minimum: 8.00 };
export const FLAT_RATES = { jfk: 45.00, laguardia: 55.00 };
export function matchFlatRate(dropoff = '') {
  const s = dropoff.toLowerCase();
  if (s.includes('jfk') || s.includes('john f. kennedy') || s.includes('kennedy international')) return 'jfk';
  if (s.includes('laguardia') || s.includes('la guardia') || /\blga\b/.test(s)) return 'laguardia';
  return null;
}
export function estimateFare({ meters, seconds, dropoff = '', surge = 1, rates = RATES }) {
  if (!(meters >= 0) || !(seconds >= 0)) throw new Error('bad input');
  const miles = meters / 1609.344, minutes = seconds / 60;
  const flat = matchFlatRate(dropoff);
  const total = flat ? FLAT_RATES[flat]
    : Math.round(Math.max(rates.minimum, (rates.base + miles * rates.perMile + minutes * rates.perMinute) * surge) * 100) / 100;
  return { miles: +miles.toFixed(2), minutes: Math.round(minutes), total, flat,
    low: flat ? total : Math.round(total * 0.9 * 100) / 100, high: flat ? total : Math.round(total * 1.15 * 100) / 100 };
}
export const money = (n) => '$' + n.toFixed(2);
