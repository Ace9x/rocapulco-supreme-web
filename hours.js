// TLC passenger-hours limits (35 RCNY §80-14(f)): max 10 h with passengers in any 24 h (resets after 8 h with no passengers),
// max 60 h in a Monday–Sunday week. Only time with a passenger on board counts. trips: [{ startAt, endAt }] in ms.
export const DAY_LIMIT_H = 10, WEEK_LIMIT_H = 60, RESET_H = 8;
export function passengerHours(trips, now = Date.now()) {
  const t = trips.filter(x => x.startAt && x.endAt && x.endAt > x.startAt && x.startAt <= now).map(x => [x.startAt, Math.min(x.endAt, now)]).sort((a, b) => b[0] - a[0]);
  let day = 0, edge = now; const d24 = now - 864e5;
  for (const [s, e] of t) { if (edge - e >= RESET_H * 36e5) break; if (e <= d24) break; day += e - Math.max(s, d24); edge = s; }
  const m = new Date(now); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); const w0 = m.getTime();
  const week = t.reduce((a, [s, e]) => a + Math.max(0, e - Math.max(s, w0)), 0);
  const dayH = day / 36e5, weekH = week / 36e5;
  return { dayH, weekH, blocked: dayH >= DAY_LIMIT_H || weekH >= WEEK_LIMIT_H, warn: dayH >= DAY_LIMIT_H - 1 || weekH >= WEEK_LIMIT_H - 3,
    why: dayH >= DAY_LIMIT_H ? `You've had passengers ${dayH.toFixed(1)} h in the last 24 h (TLC limit 10 h). Rest 8 hours to reset.` : weekH >= WEEK_LIMIT_H ? `You've had passengers ${weekH.toFixed(1)} h this week (TLC limit 60 h, resets Monday).` : '' };
}
