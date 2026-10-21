// Fare model based on the NYC TLC yellow-cab meter structure (estimate only, not an official meter).
export const NYC_RATES = {
  base: 3.00,          // initial charge
  perMile: 3.50,       // $0.70 per 1/5 mile
  perSlowMinute: 0.70, // charged in slow/stopped traffic instead of distance
  slowShare: 0.25,     // assumed share of trip time in slow traffic
  improvement: 1.00,   // TLC improvement surcharge
  mta: 0.50,           // MTA state surcharge
  minimum: 8.00,
};
export function estimateFare({ meters, seconds, surge = 1, rates = NYC_RATES }) {
  if (!(meters >= 0) || !(seconds >= 0)) throw new Error('bad input');
  const miles = meters / 1609.344;
  const minutes = seconds / 60;
  const distance = miles * rates.perMile * (1 - rates.slowShare);
  const time = minutes * rates.slowShare * rates.perSlowMinute * 5; // slow minutes billed per minute
  let meter = (rates.base + distance + time) * surge;
  const subtotal = Math.max(rates.minimum, meter) + rates.improvement + rates.mta;
  const total = Math.round(subtotal * 100) / 100;
  return { miles: +miles.toFixed(2), minutes: Math.round(minutes), total,
    low: Math.round(total * 0.9 * 100) / 100, high: Math.round(total * 1.15 * 100) / 100 };
}
export const money = (n) => '$' + n.toFixed(2);
