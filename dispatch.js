export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Rank available, fresh drivers by straight-line distance to pickup; exclude declined ones.
export function rankDrivers(drivers, pickup, { now = Date.now(), maxAgeMs = 15000, maxMeters = 15000, exclude = [] } = {}) {
  return drivers
    .filter(d => d.status === 'available' && now - d.ts <= maxAgeMs && !exclude.includes(d.id))
    .map(d => ({ ...d, dist: haversine(d, pickup) }))
    .filter(d => d.dist <= maxMeters)
    .sort((a, b) => a.dist - b.dist);
}
const T = {
  requested: { offer: 'offered', cancel: 'cancelled' },
  offered: { accept: 'accepted', decline: 'requested', timeout: 'requested', cancel: 'cancelled' },
  accepted: { arrive: 'arrived', cancel: 'cancelled' },
  arrived: { start: 'in_progress', cancel: 'cancelled' },
  in_progress: { complete: 'completed' },
  completed: {}, cancelled: {},
};
export function transition(state, event) {
  const next = T[state] && T[state][event];
  if (!next) throw new Error(`invalid ${event} from ${state}`);
  return next;
}
// coords: [[lng,lat],...]. Returns cumulative distances.
export function cumulative(coords) {
  const c = [0];
  for (let i = 1; i < coords.length; i++)
    c.push(c[i - 1] + haversine({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] }));
  return c;
}
export function pointAlong(coords, cum, m) {
  if (m <= 0) return { lat: coords[0][1], lng: coords[0][0] };
  for (let i = 1; i < coords.length; i++) if (cum[i] >= m) {
    const f = (m - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return { lat: coords[i - 1][1] + f * (coords[i][1] - coords[i - 1][1]), lng: coords[i - 1][0] + f * (coords[i][0] - coords[i - 1][0]) };
  }
  const l = coords[coords.length - 1]; return { lat: l[1], lng: l[0] };
}
export function nearestIndex(coords, p) {
  let best = 0, bd = Infinity;
  coords.forEach((c, i) => { const d = haversine(p, { lat: c[1], lng: c[0] }); if (d < bd) { bd = d; best = i; } });
  return { index: best, offRoute: bd };
}
export function instruction(step) {
  const m = step.maneuver || {}, name = step.name ? ` onto ${step.name}` : '';
  const mod = m.modifier ? m.modifier.replace('slight', 'slight') : '';
  switch (m.type) {
    case 'depart': return `Head ${m.bearing_after != null ? compass(m.bearing_after) : ''}${step.name ? ' on ' + step.name : ''}`.trim();
    case 'arrive': return 'Arrive at destination';
    case 'roundabout': case 'rotary': return `Enter roundabout, take exit ${m.exit || ''}${name}`;
    case 'merge': return `Merge${name}`;
    case 'on ramp': return `Take the ramp${name}`;
    case 'off ramp': return `Take the exit${name}`;
    case 'fork': return `Keep ${mod}${name}`;
    case 'continue': case 'new name': return `Continue${name}`;
    default: return `${mod.startsWith('u') ? 'Make a U-turn' : 'Turn ' + mod}${name}`;
  }
}
function compass(b) { return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(b / 45) % 8]; }
