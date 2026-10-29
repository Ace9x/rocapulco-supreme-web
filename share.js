import { SUPABASE } from './cloud.js';
const out = document.getElementById('out'), s = new URLSearchParams(location.search).get('s') || '';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LBL = { requested: 'Looking for a car', assigned: 'Driver assigned', en_route: 'Driver on the way', arrived: 'Driver at pickup', in_progress: 'On the trip', completed: 'Arrived — trip complete', cancelled_rider: 'Cancelled by rider', cancelled_driver: 'Cancelled by driver' };
async function load() {
  if (!/^[0-9a-f-]{36}$/i.test(s)) { out.textContent = 'This share link is not valid.'; return; }
  try { const r = await fetch(SUPABASE.url + '/rest/v1/rpc/ride_shared', { method: 'POST', headers: { apikey: SUPABASE.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ p_share: s }) });
    const j = (await r.json())[0]; if (!j) { out.textContent = 'This ride link has expired or is not valid.'; return; }
    out.innerHTML = `<h2>${esc(LBL[j.status] || j.status)}</h2><p>Driver: <b>${esc(j.driver || '—')}</b> · ${esc(j.car || '')} · plate <b>${esc(j.plate || '—')}</b></p><p>From ${esc(j.pickup)}<br>To ${esc(j.dropoff)}</p><p class="fine">Updated ${new Date(j.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 20 s</p>`;
    if (!/completed|cancel/.test(j.status)) setTimeout(load, 20000);
  } catch { out.textContent = 'Couldn\'t reach Rocapulco right now — retrying…'; setTimeout(load, 20000); }
}
load();
