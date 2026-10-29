// Rocapulco Supreme fare model (from Fan's Claude chats, Rocapulco spec):
// Black Sedan: $3.50 base + $2.50/mi + $0.40/min, $10 minimum, JFK flat $75, LGA flat $82.50. NO SURGE, EVER.
// Black SUV: every Sedan rule x1.5 ($15 minimum, JFK $112.50, LGA $123.75).
// 70% of every fare goes to the driver, 30% to Rocapulco.
export const RATES = { base: 3.50, perMile: 2.50, perMinute: 0.40, minimum: 10.00 };
export const CLASS_MULT = { sedan: 1, suv: 1.5 };
export const ratesFor = (vclass = 'sedan') => { const k = CLASS_MULT[vclass] || 1; return { base: RATES.base * k, perMile: RATES.perMile * k, perMinute: RATES.perMinute * k, minimum: RATES.minimum * k, jfk: FLAT_RATES.jfk * k, laguardia: FLAT_RATES.laguardia * k, mult: k }; };
export const FLAT_RATES = { jfk: 75.00, laguardia: 82.50 };
export const SURGE_CAP = 1; // no surge, ever
export const DRIVER_SHARE = 0.70;
export const DISPATCH_PHONE = '(718) 474-7100', DISPATCH_TEL = '+17184747100';
// TLC for-hire base license number: Fan to provide. Leave '' until then (shows as a blank line).
export const TLC_BASE = 'B00639';
export const PAYMENTS = { cash: 'Cash', card: 'Card', zelle: 'Zelle', venmo: 'Venmo' };
const r2 = (n) => Math.round(n * 100) / 100;
export function matchFlatRate(dropoff = '') {
  const s = dropoff.toLowerCase();
  if (s.includes('jfk') || s.includes('john f. kennedy') || s.includes('kennedy international')) return 'jfk';
  if (s.includes('laguardia') || s.includes('la guardia') || /\blga\b/.test(s)) return 'laguardia';
  return null;
}
export const capSurge = () => 1; // any surge request is ignored
// Returns total plus an itemized breakdown whose lines always sum to the total (no hidden fees).
export function estimateFare({ meters, seconds, dropoff = '', vclass = 'sedan', rates = ratesFor(vclass) }) {
  if (!(meters >= 0) || !(seconds >= 0)) throw new Error('bad input');
  const miles = meters / 1609.344, minutes = seconds / 60, flat = matchFlatRate(dropoff);
  let lines;
  if (flat) lines = [[`${flat === 'jfk' ? 'JFK' : 'LaGuardia'} flat rate`, rates[flat] ?? FLAT_RATES[flat]]];
  else {
    lines = [['Base fare', rates.base], [`Distance ${miles.toFixed(1)} mi × $${rates.perMile.toFixed(2)}`, r2(miles * rates.perMile)], [`Time ${Math.round(minutes)} min × $${rates.perMinute.toFixed(2)}`, r2(minutes * rates.perMinute)]];
    const sub = lines.reduce((a, l) => a + l[1], 0);
    if (sub < rates.minimum) lines.push(['Minimum fare adjustment', r2(rates.minimum - sub)]);
  }
  const total = r2(lines.reduce((a, l) => a + l[1], 0));
  return { vclass, miles: +miles.toFixed(2), minutes: Math.round(minutes), total, flat, surge: 1, lines,
    low: flat ? total : r2(total * 0.9), high: flat ? total : r2(total * 1.15) };
}
// Driver/company split; the two parts always add back up to the fare.
export function split(fare) { const driver = r2(fare * DRIVER_SHARE); return { driver, company: r2(fare - driver) }; }
export const money = (n) => '$' + n.toFixed(2);
export function offerEconomics({ fare, tripMeters, pickupMeters }) {
  const tm = tripMeters / 1609.344, pm = pickupMeters / 1609.344;
  return { perTripMile: tm > 0 ? r2(fare / tm) : 0, perTotalMile: tm + pm > 0 ? r2(fare / (tm + pm)) : 0, pickupMiles: +pm.toFixed(1), driverTake: split(fare).driver };
}
// Six popular Far Rockaway destinations (one tap = destination set).
export const POPULAR = [
  { k: 'JFK', label: 'JFK Airport (Terminal 4), Queens', lat: 40.6441, lng: -73.7822 },
  { k: 'LGA', label: 'LaGuardia Airport, Queens', lat: 40.7769, lng: -73.8740 },
  { k: 'Beach', label: 'Rockaway Beach, Beach 116th St, Queens', lat: 40.5806, lng: -73.8364 },
  { k: 'A train', label: 'Far Rockaway–Mott Av (A), Queens', lat: 40.6034, lng: -73.7554 },
  { k: 'Hospital', label: "St. John's Episcopal Hospital, Far Rockaway", lat: 40.5986, lng: -73.7520 },
  { k: 'Mall', label: 'Green Acres Mall, Valley Stream', lat: 40.6620, lng: -73.7240 },
];
export const ORS_KEY = ''; // Fan: free openrouteservice key (account.heigit.org, Standard plan permits commercial use). Empty = interim Valhalla + estimates.
