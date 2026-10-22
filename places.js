// Local knowledge for NYC/Long Island pickups. Coordinates are approximate entrances (~100 m); riders can drag the pin.
// Meeting notes are general guidance only — the driver messages the exact door/level for each pickup.
const DEP = 'Departures (upper level): driver drops you at the curb for your airline.';
const ARR = "Arrivals: follow signs for app-ride / for-hire vehicle pickup. Your driver will message the exact door — don't go with anyone else.";
export const AIRPORTS = {
  JFK: { name: 'JFK', flat: true, terminals: [
    ['T1', 'JFK Airport Terminal 1, Queens', 40.6433, -73.7898], ['T4', 'JFK Airport Terminal 4, Queens', 40.6441, -73.7822],
    ['T5', 'JFK Airport Terminal 5, Queens', 40.6455, -73.7766], ['T6', 'JFK Airport Terminal 6 (new), Queens', 40.6462, -73.7795],
    ['T7', 'JFK Airport Terminal 7, Queens', 40.6487, -73.7826], ['T8', 'JFK Airport Terminal 8, Queens', 40.6468, -73.7898]] },
  LGA: { name: 'LaGuardia', flat: true, terminals: [
    ['A', 'LaGuardia Airport Terminal A (Marine Air), Queens', 40.7731, -73.8857], ['B', 'LaGuardia Airport Terminal B, Queens', 40.7741, -73.8717],
    ['C', 'LaGuardia Airport Terminal C, Queens', 40.7704, -73.8634]] },
  EWR: { name: 'Newark', flat: false, terminals: [
    ['A', 'Newark Liberty Airport Terminal A, NJ', 40.6880, -74.1823], ['B', 'Newark Liberty Airport Terminal B, NJ', 40.6907, -74.1780],
    ['C', 'Newark Liberty Airport Terminal C, NJ', 40.6955, -74.1775]] },
};
export const meetNote = (dir) => dir === 'arr' ? ARR : DEP;
const L = (k, label, lat, lng, g) => ({ k, label, lat, lng, g });
export const LANDMARKS = [
  L('Jamaica / AirTrain', 'Jamaica Station (LIRR · AirTrain JFK), Sutphin Blvd, Queens', 40.6995, -73.8085, 'Queens'),
  L('Flushing Main St', 'Flushing–Main St (7), Main St & Roosevelt Ave, Queens', 40.7596, -73.8301, 'Queens'),
  L('Queens Center', 'Queens Center Mall, Queens Blvd, Elmhurst, Queens', 40.7347, -73.8695, 'Queens'),
  L('Citi Field', 'Citi Field, Flushing Meadows, Queens', 40.7571, -73.8458, 'Queens'),
  L('USTA Tennis Center', 'USTA Billie Jean King National Tennis Center, Queens', 40.7498, -73.8467, 'Queens'),
  L('Kew Gardens courts', 'Queens Criminal Court, 125-01 Queens Blvd, Kew Gardens, Queens', 40.7144, -73.8278, 'Queens'),
  L('Jamaica Hospital', 'Jamaica Hospital Medical Center, Van Wyck Expy, Queens', 40.7006, -73.8160, 'Queens'),
  L('Queens Hospital', 'Queens Hospital Center, 164th St, Jamaica, Queens', 40.7173, -73.8044, 'Queens'),
  L('Elmhurst Hospital', 'Elmhurst Hospital, Broadway, Elmhurst, Queens', 40.7449, -73.8857, 'Queens'),
  L("St. John's Hospital", "St. John's Episcopal Hospital, Far Rockaway, Queens", 40.5986, -73.7520, 'Queens'),
  L('Mott Ave (A)', 'Far Rockaway–Mott Av (A), Queens', 40.6034, -73.7554, 'Queens'),
  L('Rockaway Beach 116', 'Rockaway Beach, Beach 116th St, Queens', 40.5806, -73.8364, 'Queens'),
  L('Rockaway Beach 98', 'Rockaway Beach, Beach 98th St, Queens', 40.5853, -73.8203, 'Queens'),
  L('Jacob Riis Park', 'Jacob Riis Park, Rockaway, Queens', 40.5672, -73.8726, 'Queens'),
  L('Penn Station', 'Penn Station (LIRR), 7th Ave & 33rd St, Manhattan', 40.7506, -73.9935, 'LIRR'),
  L('Grand Central Madison', 'Grand Central Madison (LIRR), Manhattan', 40.7527, -73.9772, 'LIRR'),
  L('Atlantic Terminal', 'Atlantic Terminal (LIRR), Brooklyn', 40.6845, -73.9776, 'LIRR'),
  L('Valley Stream LIRR', 'Valley Stream LIRR station, Nassau County', 40.6612, -73.7046, 'LIRR'),
  L('Mineola LIRR', 'Mineola LIRR station, Nassau County', 40.7404, -73.6408, 'LIRR'),
  L('Hicksville LIRR', 'Hicksville LIRR station, Nassau County', 40.7675, -73.5285, 'LIRR'),
  L('Ronkonkoma LIRR', 'Ronkonkoma LIRR station, Suffolk County', 40.8085, -73.1060, 'LIRR'),
  L('Far Rockaway LIRR', 'Far Rockaway LIRR station, Queens', 40.6094, -73.7504, 'LIRR'),
  L('Barclays Center', 'Barclays Center, Atlantic Ave & Flatbush Ave, Brooklyn', 40.6826, -73.9754, 'Brooklyn'),
  L('Kings County Hospital', 'Kings County Hospital, Clarkson Ave, Brooklyn', 40.6556, -73.9446, 'Brooklyn'),
  L('Coney Island', 'Coney Island boardwalk, Stillwell Ave, Brooklyn', 40.5755, -73.9707, 'Brooklyn'),
];
export const QUEENS_HOODS = ['astoria', 'long island city', 'sunnyside', 'woodside', 'jackson heights', 'elmhurst', 'corona', 'flushing', 'forest hills', 'rego park', 'kew gardens', 'richmond hill', 'ozone park', 'howard beach', 'jamaica', 'st albans', 'hollis', 'queens village', 'bayside', 'whitestone', 'college point', 'fresh meadows', 'ridgewood', 'maspeth', 'middle village', 'woodhaven', 'south ozone park', 'springfield gardens', 'rosedale', 'laurelton', 'cambria heights', 'far rockaway', 'arverne', 'rockaway park', 'belle harbor', 'breezy point', 'bayswater', 'edgemere', 'douglaston', 'little neck', 'glen oaks', 'bellerose', 'briarwood', 'jamaica estates', 'east elmhurst'];
const ORD = (n) => n + (/1[123]$/.test(n) ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n.slice(-1)] || 'th');
// Query variants for Queens-style addresses. "12345 101 Ave" -> "123-45 101st Avenue"; "1234 31st St" -> "12-34 31st Street";
// bare numbered street with no type -> try both Avenue and Street (Queens numbers both). Neighborhood names get ", Queens, NY".
export function addressVariants(q) {
  let s = q.trim().replace(/\s+/g, ' '); const out = [];
  const m = s.match(/^(\d{4,5})(\s+)(\d+)(st|nd|rd|th)?\b\s*(.*)$/i);
  if (m) { const [, num, , street, , rest0] = m; const hy = num.length === 5 ? num.slice(0, 3) + '-' + num.slice(3) : num.slice(0, 2) + '-' + num.slice(2);
    const rest = rest0.replace(/\b(av|ave)\b\.?/i, 'Avenue').replace(/\bst\b\.?/i, 'Street').replace(/\brd\b\.?/i, 'Road').replace(/\bdr\b\.?/i, 'Drive').replace(/\bpl\b\.?/i, 'Place');
    const typed = /^(avenue|street|road|drive|place|lane|blvd|boulevard|court|terrace)\b/i.test(rest);
    if (typed) out.push(`${hy} ${ORD(street)} ${rest}`); else { out.push(`${hy} ${ORD(street)} Avenue ${rest}`.trim(), `${hy} ${ORD(street)} Street ${rest}`.trim()); } }
  const low = s.toLowerCase();
  const hood = QUEENS_HOODS.find(h => low.endsWith(h) || low.endsWith(h + ' ny'));
  if (hood && !/queens/i.test(s)) out.push(s.replace(/\s*,?\s*ny$/i, '') + ', Queens, NY');
  return [...new Set([...out, s])].slice(0, 3);
}
export function localMatches(q) { const s = q.trim().toLowerCase(); if (s.length < 2) return [];
  return LANDMARKS.filter(l => l.k.toLowerCase().includes(s) || l.label.toLowerCase().includes(s)).slice(0, 4); }
