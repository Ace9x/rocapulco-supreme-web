// TLC FHV trip-record CSV format (35 RCNY 59B-19; TLC CSV spec, Nov 2018 template). Used by the dispatch
// "TLC Reports" screen to re-check every server-built file before Fan uploads it on TLC UP / SFTP.
// Source: https://www.nyc.gov/site/tlc/tlc-online/fhv-trip-record-submission.page
export const TLC_HEADER = ['dispatching_base_number', 'pickup_date', 'pickup_time', 'TLC_drivers_license_number', 'license_plate', 'affiliated_base_number', 'pickup_location_type', 'pickup_location_name', 'pickup_longitude', 'pickup_latitude', 'dropoff_date', 'dropoff_time', 'dropoff_location_type', 'dropoff_location_name', 'dropoff_longitude', 'dropoff_latitude', 'congestion_zone_flag', 'shared_request_flag', 'shared_match_flag', 'access_a_ride_flag', 'WAV_request_flag', 'request_date', 'request_time', 'originating_base_number', 'on_scene_date', 'on_scene_time'];
export const tlcFilename = (base, start, end) => `${base}_${start.replaceAll('-', '')}-${end.replaceAll('-', '')}.csv`;
// Due the last day of the month after the trips' month (59B-19(a)(3)(i)).
export function tlcDueDate(periodEnd) { const [y, m] = periodEnd.split('-').map(Number); return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); }
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c; }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const DATE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-\d{4}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, BASE = /^B\d{5}$/, YN = /^[YN]$/, LT = /^(Exact Address|Intersection of|Airport)$/;
const coordOk = (v, lo, hi) => v === '' || (/^-?\d+\.\d{5,}$/.test(v) && +v >= lo && +v <= hi);
export function validateTlcRow(r) {
  const c = Object.fromEntries(TLC_HEADER.map((h, i) => [h, r[i] ?? ''])), p = [];
  if (r.length !== TLC_HEADER.length) p.push(`has ${r.length} columns, needs ${TLC_HEADER.length}`);
  if (!BASE.test(c.dispatching_base_number)) p.push('dispatching_base_number');
  if (!BASE.test(c.affiliated_base_number)) p.push('affiliated_base_number');
  if (!DATE.test(c.pickup_date) || !TIME.test(c.pickup_time)) p.push('pickup date/time');
  if (!DATE.test(c.dropoff_date) || !TIME.test(c.dropoff_time)) p.push('dropoff date/time');
  if (!/^\d{4,10}$/.test(c.TLC_drivers_license_number)) p.push('TLC_drivers_license_number');
  if (!/^[A-Za-z0-9]{2,8}$/.test(c.license_plate)) p.push('license_plate');
  for (const k of ['pickup', 'dropoff']) {
    if (!LT.test(c[k + '_location_type'])) p.push(k + '_location_type');
    if (!c[k + '_location_name'] && !(c[k + '_latitude'] && c[k + '_longitude'])) p.push(k + ' location');
    if (!coordOk(c[k + '_longitude'], -180, 180) || !coordOk(c[k + '_latitude'], -90, 90)) p.push(k + ' coordinates (WGS84, 5+ decimals)');
  }
  for (const k of ['shared_request_flag', 'shared_match_flag', 'WAV_request_flag']) if (!YN.test(c[k])) p.push(k);
  for (const k of ['congestion_zone_flag', 'access_a_ride_flag']) if (c[k] && !YN.test(c[k])) p.push(k);
  if (c.request_date && !DATE.test(c.request_date)) p.push('request_date'); if (c.request_time && !TIME.test(c.request_time)) p.push('request_time');
  if (/^(NULL|null)$/.test(Object.values(c).join('|').split('|').find(v => /^null$/i.test(v)) || '')) p.push('uses NULL (leave blank instead)');
  return p;
}
export function validateTlcCsv(text) {
  const rows = parseCsv(text).filter(r => r.length > 1 || r[0] !== ''); const errs = [];
  if (!rows.length || rows[0].join(',') !== TLC_HEADER.join(',')) errs.push({ row: 1, problems: ['header does not match the TLC CSV spec'] });
  rows.slice(1).forEach((r, i) => { const p = validateTlcRow(r); if (p.length) errs.push({ row: i + 2, problems: p }); });
  return { rows: Math.max(0, rows.length - 1), errors: errs, ok: !errs.length };
}
