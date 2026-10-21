// Self-learning (on-device, anonymized). Logs coarse ride stats — no names, phones or exact addresses:
// pickup rounded to ~110 m grid cell + short place name, day-of-week/hour, wait-for-driver and ride seconds.
// Uses them to suggest popular pickups nearby and to predict the wait at this hour.
// If a Supabase client is present (window.ROC_SB, set by data.js), the same anonymized row is also
// sent to table `ride_stats` (best effort; silently skipped if the table does not exist).
const KEY = 'qc_learn', MAX = 600;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); } catch {} };
const cell = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });
const short = (l = '') => String(l).split(',')[0].replace(/^\d+[\w-]*\s+/, '').slice(0, 48); // drop house numbers
export function anonymize({ pickup, dest, waitSec, rideSec, at = Date.now() }) {
  const d = new Date(at);
  return { pu: cell(pickup), puName: short(pickup.label), doName: dest ? short(dest.label) : '', dow: d.getDay(), hour: d.getHours(),
    wait: waitSec != null ? Math.round(waitSec) : null, ride: rideSec != null ? Math.round(rideSec) : null, day: d.toISOString().slice(0, 10) };
}
export function record(ev, { sb = globalThis.ROC_SB } = {}) {
  const row = anonymize(ev); const a = load(); a.push(row); save(a);
  try { sb?.from('ride_stats').insert({ pu_lat: row.pu.lat, pu_lng: row.pu.lng, pu_name: row.puName, do_name: row.doName, dow: row.dow, hour: row.hour, wait_sec: row.wait, ride_sec: row.ride }).then(() => {}, () => {}); } catch {}
  return row;
}
const km = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
export function popularPickups(near, { n = 4, radiusKm = 3, data = load(), hour } = {}) {
  const m = new Map();
  for (const r of data) {
    if (near && km(near, r.pu) > radiusKm) continue;
    const k = r.pu.lat + ',' + r.pu.lng, w = hour != null && Math.abs(r.hour - hour) <= 1 ? 2 : 1;
    const e = m.get(k) || { lat: r.pu.lat, lng: r.pu.lng, label: r.puName || 'Popular pickup', count: 0, score: 0 };
    e.count++; e.score += w; m.set(k, e);
  }
  return [...m.values()].filter(e => e.count >= 2).sort((a, b) => b.score - a.score).slice(0, n);
}
// Average wait for a driver at this hour (±1 h, same weekday type). Needs >= 3 samples, else null.
export function busyHour({ at = Date.now(), data = load() } = {}) {
  const d = new Date(at), h = d.getHours(), wk = d.getDay() % 6 === 0;
  const xs = data.filter(r => r.wait != null && Math.min(Math.abs(r.hour - h), 24 - Math.abs(r.hour - h)) <= 1 && (r.dow % 6 === 0) === wk);
  if (xs.length < 3) return null;
  const avg = xs.reduce((s, r) => s + r.wait, 0) / xs.length;
  const all = data.filter(r => r.wait != null), base = all.reduce((s, r) => s + r.wait, 0) / (all.length || 1);
  return { avgWaitSec: Math.round(avg), samples: xs.length, busy: avg > base * 1.25 };
}
export const stats = () => ({ samples: load().length });
