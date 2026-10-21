import { estimateFare, money, offerEconomics, split, DRIVER_SHARE, DISPATCH_PHONE, DISPATCH_TEL, PAYMENTS, POPULAR } from './fare.js';
import { rankDrivers, haversine, cumulative, pointAlong, nearestIndex, instruction, rankByRoad, homeFilterOk, cancelStatus, noShowAllowed, scheduleState, smooth } from './dispatch.js';
import { createBus } from './data.js';

const Q = new URLSearchParams(location.search);
const NS = (Q.get('ns') || 'nyc').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'nyc';
const SPEED = Math.min(20, Math.max(1, +Q.get('speed') || 4)); // simulation speed multiplier
const $ = (s) => document.querySelector(s);
const sheet = $('#sheet');
const uid = () => Math.random().toString(36).slice(2, 10);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('qc_' + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('qc_' + k, JSON.stringify(v)) };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (s) => Math.max(1, Math.round(s / 60)) + ' min';
const fmtDist = (m) => m < 160 ? Math.round(m * 3.281 / 10) * 10 + ' ft' : (m / 1609.344).toFixed(1) + ' mi';
const LEAD_MS = (+Q.get('leadmin') || 30) * 60e3;           // scheduled-ride dispatch lead (test override)
const NOSHOW_GRACE = Q.get('testfast') ? 3 : 300;            // seconds after promised ETA before "driver never showed"
const NOSHOW_SCALE = Q.get('testfast') ? 0 : 1;
const QUEENS = { lat: 40.6054, lng: -73.7551 }; // Far Rockaway

const bus = createBus({ transport: Q.get('transport'), ns: NS, onStatus: s => { $('#net').textContent = s === 'online' ? '● Live' : s === 'local' ? '● Local' : '○ ' + s; $('#net').className = 'net ' + s; } });

// ---------- map ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([QUEENS.lat, QUEENS.lng], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routing <a href="https://project-osrm.org">OSRM</a> · Search <a href="https://photon.komoot.io">Photon</a>' }).addTo(map);
const layer = L.layerGroup().addTo(map);
const icon = (html, cls = '') => L.divIcon({ html, className: 'mk ' + cls, iconSize: [34, 34], iconAnchor: [17, 17] });
const carIcon = (d) => icon('🚘', d && d.sim ? 'sim' : '');
const pinA = icon('<b>A</b>', 'pin a'), pinB = icon('<b>B</b>', 'pin b'), meIcon = icon('', 'me');

// ---------- routing / geocoding ----------
async function route(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`);
    const j = await r.json(); if (j.code !== 'Ok') throw 0;
    const rt = j.routes[0], coords = rt.geometry.coordinates;
    const steps = rt.legs[0].steps.map(s => ({ text: instruction(s), loc: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] }, dist: s.distance }));
    return pack(coords, rt.distance, rt.duration, steps, true);
  } catch {
    const coords = [[a.lng, a.lat], [b.lng, b.lat]], d = haversine(a, b) * 1.3;
    return pack(coords, d, d / 7, [{ text: 'Head toward destination (approximate — routing unavailable)', loc: a }, { text: 'Arrive at destination', loc: b }], false);
  }
}
function pack(coords, distance, duration, steps, real) {
  const cum = cumulative(coords);
  steps.forEach(s => s.idx = nearestIndex(coords, s.loc).index);
  return { coords, cum, distance, duration, steps, real, latlngs: coords.map(c => [c[1], c[0]]) };
}
async function geocode(q, near) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${near.lat}&lon=${near.lng}`);
  const j = await r.json();
  return j.features.map(f => { const p = f.properties; return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [p.name, p.housenumber && p.street ? p.housenumber + ' ' + p.street : p.street, p.district || p.city, p.state].filter(Boolean).join(', ') }; });
}
async function reverse(p) {
  try { const j = await (await fetch(`https://photon.komoot.io/reverse?lat=${p.lat}&lon=${p.lng}`)).json(); const x = j.features[0].properties; return [x.housenumber && x.street ? x.housenumber + ' ' + x.street : x.name || x.street, x.district || x.city].filter(Boolean).join(', '); }
  catch { return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; }
}
function getPos() {
  return new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, real: true }), () => res(null), { enableHighAccuracy: true, timeout: 8000 }) : res(null));
}
function progress(rt, loc) {
  const n = nearestIndex(rt.coords, loc), last = rt.cum[rt.cum.length - 1];
  const remain = Math.max(0, last - rt.cum[n.index]);
  const next = rt.steps.find(s => s.idx > n.index) || rt.steps[rt.steps.length - 1];
  return { remain, eta: remain * (rt.duration / (rt.distance || 1)), next, toNext: Math.max(0, rt.cum[next.idx] - rt.cum[n.index]), offRoute: n.offRoute };
}
function autocomplete(input, list, near, onPick) {
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t); const q = input.value.trim(); if (q.length < 3) { list.innerHTML = ''; return; }
    t = setTimeout(async () => {
      try { const rs = await geocode(q, near()); list.innerHTML = rs.map((r, i) => `<li data-i="${i}">${esc(r.label)}</li>`).join('') || '<li class="muted">No results</li>';
        list.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => { const r = rs[+li.dataset.i]; input.value = r.label; list.innerHTML = ''; onPick(r); });
      } catch { list.innerHTML = '<li class="muted">Search unavailable — tap the map instead</li>'; }
    }, 450); // Photon fair use: debounce typing
  });
}
const speak = (t) => { if (store.get('voice', true) && 'speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } };


// ---------- shared UI helpers ----------
// Smoothly glide a marker to a new position (no jumping cars).
function animateTo(marker, to, ms = 900) {
  const from = marker.getLatLng(), t0 = performance.now(); cancelAnimationFrame(marker._raf);
  if (from.distanceTo(to) > 3000) return marker.setLatLng(to);
  const stepf = (t) => { const k = Math.min(1, (t - t0) / ms), e = k * (2 - k); marker.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]); if (k < 1) marker._raf = requestAnimationFrame(stepf); };
  marker._raf = requestAnimationFrame(stepf);
}
// Road travel time from each driver to the pickup via the OSRM table service (one request for all candidates).
async function roadTimes(cands, pickup) {
  try {
    const pts = [pickup, ...cands].map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const src = cands.map((_, i) => i + 1).join(';');
    const j = await (await fetch(`https://router.project-osrm.org/table/v1/driving/${pts}?sources=${src}&destinations=0`)).json();
    if (j.code !== 'Ok') throw 0; return j.durations.map(r => r[0]);
  } catch { return null; }
}
function notify(text) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 6000);
  try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Rocapulco Supreme', { body: text, icon: 'icons/icon-192.png' }); } catch {}
}
// In-trip chat between rider and driver over the trip channel.
function chatBox(box, btn, tripId, role) {
  const msgs = []; let open = false;
  const render = () => { if (!open) { btn.textContent = msgs.filter(m => m.from !== role).length ? `💬 Message (${msgs.filter(m => m.from !== role).length})` : '💬 Message'; return; }
    box.innerHTML = `<div class="chat"><div class="msgs" id="msgs">${msgs.map(m => `<div class="msg ${m.from === role ? 'me' : ''}">${esc(m.text)}</div>`).join('') || '<p class="fine">Messages go only to this trip.</p>'}</div><form id="cf"><input id="ci" placeholder="Type a message" maxlength="200" autocomplete="off"><button class="btn sm">Send</button></form></div>`;
    $('#cf').onsubmit = (e) => { e.preventDefault(); const v = $('#ci').value.trim(); if (!v) return; bus.publish('trip/' + tripId, { type: 'chat', from: role, text: v, id: uid() }); $('#ci').value = ''; };
    const ms = $('#msgs'); ms.scrollTop = ms.scrollHeight; };
  btn.onclick = () => { open = !open; if (!open) box.innerHTML = ''; render(); open && $('#ci')?.focus(); };
  sub('trip/' + tripId, (m) => { if (m.type === 'chat') { msgs.push(m); if (m.from !== role) { navigator.vibrate?.(100); if (!open) notify('New message: ' + m.text); } render(); } });
  render();
}

// ---------- simulated drivers (demo mode) ----------
const NAMES = [['Marcus', 'Black Cadillac XTS', 'T7xx'], ['Priya', 'Black Cadillac Escalade', 'T4xx'], ['Luis', 'Black Cadillac CT6', 'T9xx'], ['Danielle', 'Black Cadillac XT6', 'T2xx']];
class SimDriver {
  constructor(near, owner, i) {
    const a = Math.random() * 6.28, r = 0.006 + Math.random() * 0.01;
    const [name, car, plate] = NAMES[i % 4];
    Object.assign(this, { id: 'sim-' + uid(), name: name + ' (demo)', car, plate: plate.replace('xx', String(10 + i * 17)), owner, sim: true, status: 'available', lat: near.lat + r * Math.sin(a), lng: near.lng + r * Math.cos(a) * 1.3, rating: 4.9 });
    this.beat = setInterval(() => this.presence(), 3000); this.presence();
    this.unsub = bus.subscribe('offer/' + this.id, (m) => this.onOffer(m.trip));
  }
  info() { const { id, name, car, plate, sim, owner, status, lat, lng, rating } = this; return { id, name, car, plate, sim, owner, status, lat, lng, rating, ts: Date.now() }; }
  presence() { bus.publish('drivers/' + this.id, this.info(), { localOnly: true }); }
  async onOffer(trip) {
    if (this.status !== 'available') return bus.publish('trip/' + trip.id, { type: 'decline', driver: this.id });
    this.status = 'busy'; await wait(1500);
    let replied = false; const un = bus.subscribe('trip/' + trip.id, (m) => { if (m.type === 'chat' && m.from === 'rider' && !replied) { replied = true; setTimeout(() => bus.publish('trip/' + trip.id, { type: 'chat', from: 'driver', text: 'Got it, see you soon! (demo driver)', id: uid() }), 1200); } if (m.type === 'cancel') this.cancelled = true; });
    bus.publish('trip/' + trip.id, { type: 'accept', driver: this.info() });
    await this.drive(await route(this, trip.pickup), trip); if (this.cancelled) { un(); this.status = 'available'; this.cancelled = false; return; }
    bus.publish('trip/' + trip.id, { type: 'arrived', driver: this.id }); await wait(3000);
    bus.publish('trip/' + trip.id, { type: 'start', driver: this.id });
    const rt = await route(trip.pickup, trip.dest); await this.drive(rt, trip);
    const f = { total: trip.fare, lines: trip.lines }; // upfront fare is locked
    bus.publish('trip/' + trip.id, { type: 'complete', driver: this.id, lines: f.lines, fare: f.total, meters: rt.distance, seconds: rt.duration });
    this.status = 'available'; un();
  }
  async drive(rt, trip) {
    for (let m = 0; m < rt.distance && !this.cancelled; m += 15 * SPEED) {
      Object.assign(this, pointAlong(rt.coords, rt.cum, m));
      const p = progress(rt, this);
      bus.publish('trip/' + trip.id, { type: 'loc', lat: this.lat, lng: this.lng, eta: p.eta, remain: p.remain }, { localOnly: true });
      await wait(1000);
    }
    Object.assign(this, pointAlong(rt.coords, rt.cum, rt.distance));
  }
  stop() { clearInterval(this.beat); this.unsub(); this.status = 'offline'; this.presence(); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- screens ----------
let cleanup = [];
function reset() { cleanup.forEach(f => f()); cleanup = []; layer.clearLayers(); }
const sub = (p, cb) => cleanup.push(bus.subscribe(p, cb));
function every(fn, ms) { const h = setInterval(fn, ms); cleanup.push(() => clearInterval(h)); }
const callBtn = (label = `📞 Call dispatch ${DISPATCH_PHONE}`) => `<a class="btn gold call" href="tel:${DISPATCH_TEL}">${label}</a>`;
const PAY_NOTE = { cash: 'Hand cash to your driver.', card: "Pay on your driver's card reader in the car.", zelle: "Send by Zelle to the driver's number shown at drop-off.", venmo: 'Send by Venmo to your driver at drop-off.' };
const payLink = (m, amt) => m === 'venmo' ? `<a class="btn alt" target="_blank" rel="noopener" href="https://venmo.com/?txn=pay&amount=${amt.toFixed(2)}&note=Rocapulco%20ride">Open Venmo</a>` : m === 'zelle' ? `<a class="btn alt" target="_blank" rel="noopener" href="https://www.zellepay.com/">Open Zelle (use your bank app)</a>` : '';
const POLICY = 'No surge, ever. No booking or service fees. If a driver cancels, you are never charged.';
const tabs = (cur) => `<nav class="tabs">${['rider', 'driver', 'admin'].map(t => `<a href="#/${t}" class="${t === cur ? 'on' : ''}">${{ rider: 'Ride', driver: 'Drive', admin: 'Dispatch' }[t]}</a>`).join('')}</nav>`;

function home() {
  sheet.innerHTML = `<div class="brand"><div class="crest">R</div><h1>Rocapulco <span>Supreme</span></h1><p class="muted">Black-car luxury for Far Rockaway & all of NYC. Real human dispatch, upfront fares, <b>no surge, ever</b>.</p></div>
  <div class="rates"><div><b>$3.50</b><span>base</span></div><div><b>$2.50</b><span>/mile</span></div><div><b>$0.40</b><span>/min</span></div><div><b>$50</b><span>JFK flat</span></div><div><b>$55</b><span>LGA flat</span></div></div>
  <a class="btn big gold" href="#/rider" id="go-rider">Book a ride</a><a class="btn big alt" href="#/driver" id="go-driver">I'm a Rocapulco driver</a><a class="btn link" href="#/admin">Dispatch center</a>
  ${callBtn()}
  <p class="fine">$8 minimum. Pay your driver directly: cash, card, Zelle or Venmo — the app never charges you. ${POLICY} Channel: <b>${esc(NS)}</b></p>`;
}

function profileForm(role, done) {
  const p = store.get('profile_' + role);
  if (p) return done(p);
  sheet.innerHTML = `${tabs(role)}<h2>${role === 'rider' ? 'Create rider account' : 'Driver sign-up'}</h2>
  <form id="pf"><input required name="name" placeholder="Full name" autocomplete="name"><input required name="phone" type="tel" placeholder="Phone" autocomplete="tel">
  ${role === 'driver' ? '<input required name="car" placeholder="Vehicle (e.g. Toyota Camry, yellow)"><input required name="plate" placeholder="Plate / TLC medallion #">' : ''}
  <button class="btn">Continue</button></form><p class="fine">Your profile is saved on this device only.</p>`;
  $('#pf').onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.id = (role === 'driver' ? 'drv-' : 'rdr-') + uid(); store.set('profile_' + role, d); done(d); };
}

// ===== RIDER =====
function rider() {
  profileForm('rider', (me) => {
    const drivers = new Map(), dmk = new Map();
    let pickup = null, dest = null, rt = null, fare = null, trip = null, sims = [], demo = store.get('demo', true), payM = store.get('pay', 'cash');
    let pinP, pinD, line, carMk, tick;
    sub('drivers/+', (d) => {
      if (d.sim && d.owner !== me.id) return;
      drivers.set(d.id, d);
      if (trip) return;
      if (d.status === 'offline') { dmk.get(d.id)?.remove(); dmk.delete(d.id); return; }
      if (!dmk.has(d.id)) dmk.set(d.id, L.marker([d.lat, d.lng], { icon: carIcon(d) }).addTo(layer)); else animateTo(dmk.get(d.id), [d.lat, d.lng]);
    });
    cleanup.push(() => { sims.forEach(s => s.stop()); clearInterval(tick); });
    const spawnSims = () => { if (demo && !sims.length && pickup) sims = [0, 1, 2, 3].map(i => new SimDriver(pickup, me.id, i)); };
    const stopSims = () => { sims.forEach(s => { s.stop(); dmk.get(s.id)?.remove(); dmk.delete(s.id); drivers.delete(s.id); }); sims = []; };

    // scheduled rides: stored on this device; dispatch opens at T-30 min while the app is open
    every(() => {
      if (trip) return;
      const list = store.get('scheduled', []); let changed = false;
      for (const s of list) {
        const st = scheduleState({ pickupAt: s.pickupAt, now: Date.now(), matched: false, lead: LEAD_MS });
        if (st === 'dispatching' && !s.alerted) { s.alerted = true; changed = true; notify(`Scheduled ride at ${new Date(s.pickupAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: finding your driver now`); pickup = s.pickup; dest = s.dest; rt = null; startRequest(s); break; }
        if (st === 'expired') { s.expired = true; changed = true; notify('A scheduled ride could not be matched and was removed. No charge.'); }
      }
      if (changed) store.set('scheduled', list.filter(s => !s.expired && !s.started));
    }, 5000);

    function plan() {
      trip = null; clearInterval(tick); dmk.forEach(m => m.addTo(layer));
      const sched = store.get('scheduled', []);
      sheet.innerHTML = `${tabs('rider')}<div class="hi">Hi ${esc(me.name.split(' ')[0])} 👋 <span><a href="#" id="hist">History</a></span></div>
      <div class="field"><span class="dot a"></span><input id="pu" placeholder="Pickup — locating…"><button id="gps" title="Use my location">◎</button></div><ul id="pul" class="sugg"></ul>
      <div class="pop" id="pop">${POPULAR.map((d, i) => `<button data-p="${i}">${esc(d.k)}</button>`).join('')}</div>
      <input id="note" placeholder="Note for driver (e.g. blue door, by the bodega)" maxlength="120" value="${esc(pickup?.note || '')}">
      <div class="field"><span class="dot b"></span><input id="de" placeholder="Where to?"></div><ul id="del" class="sugg"></ul>
      <p class="fine">Drag the green <b>A</b> pin to your exact spot. Tap the map to set the destination.</p>
      <div class="seg"><button id="wnow" class="on">Now</button><button id="wsch">Schedule</button></div><input id="when" type="datetime-local" hidden>
      <div class="paysel"><span class="fine">Pay driver with</span><div class="seg" id="pay">${Object.entries(PAYMENTS).map(([k, v]) => `<button data-m="${k}" class="${k === payM ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <label class="tog"><input type="checkbox" id="demo" ${demo ? 'checked' : ''}> Demo mode — show simulated drivers (clearly labeled)</label>
      <div id="est"></div><button class="btn" id="req" disabled>Request ride</button>
      ${sched.length ? `<h3>Upcoming</h3>${sched.map(s => `<div class="card hist sched"><div><b>${esc(s.dest.label.split(',')[0])}</b><div class="muted">${new Date(s.pickupAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · driver search starts 30 min before</div></div><button class="btn link sm" data-x="${s.id}">Cancel</button></div>`).join('')}` : ''}`;
      autocomplete($('#pu'), $('#pul'), () => pickup || QUEENS, (r) => setPickup(r, r.label));
      autocomplete($('#de'), $('#del'), () => pickup || QUEENS, (r) => setDest(r));
      sheet.querySelectorAll('#pop [data-p]').forEach(b => b.onclick = () => setDest(POPULAR[+b.dataset.p]));
      sheet.querySelectorAll('#pay [data-m]').forEach(b => b.onclick = () => { payM = b.dataset.m; store.set('pay', payM); sheet.querySelectorAll('#pay button').forEach(x => x.classList.toggle('on', x === b)); });
      $('#gps').onclick = locate; $('#hist').onclick = (e) => { e.preventDefault(); history(); };
      $('#demo').onchange = (e) => { demo = e.target.checked; store.set('demo', demo); demo ? spawnSims() : stopSims(); };
      $('#note').oninput = (e) => { if (pickup) pickup.note = e.target.value; };
      $('#wnow').onclick = () => { $('#wnow').classList.add('on'); $('#wsch').classList.remove('on'); $('#when').hidden = true; $('#req').textContent = 'Request ride'; };
      $('#wsch').onclick = () => { $('#wsch').classList.add('on'); $('#wnow').classList.remove('on'); const w = $('#when'); w.hidden = false; const d = new Date(Date.now() + 60 * 60e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); w.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16); w.value ||= d.toISOString().slice(0, 16); $('#req').textContent = 'Schedule ride'; };
      sheet.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { store.set('scheduled', store.get('scheduled', []).filter(s => s.id !== b.dataset.x)); plan(); });
      $('#req').onclick = () => $('#when').hidden ? startRequest() : schedule();
      if (pickup) { $('#pu').value = pickup.label || ''; } else locate();
      if (dest) { $('#de').value = dest.label || ''; estimate(); }
    }
    function schedule() {
      const at = new Date($('#when').value).getTime();
      if (!(at > Date.now() + 5 * 60e3)) { $('#est').insertAdjacentHTML('beforeend', '<p class="err">Pick a time at least 5 minutes from now.</p>'); return; }
      const s = { id: 's-' + uid(), pickupAt: at, pickup: { ...pickup }, dest: { ...dest } };
      store.set('scheduled', [...store.get('scheduled', []), s]);
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      notify(`Ride scheduled for ${new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Keep Rocapulco open (or reopen it) by 30 min before — we'll alert you then.`);
      plan();
    }
    async function locate() {
      $('#pu').placeholder = 'Locating…';
      const p = await getPos();
      if (!p) { $('#pu').placeholder = 'Location blocked — type your pickup'; return; }
      setPickup(p, await reverse(p));
    }
    function setPickup(p, label, recenter = true) {
      pickup = { lat: p.lat, lng: p.lng, label, note: pickup?.note || '' }; if ($('#pu')) $('#pu').value = label;
      if (pinP) pinP.setLatLng(p); else { pinP = L.marker(p, { icon: pinA, draggable: true, zIndexOffset: 900 }).addTo(layer); pinP.on('dragend', async () => { const ll = pinP.getLatLng(); setPickup({ lat: ll.lat, lng: ll.lng }, await reverse({ lat: ll.lat, lng: ll.lng }), false); }); }
      if (recenter) map.setView(p, 16); spawnSims(); estimate();
    }
    async function setDest(p) { dest = { lat: p.lat, lng: p.lng, label: p.label || await reverse(p) }; if ($('#de')) $('#de').value = dest.label; pinD ? pinD.setLatLng(p) : (pinD = L.marker(p, { icon: pinB }).addTo(layer)); estimate(); }
    const onTap = (e) => { if (trip) return; setDest({ lat: e.latlng.lat, lng: e.latlng.lng }); };
    const onHold = (e) => { if (trip) return; reverse(e.latlng).then(l => setPickup(e.latlng, l, false)); };
    map.on('click', onTap); map.on('contextmenu', onHold); cleanup.push(() => { map.off('click', onTap); map.off('contextmenu', onHold); });
    async function estimate() {
      if (!pickup || !dest || !$('#est')) return;
      $('#est').innerHTML = '<p class="muted">Calculating route…</p>';
      rt = await route(pickup, dest); fare = estimateFare({ meters: rt.distance, seconds: rt.duration, dropoff: dest.label });
      line?.remove(); line = L.polyline(rt.latlngs, { color: '#111', weight: 5 }).addTo(layer); map.fitBounds(line.getBounds(), { padding: [40, 40], paddingBottomRight: [20, 320] });
      if (!$('#est')) return;
      const n = rankDrivers([...drivers.values()], pickup).length;
      $('#est').innerHTML = `<div class="card fare"><div><b>Rocapulco Black Car</b><div class="muted">${fare.miles} mi · ${fmtMin(rt.duration)} ride${rt.real ? '' : ' (approx.)'} · ${n ? n + ' car' + (n > 1 ? 's' : '') + ' nearby' : 'no cars nearby yet'}</div></div><div class="price" id="fare">${money(fare.total)}</div></div>
<p class="nosurge" id="surge">✓ No surge, ever — same price at 3 AM, in the rain, on New Year's Eve.</p>
      <details class="bd" id="bd"><summary>Fare breakdown — no hidden fees</summary>${fare.lines.map(l => `<div class="row"><span>${esc(l[0])}</span><span>${money(l[1])}</span></div>`).join('')}<div class="row tot"><span>Total you pay</span><b>${money(fare.total)}</b></div><p class="fine">No booking, service or cancellation fees. Tolls (if any) and tip are your choice and paid to the driver. ${fare.flat ? 'Airport flat rate is fixed.' : `Final fare uses the actual route; usually ${money(fare.low)}–${money(fare.high)}.`}</p></details>
      <p class="fine">You'll see your driver's real ETA once a driver accepts. <b>Pay driver directly (cash, card, Zelle or Venmo)</b> — the app never charges you. If a driver cancels, you pay nothing.</p>`;
      $('#req').disabled = false;
    }
    // ---- dispatch: rank by road ETA (OSRM table), one offer at a time, 15 s each, auto-reassign ----
    async function startRequest(sched) {
      if (!fare || !rt) { rt = await route(pickup, dest); fare = estimateFare({ meters: rt.distance, seconds: rt.duration, dropoff: dest.label }); }
      if (sched) { sched.started = true; store.set('scheduled', store.get('scheduled', []).filter(s => s.id !== sched.id)); }
      trip = { pay: payM, id: 't-' + uid(), rider: { id: me.id, name: me.name, phone: me.phone }, pickup: { ...pickup, note: $('#note')?.value || pickup.note || '' }, dest, fare: fare.total, lines: fare.lines, surge: fare.surge, miles: fare.miles, minutes: fare.minutes, meters: rt.distance, ts: Date.now(), scheduledFor: sched?.pickupAt || null, excl: [] };
      sub('trip/' + trip.id, onTrip);
      bus.publish('trip/' + trip.id, { type: 'request', trip: pub(trip) });
      dispatch('Finding your driver…');
    }
    const pub = (t) => ({ pay: t.pay, id: t.id, rider: t.rider, pickup: t.pickup, dest: t.dest, fare: t.fare, lines: t.lines, surge: t.surge, miles: t.miles, minutes: t.minutes, meters: t.meters, ts: t.ts, scheduledFor: t.scheduledFor });
    async function dispatch(title) {
      dmk.forEach(m => m.remove()); carMk?.remove(); carMk = null; clearInterval(tick);
      sheet.innerHTML = `<h2>${esc(title)}</h2><div class="spinner"></div><p class="muted" id="ds">Contacting the closest driver by road time</p><p class="fine">No ETA is shown until a real driver accepts.</p>${callBtn(`📞 Or call dispatch ${DISPATCH_PHONE}`)}<button class="btn alt" id="cx">Cancel (free)</button>`;
      $('#cx').onclick = () => { bus.publish('trip/' + trip.id, { type: 'cancel', by: 'rider' }); trip.state = 'cancelled'; plan(); };
      trip.state = 'requested'; trip.driver = null; const t0 = Date.now(), me_t = trip;
      while (trip === me_t && (trip.state === 'requested' || trip.state === 'offered')) {
        if (trip.state === 'offered') { // dispatcher one-tap assign took over this offer
          while (trip === me_t && trip.state === 'offered' && Date.now() - trip.offerAt < 18000) await wait(300);
          if (trip === me_t && trip.state === 'offered') { trip.excl.push(trip.offerTo); trip.state = 'requested'; bus.publish('trip/' + trip.id, { type: 'timeout', driver: trip.offerTo }); }
          continue;
        }
        const near = rankDrivers([...drivers.values()], pickup, { exclude: trip.excl }).slice(0, 5);
        if (!near.length) { if (Date.now() - t0 > 90000) { sheet.innerHTML = `<h2>No drivers available</h2><p class="muted">No online drivers within 9 miles right now. Nothing was charged. Call dispatch — a real person will find you a car.</p>${callBtn()}<button class="btn" id="bk">Back</button>`; $('#bk').onclick = plan; trip = null; return; } await wait(2000); continue; }
        const ranked = rankByRoad(near, await roadTimes(near, pickup)); const c = ranked[0];
        trip.state = 'offered'; trip.offerTo = c.id; if ($('#ds')) $('#ds').textContent = `Asking ${c.name}${c.roadSec != null ? ` (${fmtMin(c.roadSec)} away by road)` : ''}…`;
        bus.publish('offer/' + c.id, { trip: pub(trip) });
        trip.offerAt = Date.now(); while (trip === me_t && trip.state === 'offered' && Date.now() - trip.offerAt < 18000) await wait(300);
        if (trip === me_t && trip.state === 'offered') { trip.excl.push(trip.offerTo); trip.state = 'requested'; bus.publish('trip/' + trip.id, { type: 'timeout', driver: trip.offerTo }); }
      }
    }
    function reassign(why) { if (!trip) return; trip.excl.push(trip.driver?.id); bus.publish('trip/' + trip.id, { type: 'reassign', driver: trip.driver?.id, why }); notify(why + ' — finding you another driver. No charge.'); dispatch('Finding you another driver…'); }
    function onTrip(m) {
      if (!trip || trip.state === 'cancelled') return;
      if (m.type === 'assign' && (trip.state === 'requested' || (trip.state === 'offered' && m.driver !== trip.offerTo))) { trip.state = 'offered'; trip.offerTo = m.driver; trip.offerAt = Date.now(); if ($('#ds')) $('#ds').textContent = `Dispatch assigned ${m.name || 'a driver'} — waiting for them to accept…`; }
      if (m.type === 'decline' && trip.state === 'offered' && m.driver === trip.offerTo) { trip.excl.push(m.driver); trip.state = 'requested'; }
      if (m.type === 'accept' && trip.state === 'offered' && m.driver.id === trip.offerTo) {
        trip.state = 'accepted'; trip.driver = m.driver; trip.matchedAt = Date.now(); trip.lastLoc = Date.now(); trip.promised = null; trip.eta = null;
        carMk = L.marker([m.driver.lat, m.driver.lng], { icon: carIcon(m.driver), zIndexOffset: 1000 }).addTo(layer);
        if (trip.scheduledFor) notify(`${m.driver.name} confirmed for your scheduled ride.`);
        sheet.innerHTML = `<h2 id="st">Driver is on the way</h2><div class="card drv"><div class="av">🚕</div><div><b>${esc(m.driver.name)}</b> ★${m.driver.rating ?? '5.0'}<div class="muted">${esc(m.driver.car)} · <b>${esc(m.driver.plate)}</b></div></div><div class="eta" id="eta">…</div></div>
        ${m.driver.sim ? '<p class="demo">DEMO: this is a simulated driver</p>' : ''}
        <div class="two eq">${m.driver.phone ? `<a class="btn alt" href="tel:${esc(m.driver.phone)}">📞 Call</a>` : '<span></span>'}<button class="btn alt" id="chatb">💬 Message</button></div><div id="chat"></div>
        ${callBtn()}<p class="muted">Pay: <b>${PAYMENTS[trip.pay]}</b> · Pickup: ${esc(trip.pickup.label)}${trip.pickup.note ? ' · “' + esc(trip.pickup.note) + '”' : ''} · ${money(trip.fare)}</p>
        <p class="fine" id="cxs"></p><button class="btn alt" id="cx">Cancel ride</button><button class="btn danger" id="ns" hidden>Driver never showed — report & cancel</button>`;
        chatBox($('#chat'), $('#chatb'), trip.id, 'rider');
        $('#cx').onclick = () => { const s = cancelStatus({ matchedAt: trip.matchedAt, now: Date.now(), promisedEtaSec: trip.promised, currentEtaSec: trip.eta }); bus.publish('trip/' + trip.id, { type: 'cancel', by: 'rider', late: !s.free }); trip.state = 'cancelled'; carMk?.remove(); plan(); };
        $('#ns').onclick = noShow;
        tick = setInterval(() => {
          if (!trip || !$('#cxs')) return;
          const now = Date.now(), s = cancelStatus({ matchedAt: trip.matchedAt, now, promisedEtaSec: trip.promised, currentEtaSec: trip.eta });
          if (trip.state === 'accepted' || trip.state === 'arrived') $('#cxs').innerHTML = s.free ? (s.late ? 'Driver is running late — cancelling is free.' : `Free cancellation for <b id="cxt">${Math.floor(s.leftMs / 60000)}:${String(Math.floor(s.leftMs / 1000) % 60).padStart(2, '0')}</b>`) : 'Free-cancel window ended. (There are never cancellation fees — the app takes no payments — but late cancels are noted for drivers.)';
          if (trip.state === 'accepted' && trip.promised != null && noShowAllowed({ matchedAt: trip.matchedAt, now, promisedEtaSec: trip.promised * NOSHOW_SCALE, arrived: false, graceSec: NOSHOW_GRACE })) $('#ns').hidden = false;
          if (trip.state === 'accepted' && now - trip.lastLoc > 60000) reassign('Lost contact with your driver');
        }, 1000);
      }
      if (!trip.driver || (m.driver && (m.driver.id || m.driver) !== trip.driver.id && m.type !== 'loc' && m.type !== 'chat')) return;
      if (m.type === 'loc' && carMk) {
        trip.lastLoc = Date.now(); animateTo(carMk, [m.lat, m.lng]);
        if (trip.state === 'accepted') { trip.eta = smooth(trip.eta, m.eta); if (trip.promised == null) trip.promised = m.eta; if ($('#eta')) $('#eta').textContent = fmtMin(trip.eta); }
        if (trip.state === 'in_progress' && $('#eta')) $('#eta').textContent = fmtMin(m.eta);
        map.panTo([m.lat, m.lng], { animate: true });
      }
      if (m.type === 'arrived') { trip.state = 'arrived'; $('#st').textContent = 'Your driver has arrived'; if ($('#eta')) $('#eta').textContent = 'Here'; $('#ns') && ($('#ns').hidden = true); navigator.vibrate?.(300); notify('Your driver has arrived'); }
      if (m.type === 'start') { trip.state = 'in_progress'; clearInterval(tick); $('#st').textContent = 'On the way to ' + dest.label.split(',')[0]; $('#cx')?.remove(); $('#ns')?.remove(); $('#cxs') && ($('#cxs').textContent = ''); }
      if (m.type === 'cancel' && m.by === 'driver') reassign('Your driver cancelled — you are not charged');
      if (m.type === 'complete') { trip.state = 'completed'; clearInterval(tick); receipt(m); }
    }
    function noShow() {
      const r = { id: 'r-' + uid(), trip: trip.id, kind: 'driver_no_show', driver: trip.driver.name, plate: trip.driver.plate, at: new Date().toISOString(), rider: me.name };
      bus.publish('trip/' + trip.id, { type: 'cancel', by: 'rider', reason: 'driver_no_show' });
      bus.publish('reports/' + r.id, r); store.set('reports', [r, ...store.get('reports', [])]);
      clearInterval(tick); carMk?.remove(); const t = trip; trip = null;
      sheet.innerHTML = `<h2 id="nsdone">Sorry about that — reported</h2><div class="card"><div class="row"><span>Charge</span><b>$0.00</b></div><div class="row"><span>Driver</span><span>${esc(r.driver)} · ${esc(r.plate)}</span></div><div class="row"><span>Report #</span><span>${r.id}</span></div></div><p class="fine">No payment was ever taken, so there is nothing to refund. The report was sent to the dispatcher and saved on this device.</p><button class="btn" id="again">Find another driver now</button><button class="btn alt" id="bk">Back</button>`;
      $('#again').onclick = () => { trip = t; trip.excl.push(t.driver.id); bus.publish('trip/' + trip.id, { type: 'request', trip: pub(trip) }); dispatch('Finding you another driver…'); };
      $('#bk').onclick = plan;
    }
    function receipt(m) {
      const rec = { id: trip.id, date: new Date().toISOString(), from: trip.pickup.label, to: dest.label, fare: m.fare, pay: trip.pay, lines: m.lines || trip.lines, miles: +(m.meters / 1609.344).toFixed(2), driver: trip.driver.name, car: trip.driver.car, plate: trip.driver.plate };
      const h = store.get('history_rider', []); h.unshift(rec); store.set('history_rider', h.slice(0, 100));
      sheet.innerHTML = `<h2 id="done">You've arrived 🎉</h2><div class="card rcpt">${(rec.lines || []).map(l => `<div class="row"><span>${esc(l[0])}</span><span>${money(l[1])}</span></div>`).join('')}<div class="row tot"><span>Total</span><b id="rfare">${money(m.fare)}</b></div><div class="row"><span>Driver</span><span>${esc(rec.driver)} · ${esc(rec.plate)}</span></div><div class="row"><span>From</span><span>${esc(rec.from)}</span></div><div class="row"><span>To</span><span>${esc(rec.to)}</span></div></div>
<div class="row"><span>Paying with</span><b id="rpay">${PAYMENTS[rec.pay]}</b></div></div>
      <p class="fine"><b>Pay ${money(m.fare)} directly to your driver.</b> ${PAY_NOTE[rec.pay]} Rocapulco never charges your card in the app — no surprise charges.</p>${payLink(rec.pay, m.fare)}
      <p>Rate your ride</p><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-s="${i}">★</button>`).join('')}</div><button class="btn" id="fin">Done</button><button class="btn link" id="prob">Report a problem</button>${callBtn()}`;
      sheet.querySelectorAll('.stars button').forEach(b => b.onclick = () => { const s = +b.dataset.s; sheet.querySelectorAll('.stars button').forEach(x => x.classList.toggle('on', +x.dataset.s <= s)); bus.publish('trip/' + trip.id, { type: 'rate', stars: s, driver: trip.driver.id }); rec.stars = s; store.set('history_rider', [rec, ...store.get('history_rider', []).slice(1)]); });
      $('#prob').onclick = () => { const r = { id: 'r-' + uid(), trip: trip.id, kind: 'trip_problem', driver: trip.driver.name, plate: trip.driver.plate, at: new Date().toISOString(), rider: me.name }; bus.publish('reports/' + r.id, r); $('#prob').textContent = 'Reported to dispatcher ✓ (#' + r.id + ')'; };
      $('#fin').onclick = () => { carMk?.remove(); line?.remove(); pinD?.remove(); pinD = line = null; dest = null; trip = null; plan(); };
    }
    function history() {
      const h = store.get('history_rider', []);
      sheet.innerHTML = `${tabs('rider')}<h2>Your trips</h2>${h.length ? h.map(r => `<div class="card hist"><div><b>${esc(r.to.split(',')[0])}</b><div class="muted">${new Date(r.date).toLocaleString()} · ${esc(r.driver)}${r.stars ? ' · ' + '★'.repeat(r.stars) : ''}</div></div><b>${money(r.fare)}</b></div>`).join('') : '<p class="muted">No trips yet.</p>'}<button class="btn" id="bk">Back</button>`;
      $('#bk').onclick = plan;
    }
    plan();
  });
}

// ===== DRIVER =====
function driver() {
  profileForm('driver', (me) => {
    let online = false, status = 'offline', loc = null, simulate = store.get('simgps', false), trip = null, rt = null, phase = null, simM = 0, lastStep = null, offer = null, rerouting = false;
    let meMk, line, watchId, gpsMode = null, lastPub = null, home = store.get('home', null), homeMode = store.get('homeMode', false);
    const info = () => ({ id: me.id, name: me.name, car: me.car, plate: me.plate, phone: me.phone, status, lat: loc?.lat, lng: loc?.lng, rating: avgRating(), ts: Date.now() });
    const avgRating = () => { const r = store.get('ratings', []); return r.length ? +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2) : 5.0; };
    const presence = (force) => { if (!loc || !(online || status === 'offline')) return;
      // battery/data friendly: publish only when moved >25 m, status changed, or every 15 s
      if (!force && lastPub && lastPub.status === status && haversine(lastPub, loc) < 25 && Date.now() - lastPub.ts < 15000) return;
      lastPub = { lat: loc.lat, lng: loc.lng, status, ts: Date.now() }; bus.publish('drivers/' + me.id, info()); };
    every(() => presence(), 5000);
    sub('offer/' + me.id, (m) => {
      if (status !== 'available' || offer) return bus.publish('trip/' + m.trip.id, { type: 'decline', driver: me.id, why: 'busy' });
      if (homeMode && home && !homeFilterOk({ driver: loc, dest: m.trip.dest, home })) { bus.publish('trip/' + m.trip.id, { type: 'decline', driver: me.id, why: 'heading_home' }); skipped++; $('#hskip') && ($('#hskip').textContent = skipped + ' skipped (not toward home)'); return; }
      showOffer(m.trip); });
    let skipped = 0;
    const setLoc = (p) => {
      loc = p; meMk ? animateTo(meMk, [p.lat, p.lng], 800) : (meMk = L.marker(p, { icon: carIcon(), zIndexOffset: 1000 }).addTo(layer));
      if (trip && rt) onMove();
    };
    // Battery-friendly GPS: low-power (network/wifi, 30 s cache) while waiting; high-accuracy only during a trip.
    async function startGPS() {
      const want = trip ? 'high' : 'low';
      if (watchId != null && gpsMode === want) return;
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      gpsMode = want;
      if (!simulate && navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => { if (p.coords.accuracy > 100 && loc) return; setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); }, () => {}, want === 'high' ? { enableHighAccuracy: true, maximumAge: 2000 } : { enableHighAccuracy: false, maximumAge: 30000 });
      if (!loc) { const p = await getPos(); setLoc(p || QUEENS); map.setView(loc, 15); }
    }
    cleanup.push(() => { if (watchId != null) navigator.geolocation.clearWatch(watchId); if (online) { status = 'offline'; presence(); } });
    every(() => { if (simulate && trip && rt && (phase === 'pickup' || phase === 'trip')) { simM = Math.min(rt.distance, simM + 15 * SPEED); setLoc(pointAlong(rt.coords, rt.cum, simM)); } }, 1000);

    function idle() {
      const e = earnings();
      sheet.innerHTML = `${tabs('driver')}<div class="hi">${esc(me.name)} · ${esc(me.car)} · ${esc(me.plate)}</div>
      <button class="btn big ${online ? 'alt' : ''}" id="tg">${online ? 'Go offline' : 'Go online'}</button>
      <p id="dst" class="muted">${online ? '🟢 Online — waiting for ride requests near you' : '⚪ Offline'}</p>
      <div class="grid"><div class="card stat"><span>Your take today (70%)</span><b id="etoday">${money(split(e.today).driver)}</b></div><div class="card stat"><span>Trips today</span><b>${e.n}</b></div><div class="card stat"><span>Your take this week</span><b id="eweek">${money(split(e.week).driver)}</b></div><div class="card stat"><span>Rating</span><b>★ ${avgRating()}</b></div></div>
      <div class="card split" id="esplit"><div class="row"><span>Fares collected today</span><span>${money(e.today)}</span></div><div class="row"><span>You keep (70%)</span><b>${money(split(e.today).driver)}</b></div><div class="row"><span>Rocapulco (30%)</span><span>${money(split(e.today).company)}</span></div></div>
      <div class="card"><label class="tog"><input type="checkbox" id="hm" ${homeMode ? 'checked' : ''}> <b>Heading home</b> — only rides that end closer to home. No daily limit.</label>
      <div class="muted">${home ? 'Home set ✓' : 'No home set'} · <a href="#" id="sethome">Set home to my current spot</a> · <span id="hskip"></span></div></div>
      ${callBtn()}<p class="fine">Declining a ride never hurts you — there is no acceptance rate. GPS: ${simulate ? 'simulated' : 'power-saver while waiting, high-accuracy on trips'}.</p>
      <label class="tog"><input type="checkbox" id="sim" ${simulate ? 'checked' : ''}> Simulate GPS (moves the car along the route — for testing indoors)</label>
      <label class="tog"><input type="checkbox" id="vo" ${store.get('voice', true) ? 'checked' : ''}> Voice directions</label>
      <a href="#" id="eh" class="btn link">Trip log</a>`;
      $('#tg').onclick = async () => { online = !online; status = online ? 'available' : 'offline'; if (online) await startGPS(); presence(true); idle(); };
      $('#sim').onchange = (e) => { simulate = e.target.checked; store.set('simgps', simulate); if (simulate && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } else if (!simulate) startGPS(); };
      $('#vo').onchange = (e) => store.set('voice', e.target.checked);
      $('#hm').onchange = (e) => { if (e.target.checked && !home) { e.target.checked = false; notify('Set your home first'); return; } homeMode = e.target.checked; store.set('homeMode', homeMode); };
      $('#sethome').onclick = (e) => { e.preventDefault(); if (!loc) return notify('Waiting for GPS…'); home = { lat: loc.lat, lng: loc.lng }; store.set('home', home); notify('Home saved on this device (never shared).'); idle(); };
      $('#eh').onclick = (e) => { e.preventDefault(); const h = store.get('history_driver', []); sheet.innerHTML = `${tabs('driver')}<h2>Trip log</h2>${h.map(r => `<div class="card hist"><div><b>${esc(r.to.split(',')[0])}</b><div class="muted">${new Date(r.date).toLocaleString()} · ${esc(r.rider)}</div></div><b>${money(r.fare)}</b></div>`).join('') || '<p class="muted">No trips yet.</p>'}<button class="btn" id="bk">Back</button>`; $('#bk').onclick = idle; };
      startGPS();
    }
    function earnings() {
      const h = store.get('history_driver', []), d0 = new Date().setHours(0, 0, 0, 0), w0 = d0 - 6 * 864e5;
      const t = h.filter(r => +new Date(r.date) >= d0);
      return { today: t.reduce((a, r) => a + r.fare, 0), n: t.length, week: h.filter(r => +new Date(r.date) >= w0).reduce((a, r) => a + r.fare, 0) };
    }
    function showOffer(t) {
      offer = t; navigator.vibrate?.([200, 100, 200]); speak('New ride request');
      const d = haversine(loc, t.pickup) * 1.3; let left = 15;
      const econ = (pm) => offerEconomics({ fare: t.fare, tripMeters: t.meters || t.miles * 1609.344, pickupMeters: pm });
      const e0 = econ(d);
      sheet.innerHTML = `<h2>New ride request</h2><div class="card offer"><div class="fare"><div class="price" id="ofare">${money(t.fare)}</div><div class="permi" id="opm">$${e0.perTripMile.toFixed(2)}/mi</div></div><div class="muted" id="otake">You keep <b>${money(e0.driverTake)}</b> (70%) · rider pays ${PAYMENTS[t.pay || 'cash']}</div>
      <div class="muted" id="oeco">${t.miles} mi trip · ${t.minutes} min · pickup ~${e0.pickupMiles} mi · $${e0.perTotalMile.toFixed(2)}/mi incl. pickup</div>
      <p><span class="dot a"></span> <b>Pickup:</b> ${esc(t.pickup.label)}${t.pickup.note ? `<br><i>“${esc(t.pickup.note)}”</i>` : ''}</p><p><span class="dot b"></span> <b>Drop-off:</b> ${esc(t.dest.label)}</p>
      <p class="muted">Rider: ${esc(t.rider.name)}${t.scheduledFor ? ` · scheduled ${new Date(t.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</p>
      ${homeMode && home ? `<p class="muted">${homeFilterOk({ driver: loc, dest: t.dest, home }) ? '🏠 Ends closer to home' : ''}</p>` : ''}</div>
      <p class="fine">Upfront fare, no surge — what you see is what the rider pays. Declining is free, no penalty.</p>
      <div class="two"><button class="btn alt" id="dec">Decline</button><button class="btn" id="acc">Accept (<span id="cd">15</span>)</button></div>`;
      const pp = L.marker(t.pickup, { icon: pinA }).addTo(layer), pd = L.marker(t.dest, { icon: pinB }).addTo(layer); map.fitBounds([[loc.lat, loc.lng], [t.pickup.lat, t.pickup.lng], [t.dest.lat, t.dest.lng]], { padding: [60, 60] });
      route(loc, t.pickup).then(r => { if (offer !== t || !$('#oeco')) return; const e = econ(r.distance); $('#oeco').textContent = `${t.miles} mi trip · ${t.minutes} min · pickup ${e.pickupMiles} mi (${fmtMin(r.duration)}) · $${e.perTotalMile.toFixed(2)}/mi incl. pickup`; });
      const h = setInterval(() => { left--; if ($('#cd')) $('#cd').textContent = left; if (left <= 0) decline(); }, 1000);
      const decline = () => { clearInterval(h); pp.remove(); pd.remove(); offer = null; bus.publish('trip/' + t.id, { type: 'decline', driver: me.id }); idle(); };
      $('#dec').onclick = decline;
      $('#acc').onclick = async () => { clearInterval(h); pp.remove(); pd.remove(); offer = null; trip = t; status = 'busy'; startGPS();
        sub('trip/' + t.id, (m) => { if (trip && m.type === 'cancel' && m.by === 'rider') { speak('Rider cancelled'); endTrip(); sheet.innerHTML = '<h2>Rider cancelled the trip</h2><button class="btn" id="bk">OK</button>'; $('#bk').onclick = idle; } if (m.type === 'rate' && m.driver === me.id) { const r = store.get('ratings', []); r.push(m.stars); store.set('ratings', r.slice(-200)); } if (m.type === 'timeout' && m.driver === me.id && trip && phase === null) endTrip(); if (m.type === 'reassign' && m.driver === me.id && trip) { endTrip(); sheet.innerHTML = '<h2>Trip was reassigned</h2><p class="muted">The rider lost contact with you and was matched with another driver.</p><button class="btn" id="bk">OK</button>'; $('#bk').onclick = idle; } });
        bus.publish('trip/' + t.id, { type: 'accept', driver: info() }); presence(true); await navTo('pickup'); };
    }
    async function navTo(p) {
      phase = p; const target = p === 'pickup' ? trip.pickup : trip.dest;
      rt = await route(p === 'pickup' ? loc : trip.pickup, target); simM = 0; lastStep = null;
      line?.remove(); line = L.polyline(rt.latlngs, { color: p === 'pickup' ? '#2563eb' : '#111', weight: 6 }).addTo(layer); L.marker(target, { icon: p === 'pickup' ? pinA : pinB }).addTo(line._map ? layer : layer);
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
      sheet.innerHTML = `<div class="nav"><div class="turn" id="turn">Starting navigation…</div><div class="muted" id="tdist"></div></div>
      <div class="card"><b>${p === 'pickup' ? 'Pick up ' + esc(trip.rider.name) : 'Drop off at ' + esc(trip.dest.label.split(',')[0])}</b><div class="muted">${esc(target.label)}</div>${p === 'pickup' && trip.pickup.note ? `<div class="note">📍 “${esc(trip.pickup.note)}”</div>` : ''}<div id="rem" class="muted"></div></div>
      <div class="two eq">${trip.rider.phone ? `<a class="btn alt" href="tel:${esc(trip.rider.phone)}">📞 Call</a>` : '<span></span>'}<button class="btn alt" id="chatb">💬 Message</button></div><div id="chat"></div>
      <a class="btn alt" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving">Open in Google Maps</a>
      <button class="btn" id="act">${p === 'pickup' ? "I've arrived" : 'Complete trip'}</button>${p === 'pickup' ? '<button class="btn link" id="dcx">Cancel trip</button>' : ''}`;
      $('#act').onclick = p === 'pickup' ? arrived : complete;
      chatBox($('#chat'), $('#chatb'), trip.id, 'driver');
      if ($('#dcx')) $('#dcx').onclick = () => { bus.publish('trip/' + trip.id, { type: 'cancel', by: 'driver' }); endTrip(); idle(); };
      onMove();
    }
    function onMove() {
      if (!rt || !loc || !$('#turn')) return;
      const pr = progress(rt, loc);
      if (Date.now() - (onMove.t || 0) > 1800) onMove.t = Date.now(), bus.publish('trip/' + trip.id, { type: 'loc', lat: loc.lat, lng: loc.lng, eta: pr.eta, remain: pr.remain });
      $('#turn').textContent = (pr.remain < 40 ? '🏁 ' : '➜ ') + (pr.remain < 40 ? 'You have arrived' : pr.next.text);
      $('#tdist').textContent = pr.remain < 40 ? '' : 'in ' + fmtDist(pr.toNext);
      $('#rem').textContent = `${fmtDist(pr.remain)} · ${fmtMin(pr.eta)} remaining`;
      if (lastStep !== pr.next) { lastStep = pr.next; speak(pr.next.text); }
      map.panTo([loc.lat, loc.lng]);
      if (pr.offRoute > 80 && !rerouting && !simulate) { rerouting = true; route(loc, phase === 'pickup' ? trip.pickup : trip.dest).then(r => { rt = r; line?.setLatLngs(r.latlngs); lastStep = null; setTimeout(() => rerouting = false, 10000); }); }
    }
    function arrived() { phase = 'waiting'; bus.publish('trip/' + trip.id, { type: 'arrived', driver: me.id }); speak('Arrived. Waiting for rider.');
      sheet.innerHTML = `<h2>Waiting for ${esc(trip.rider.name)}</h2><p class="muted">The rider has been notified you're here.</p><button class="btn" id="start">Start trip</button><button class="btn link" id="dcx">Rider no-show — cancel</button>`;
      $('#start').onclick = () => { bus.publish('trip/' + trip.id, { type: 'start', driver: me.id }); navTo('trip'); };
      $('#dcx').onclick = () => { bus.publish('trip/' + trip.id, { type: 'cancel', by: 'driver' }); endTrip(); idle(); };
    }
    function complete() {
      const f = { total: trip.fare, lines: trip.lines }; // upfront fare is locked — no surprises
      bus.publish('trip/' + trip.id, { type: 'complete', driver: me.id, fare: f.total, lines: f.lines, meters: rt.distance, seconds: rt.duration });
      const h = store.get('history_driver', []); h.unshift({ id: trip.id, date: new Date().toISOString(), fare: f.total, to: trip.dest.label, rider: trip.rider.name }); store.set('history_driver', h.slice(0, 500));
      speak('Trip complete. Collect ' + f.total.toFixed(2) + ' dollars.');
      sheet.innerHTML = `<h2 id="tdone">Trip complete</h2><div class="card fare"><div>Collect from rider · <b>${PAYMENTS[trip.pay || 'cash']}</b></div><div class="price">${money(f.total)}</div></div><div class="card"><div class="row"><span>You keep (70%)</span><b>${money(split(f.total).driver)}</b></div><div class="row"><span>Rocapulco (30%)</span><span>${money(split(f.total).company)}</span></div></div><p class="fine">Collect payment directly (cash, your card reader, Zelle or Venmo). Tolls extra.</p><button class="btn" id="bk">Back online</button>`;
      endTrip(); $('#bk').onclick = idle;
    }
    function endTrip() { trip = null; rt = null; phase = null; line?.remove(); layer.eachLayer(l => { if (l !== meMk) l.remove(); }); status = online ? 'available' : 'offline'; presence(true); startGPS(); }
    idle();
  });
}

// ===== DISPATCHER =====
function admin() {
  const drivers = new Map(), mk = new Map(), trips = new Map(), reports = [];
  sheet.innerHTML = `${tabs('admin')}<h2>Dispatch Center</h2><div class="grid three"><div class="card stat"><span>Online drivers</span><b id="nd">0</b></div><div class="card stat"><span>Active trips</span><b id="nt">0</b></div><div class="card stat"><span>Waiting riders</span><b id="nw">0</b></div></div>
  <div class="grid"><div class="card stat"><span>Fares today</span><b id="nf">$0.00</b></div><div class="card stat"><span>Rocapulco 30%</span><b id="nc">$0.00</b></div></div>
  <p class="nosurge">✓ No surge, ever. Pricing is fixed: $3.50 + $2.50/mi + $0.40/min · JFK $50 · LGA $55.</p>
  <h3>Needs a driver</h3><div id="open"></div><div id="rp"></div><h3>All trips</h3><div id="tl"></div>${callBtn(`📞 Dispatch line ${DISPATCH_PHONE}`)}<p class="fine">Live view of channel “${esc(NS)}”. Tap a driver to assign the ride in one tap. Demo drivers shown with a dashed outline.</p>`;
  let earned = 0;
  const avail = () => { const now = Date.now(); return [...drivers.values()].filter(d => d.status === 'available' && now - d.ts < 30000); };
  const draw = () => {
    const now = Date.now(), on = [...drivers.values()].filter(d => d.status !== 'offline' && now - d.ts < 30000);
    $('#nd') && ($('#nd').textContent = on.length);
    mk.forEach((m, id) => { if (!on.find(d => d.id === id)) { m.remove(); mk.delete(id); } });
    const list = [...trips.values()].sort((a, b) => b.ts - a.ts).slice(0, 30);
    const open = list.filter(t => ['requested', 'offered', 'reassigning', 'scheduled, dispatching'].includes(t.state));
    $('#nt') && ($('#nt').textContent = list.filter(t => !['completed', 'cancelled', 'cancelled — driver no-show'].includes(t.state)).length);
    $('#nw') && ($('#nw').textContent = open.length);
    $('#nf') && ($('#nf').textContent = money(earned)); $('#nc') && ($('#nc').textContent = money(split(earned).company));
    const av = avail();
    if ($('#open')) {
      $('#open').innerHTML = open.length ? open.map(t => `<div class="card assign" data-t="${esc(t.id)}"><div><b>${esc(t.rider)}</b> → ${esc(t.to)} · ${money(t.fare || 0)} · ${PAYMENTS[t.pay || 'cash']}<div class="muted">${esc(t.state)}${t.assigned ? ' · assigned to ' + esc(t.assigned) : ''}</div></div>
        <div class="drvs">${av.length ? av.map(d => ({ d, m: haversine(d, t.pickup) })).sort((a, b) => a.m - b.m).slice(0, 4).map(({ d, m }) => `<button class="btn sm gold" data-a="${esc(d.id)}">Assign ${esc(d.name)} · ${(m / 1609.344).toFixed(1)} mi</button>`).join('') : '<span class="muted">No available drivers online</span>'}</div></div>`).join('') : '<p class="muted">No riders waiting.</p>';
      $('#open').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const tid = b.closest('[data-t]').dataset.t, t = trips.get(tid), d = drivers.get(b.dataset.a); if (!t || !d) return;
        bus.publish('trip/' + tid, { type: 'assign', driver: d.id, name: d.name });
        bus.publish('offer/' + d.id, { trip: t.full });
        t.assigned = d.name; notify(`Assigned ${d.name} to ${t.rider}`); draw();
      });
    }
    $('#rp') && ($('#rp').innerHTML = reports.map(r => `<div class="card hist rep"><div><b>⚠️ ${r.kind === 'driver_no_show' ? 'Driver no-show' : 'Trip problem'}</b><div class="muted">${esc(r.rider)} · ${esc(r.driver)} ${esc(r.plate)} · ${new Date(r.at).toLocaleTimeString()}</div></div><span class="muted">#${esc(r.id)}</span></div>`).join(''));
    $('#tl') && ($('#tl').innerHTML = list.map(t => `<div class="card hist"><div><b>${esc(t.rider)} → ${esc(t.to)}</b><div class="muted">${esc(t.state)}${t.driver ? ' · ' + esc(t.driver) : ''} · ${new Date(t.ts).toLocaleTimeString()}</div></div><b>${money(t.fare || 0)}</b></div>`).join(''));
  };
  sub('drivers/+', (d) => { drivers.set(d.id, d); if (d.status === 'offline') return draw(); if (!mk.has(d.id)) mk.set(d.id, L.marker([d.lat, d.lng], { icon: carIcon(d) }).bindTooltip(`${d.name} · ${d.status}`).addTo(layer)); else { animateTo(mk.get(d.id), [d.lat, d.lng]); mk.get(d.id).setTooltipContent(`${d.name} · ${d.status}`); } draw(); });
  sub('reports/+', (r) => { reports.unshift(r); draw(); });
  sub('trip/+', (m, topic) => {
    const id = topic.split('/')[1];
    if (m.type === 'request' && !trips.has(id)) trips.set(id, { id, full: m.trip, pickup: m.trip.pickup, pay: m.trip.pay, rider: m.trip.rider.name, to: m.trip.dest.label.split(',')[0], fare: m.trip.fare, ts: m.trip.ts, state: m.trip.scheduledFor ? 'scheduled, dispatching' : 'requested' });
    const t = trips.get(id); if (!t) return;
    const st = { accept: 'driver en route', arrived: 'driver arrived', start: 'in trip', complete: 'completed', cancel: m.reason === 'driver_no_show' ? 'cancelled — driver no-show' : m.by === 'driver' ? 'reassigning' : 'cancelled', reassign: 'reassigning', request: t.state === 'reassigning' ? 'requested' : null }[m.type];
    if (st) t.state = st; if (m.type === 'accept') { t.driver = m.driver.name; t.assigned = null; } if (m.type === 'complete') { t.fare = m.fare; earned += m.fare; } draw();
  });
  every(draw, 5000);
}

function router() { reset(); const r = location.hash.replace('#/', ''); document.body.dataset.view = r || 'home'; ({ rider, driver, admin }[r] || home)(); setTimeout(() => map.invalidateSize(), 50); }
addEventListener('hashchange', router); router();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
window.__qc = { bus, NS };
