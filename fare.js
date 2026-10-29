// ======================================================================================
// RATE SCHEDULE: the one place Rocapulco's rates live. 35 RCNY 59B-23(a): never quote or
// charge more than the Rate Schedule filed with TLC. Server mirror: public.taxi_rate_schedule
// (supabase/016_tlc_trip_records.sql); tests/tlc.test.mjs fails if the two ever differ.
// TODO(Fan): confirm these numbers ARE the Rate Schedule on file with TLC for base B00639.
//   Until confirmed, RATE_SCHEDULE.filedConfirmed stays false and the rates page says so.
// Source of current numbers: Fan's Rocapulco spec (Claude chats). No surge, no extra fees.
// ======================================================================================
export const RATE_SCHEDULE = Object.freeze({
  version: 1, effectiveFrom: '2026-10-28', filedConfirmed: false,
  sedan: Object.freeze({ base: 3.50, perMile: 2.50, perMinute: 0.40, minimum: 10.00, jfk: 75.00, laguardia: 82.50 }),
  suvMultiplier: 1.5, // Black SUV = every Sedan rate x 1.5
  priceMultiplier: false, // no surge / variable pricing, ever
  extraFees: Object.freeze([]), // no booking, service, WAV, airport or cancellation fees
  tollsNote: 'Tolls are not part of the quote; if your route has a toll it is paid to the driver at actual cost, no markup', // TODO(Fan): confirm the filed schedule passes tolls through at cost
});
export const RATES = { base: RATE_SCHEDULE.sedan.base, perMile: RATE_SCHEDULE.sedan.perMile, perMinute: RATE_SCHEDULE.sedan.perMinute, minimum: RATE_SCHEDULE.sedan.minimum };
export const FLAT_RATES = { jfk: RATE_SCHEDULE.sedan.jfk, laguardia: RATE_SCHEDULE.sedan.laguardia };
export const CLASS_MULT = { sedan: 1, suv: RATE_SCHEDULE.suvMultiplier };
export const CLASS_LABEL = { sedan: 'Black Sedan', suv: 'Black SUV' };
const r2_ = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const ratesFor = (vclass = 'sedan') => { const k = CLASS_MULT[vclass] || 1, s = RATE_SCHEDULE.sedan; return { base: r2_(s.base * k), perMile: s.perMile * k, perMinute: s.perMinute * k, minimum: r2_(s.minimum * k), jfk: r2_(s.jfk * k), laguardia: r2_(s.laguardia * k), mult: k }; };
export const SURGE_CAP = 1; // no surge, ever
export const DRIVER_SHARE = 0.70;
export const DISPATCH_PHONE = '(718) 474-7100', DISPATCH_TEL = '+17184747100';
// TLC for-hire base license number: Fan to provide. Leave '' until then (shows as a blank line).
export const TLC_BASE = 'B00639';
export const PAYMENTS = { cash: 'Cash', card: 'Card', zelle: 'Zelle', venmo: 'Venmo' };
const r2 = r2_;
// Exact-cent multiply (integer cents, half-up) so JS matches Postgres numeric rounding.
const mul = (qty, rate) => Math.round(Math.round(qty * 100) * Math.round(rate * 100) / 100) / 100;
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
  // Billed on 2-decimal miles and whole minutes so the server (public.rate_quote) reproduces it to the cent.
  const miles = r2(meters / 1609.344), minutes = Math.round(seconds / 60), flat = matchFlatRate(dropoff);
  let lines;
  if (flat) lines = [[`${flat === 'jfk' ? 'JFK' : 'LaGuardia'} flat rate`, rates[flat] ?? FLAT_RATES[flat]]];
  else {
    lines = [['Base fare', rates.base], [`Distance ${miles.toFixed(2)} mi × $${rates.perMile.toFixed(2)}`, mul(miles, rates.perMile)], [`Time ${minutes} min × $${rates.perMinute.toFixed(2)}`, mul(minutes, rates.perMinute)]];
    const sub = lines.reduce((a, l) => a + l[1], 0);
    if (r2(sub) < rates.minimum) lines.push(['Minimum fare adjustment', r2(rates.minimum - sub)]);
  }
  const total = r2(lines.reduce((a, l) => a + l[1], 0));
  // Binding upfront quote (59B-23(b)): one number, no range.
  return { vclass, miles, minutes, total, flat, surge: 1, lines, binding: true, rateVersion: RATE_SCHEDULE.version, low: total, high: total };
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
