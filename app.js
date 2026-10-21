import { estimateFare, money } from './fare.js';
import { rankDrivers, haversine, cumulative, pointAlong, nearestIndex, instruction } from './dispatch.js';
import { Bus } from './transport.js';

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
const QUEENS = { lat: 40.6054, lng: -73.7551 }; // Far Rockaway

const bus = new Bus({ mode: ['local', 'mqtt'].includes(Q.get('transport')) ? Q.get('transport') : 'nostr', ns: NS, onStatus: s => { $('#net').textContent = s === 'online' ? '● Live' : s === 'local' ? '● Local' : '○ ' + s; $('#net').className = 'net ' + s; } });

// ---------- map ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([QUEENS.lat, QUEENS.lng], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routing <a href="https://project-osrm.org">OSRM</a> · Search <a href="https://photon.komoot.io">Photon</a>' }).addTo(map);
const layer = L.layerGroup().addTo(map);
const icon = (html, cls = '') => L.divIcon({ html, className: 'mk ' + cls, iconSize: [34, 34], iconAnchor: [17, 17] });
const carIcon = (d) => icon('🚕', d && d.sim ? 'sim' : '');
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

// ---------- simulated drivers (demo mode) ----------
const NAMES = [['Marcus', 'Toyota Camry Hybrid', 'T7xx'], ['Priya', 'Honda Accord', 'T4xx'], ['Luis', 'Ford Escape', 'T9xx'], ['Danielle', 'Nissan Rogue', 'T2xx']];
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
    bus.publish('trip/' + trip.id, { type: 'accept', driver: this.info() });
    await this.drive(await route(this, trip.pickup), trip);
    bus.publish('trip/' + trip.id, { type: 'arrived', driver: this.id }); await wait(3000);
    bus.publish('trip/' + trip.id, { type: 'start', driver: this.id });
    const rt = await route(trip.pickup, trip.dest); await this.drive(rt, trip);
    const f = estimateFare({ meters: rt.distance, seconds: rt.duration, dropoff: trip.dest.label });
    bus.publish('trip/' + trip.id, { type: 'complete', driver: this.id, fare: f.total, meters: rt.distance, seconds: rt.duration });
    this.status = 'available';
  }
  async drive(rt, trip) {
    for (let m = 0; m < rt.distance; m += 15 * SPEED) {
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
const tabs = (cur) => `<nav class="tabs">${['rider', 'driver', 'admin'].map(t => `<a href="#/${t}" class="${t === cur ? 'on' : ''}">${{ rider: 'Ride', driver: 'Drive', admin: 'Dispatch' }[t]}</a>`).join('')}</nav>`;

function home() {
  sheet.innerHTML = `<h1>Rocapulco Supreme</h1><p class="muted">Premium car service for Far Rockaway & all of NYC. Live map, real routes, upfront fares, airport flat rates (JFK $45 · LGA $55).</p>
  <a class="btn big" href="#/rider" id="go-rider">🧍 I need a ride</a><a class="btn big alt" href="#/driver" id="go-driver">🚕 I'm a driver</a><a class="btn link" href="#/admin">Dispatcher view</a>
  <p class="fine">Payments are not processed in the app — pay your driver directly. Channel: <b>${esc(NS)}</b></p>`;
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
    let pickup = null, dest = null, rt = null, fare = null, trip = null, sims = [], demo = store.get('demo', true);
    let pinP, pinD, line, carMk;
    sub('drivers/+', (d) => {
      if (d.sim && d.owner !== me.id) return;
      drivers.set(d.id, d);
      if (trip) return;
      if (d.status === 'offline') { dmk.get(d.id)?.remove(); dmk.delete(d.id); return; }
      if (!dmk.has(d.id)) dmk.set(d.id, L.marker([d.lat, d.lng], { icon: carIcon(d) }).addTo(layer)); else dmk.get(d.id).setLatLng([d.lat, d.lng]);
    });
    cleanup.push(() => sims.forEach(s => s.stop()));
    const spawnSims = () => { if (demo && !sims.length && pickup) sims = [0, 1, 2, 3].map(i => new SimDriver(pickup, me.id, i)); };
    const stopSims = () => { sims.forEach(s => { s.stop(); dmk.get(s.id)?.remove(); dmk.delete(s.id); drivers.delete(s.id); }); sims = []; };

    function plan() {
      trip = null; dmk.forEach(m => m.addTo(layer));
      sheet.innerHTML = `${tabs('rider')}<div class="hi">Hi ${esc(me.name.split(' ')[0])} 👋 <a href="#" id="hist">History</a></div>
      <div class="field"><span class="dot a"></span><input id="pu" placeholder="Pickup — locating…"><button id="gps" title="Use my location">◎</button></div><ul id="pul" class="sugg"></ul>
      <div class="field"><span class="dot b"></span><input id="de" placeholder="Where to?"></div><ul id="del" class="sugg"></ul>
      <p class="fine">Tip: tap the map to set ${'<b>destination</b>'} (long-press for pickup).</p>
      <label class="tog"><input type="checkbox" id="demo" ${demo ? 'checked' : ''}> Demo mode — show simulated drivers (clearly labeled)</label>
      <div id="est"></div><button class="btn" id="req" disabled>Request ride</button>`;
      autocomplete($('#pu'), $('#pul'), () => pickup || QUEENS, (r) => setPickup(r, r.label));
      autocomplete($('#de'), $('#del'), () => pickup || QUEENS, (r) => setDest(r));
      $('#gps').onclick = locate; $('#hist').onclick = (e) => { e.preventDefault(); history(); };
      $('#demo').onchange = (e) => { demo = e.target.checked; store.set('demo', demo); demo ? spawnSims() : stopSims(); };
      $('#req').onclick = request;
      if (pickup) { $('#pu').value = pickup.label || ''; } else locate();
      if (dest) { $('#de').value = dest.label || ''; estimate(); }
    }
    async function locate() {
      $('#pu').placeholder = 'Locating…';
      const p = await getPos();
      if (!p) { $('#pu').placeholder = 'Location blocked — type your pickup'; return; }
      setPickup(p, await reverse(p));
    }
    function setPickup(p, label) {
      pickup = { lat: p.lat, lng: p.lng, label }; if ($('#pu')) $('#pu').value = label;
      pinP ? pinP.setLatLng(p) : (pinP = L.marker(p, { icon: pinA }).addTo(layer)); map.setView(p, 15); spawnSims(); estimate();
    }
    async function setDest(p) { dest = { lat: p.lat, lng: p.lng, label: p.label || await reverse(p) }; if ($('#de')) $('#de').value = dest.label; pinD ? pinD.setLatLng(p) : (pinD = L.marker(p, { icon: pinB }).addTo(layer)); estimate(); }
    const onTap = (e) => { if (trip) return; setDest({ lat: e.latlng.lat, lng: e.latlng.lng }); };
    const onHold = (e) => { if (trip) return; reverse(e.latlng).then(l => setPickup(e.latlng, l)); };
    map.on('click', onTap); map.on('contextmenu', onHold); cleanup.push(() => { map.off('click', onTap); map.off('contextmenu', onHold); });
    async function estimate() {
      if (!pickup || !dest) return;
      $('#est').innerHTML = '<p class="muted">Calculating route…</p>';
      rt = await route(pickup, dest); fare = estimateFare({ meters: rt.distance, seconds: rt.duration, dropoff: dest.label });
      line?.remove(); line = L.polyline(rt.latlngs, { color: '#111', weight: 5 }).addTo(layer); map.fitBounds(line.getBounds(), { padding: [40, 40], paddingBottomRight: [20, 320] });
      const near = rankDrivers([...drivers.values()], pickup)[0];
      if (!$('#est')) return;
      $('#est').innerHTML = `<div class="card fare"><div><b>Rocapulco Supreme</b><div class="muted">${fare.miles} mi · ${fmtMin(rt.duration)}${rt.real ? '' : ' (approx.)'}${near ? ' · nearest car ' + fmtDist(near.dist) : ''}</div></div><div class="price" id="fare">${money(fare.total)}</div></div>${fare.flat ? '<p class="demo">✈️ Airport flat rate</p>' : ''}
      <p class="fine">Estimate ${money(fare.low)}–${money(fare.high)} (${fare.flat ? 'airport flat rate' : '$5 base + $2.50/mi + $0.40/min'}); tolls & tip extra. <b>Pay driver directly (cash/card)</b> — no payment is taken here.</p>`;
      $('#req').disabled = false;
    }
    async function request() {
      trip = { id: 't-' + uid(), rider: { id: me.id, name: me.name, phone: me.phone }, pickup, dest, fare: fare.total, miles: fare.miles, minutes: fare.minutes, ts: Date.now() };
      sub('trip/' + trip.id, onTrip);
      bus.publish('trip/' + trip.id, { type: 'request', trip });
      dmk.forEach(m => m.remove());
      sheet.innerHTML = `<h2>Finding your driver…</h2><div class="spinner"></div><p class="muted" id="ds">Contacting nearby drivers</p><button class="btn alt" id="cx">Cancel</button>`;
      $('#cx').onclick = () => { bus.publish('trip/' + trip.id, { type: 'cancel', by: 'rider' }); trip.state = 'cancelled'; plan(); };
      trip.state = 'requested'; const excl = [], t0 = Date.now();
      while (trip && trip.state === 'requested') {
        const c = rankDrivers([...drivers.values()], pickup, { exclude: excl })[0];
        if (!c) { if (Date.now() - t0 > 45000) { sheet.innerHTML = `<h2>No drivers available</h2><p class="muted">No online drivers within 9 miles right now. Try again, or turn on Demo mode to see how it works.</p><button class="btn" id="bk">Back</button>`; $('#bk').onclick = plan; trip = null; return; } await wait(2000); continue; }
        trip.state = 'offered'; trip.offerTo = c.id; if ($('#ds')) $('#ds').textContent = `Offering to ${c.name} (${fmtDist(c.dist)} away)…`;
        bus.publish('offer/' + c.id, { trip: { ...trip, state: undefined } });
        const t1 = Date.now(); while (trip && trip.state === 'offered' && Date.now() - t1 < 20000) await wait(300);
        if (trip && trip.state === 'offered') { excl.push(c.id); trip.state = 'requested'; bus.publish('trip/' + trip.id, { type: 'timeout', driver: c.id }); }
      }
    }
    function onTrip(m) {
      if (!trip || trip.state === 'cancelled') return;
      if (m.type === 'decline' && trip.state === 'offered' && m.driver === trip.offerTo) trip.state = 'requested';
      if (m.type === 'accept' && trip.state === 'offered' && m.driver.id === trip.offerTo) {
        trip.state = 'accepted'; trip.driver = m.driver; carMk = L.marker([m.driver.lat, m.driver.lng], { icon: carIcon(m.driver), zIndexOffset: 1000 }).addTo(layer);
        sheet.innerHTML = `<h2 id="st">Driver is on the way</h2><div class="card drv"><div class="av">🚕</div><div><b>${esc(m.driver.name)}</b> ★${m.driver.rating ?? '5.0'}<div class="muted">${esc(m.driver.car)} · <b>${esc(m.driver.plate)}</b></div></div><div class="eta" id="eta">—</div></div>
        ${m.driver.sim ? '<p class="demo">DEMO: this is a simulated driver</p>' : m.driver.phone ? `<a class="btn alt" href="tel:${esc(m.driver.phone)}">Call driver</a>` : ''}
        <p class="muted">Pickup: ${esc(pickup.label)}</p><button class="btn alt" id="cx">Cancel ride</button>`;
        $('#cx').onclick = () => { bus.publish('trip/' + trip.id, { type: 'cancel', by: 'rider' }); trip.state = 'cancelled'; carMk.remove(); plan(); };
      }
      if (!trip.driver || (m.driver && (m.driver.id || m.driver) !== trip.driver.id && m.type !== 'loc')) return;
      if (m.type === 'loc' && carMk) { carMk.setLatLng([m.lat, m.lng]); if ($('#eta')) $('#eta').textContent = fmtMin(m.eta); map.panTo([m.lat, m.lng], { animate: true }); }
      if (m.type === 'arrived') { trip.state = 'arrived'; $('#st').textContent = 'Your driver has arrived'; if ($('#eta')) $('#eta').textContent = 'Here'; navigator.vibrate?.(300); $('#cx') && ($('#cx').textContent = 'Cancel'); }
      if (m.type === 'start') { trip.state = 'in_progress'; $('#st').textContent = 'On the way to ' + dest.label.split(',')[0]; $('#cx')?.remove(); }
      if (m.type === 'cancel' && m.by === 'driver') { carMk?.remove(); trip = null; sheet.innerHTML = `<h2>Driver cancelled</h2><button class="btn" id="bk">Request again</button>`; $('#bk').onclick = () => { plan(); }; }
      if (m.type === 'complete') { trip.state = 'completed'; receipt(m); }
    }
    function receipt(m) {
      const rec = { id: trip.id, date: new Date().toISOString(), from: pickup.label, to: dest.label, fare: m.fare, miles: +(m.meters / 1609.344).toFixed(2), driver: trip.driver.name, car: trip.driver.car, plate: trip.driver.plate };
      const h = store.get('history_rider', []); h.unshift(rec); store.set('history_rider', h.slice(0, 100));
      sheet.innerHTML = `<h2 id="done">You've arrived 🎉</h2><div class="card rcpt"><div class="row"><span>Fare</span><b id="rfare">${money(m.fare)}</b></div><div class="row"><span>Distance</span><span>${rec.miles} mi</span></div><div class="row"><span>Driver</span><span>${esc(rec.driver)} · ${esc(rec.plate)}</span></div><div class="row"><span>From</span><span>${esc(rec.from)}</span></div><div class="row"><span>To</span><span>${esc(rec.to)}</span></div></div>
      <p class="fine"><b>Pay ${money(m.fare)} directly to your driver</b> (cash or their card reader). Rocapulco Supreme does not process payments.</p>
      <p>Rate your ride</p><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-s="${i}">★</button>`).join('')}</div><button class="btn" id="fin">Done</button>`;
      sheet.querySelectorAll('.stars button').forEach(b => b.onclick = () => { const s = +b.dataset.s; sheet.querySelectorAll('.stars button').forEach(x => x.classList.toggle('on', +x.dataset.s <= s)); bus.publish('trip/' + trip.id, { type: 'rate', stars: s, driver: trip.driver.id }); rec.stars = s; store.set('history_rider', [rec, ...store.get('history_rider', []).slice(1)]); });
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
    let meMk, line, watchId;
    const info = () => ({ id: me.id, name: me.name, car: me.car, plate: me.plate, phone: me.phone, status, lat: loc?.lat, lng: loc?.lng, rating: avgRating(), ts: Date.now() });
    const avgRating = () => { const r = store.get('ratings', []); return r.length ? +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2) : 5.0; };
    const presence = () => { if (loc && (online || status === 'offline')) bus.publish('drivers/' + me.id, info()); };
    every(presence, 5000);
    sub('offer/' + me.id, (m) => { if (status !== 'available' || offer) return bus.publish('trip/' + m.trip.id, { type: 'decline', driver: me.id }); showOffer(m.trip); });
    const setLoc = (p) => {
      loc = p; meMk ? meMk.setLatLng(p) : (meMk = L.marker(p, { icon: carIcon(), zIndexOffset: 1000 }).addTo(layer));
      if (trip && rt) onMove();
    };
    async function startGPS() {
      if (watchId != null) return;
      if (!simulate && navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
      if (!loc) { const p = await getPos(); setLoc(p || QUEENS); map.setView(loc, 15); }
    }
    cleanup.push(() => { if (watchId != null) navigator.geolocation.clearWatch(watchId); if (online) { status = 'offline'; presence(); } });
    every(() => { if (simulate && trip && rt && (phase === 'pickup' || phase === 'trip')) { simM = Math.min(rt.distance, simM + 15 * SPEED); setLoc(pointAlong(rt.coords, rt.cum, simM)); } }, 1000);

    function idle() {
      const e = earnings();
      sheet.innerHTML = `${tabs('driver')}<div class="hi">${esc(me.name)} · ${esc(me.car)} · ${esc(me.plate)}</div>
      <button class="btn big ${online ? 'alt' : ''}" id="tg">${online ? 'Go offline' : 'Go online'}</button>
      <p id="dst" class="muted">${online ? '🟢 Online — waiting for ride requests near you' : '⚪ Offline'}</p>
      <div class="grid"><div class="card stat"><span>Today</span><b id="etoday">${money(e.today)}</b></div><div class="card stat"><span>Trips today</span><b>${e.n}</b></div><div class="card stat"><span>This week</span><b>${money(e.week)}</b></div><div class="card stat"><span>Rating</span><b>★ ${avgRating()}</b></div></div>
      <label class="tog"><input type="checkbox" id="sim" ${simulate ? 'checked' : ''}> Simulate GPS (moves the car along the route — for testing indoors)</label>
      <label class="tog"><input type="checkbox" id="vo" ${store.get('voice', true) ? 'checked' : ''}> Voice directions</label>
      <a href="#" id="eh" class="btn link">Trip log</a>`;
      $('#tg').onclick = async () => { online = !online; status = online ? 'available' : 'offline'; if (online) await startGPS(); presence(); idle(); };
      $('#sim').onchange = (e) => { simulate = e.target.checked; store.set('simgps', simulate); if (simulate && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } else if (!simulate) startGPS(); };
      $('#vo').onchange = (e) => store.set('voice', e.target.checked);
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
      const d = haversine(loc, t.pickup); let left = 15;
      sheet.innerHTML = `<h2>New ride request</h2><div class="card offer"><div class="price">${money(t.fare)}</div><div class="muted">${t.miles} mi trip · ${t.minutes} min · pickup ${fmtDist(d)} away</div>
      <p><span class="dot a"></span> ${esc(t.pickup.label)}</p><p><span class="dot b"></span> ${esc(t.dest.label)}</p><p class="muted">Rider: ${esc(t.rider.name)}</p></div>
      <div class="two"><button class="btn alt" id="dec">Decline</button><button class="btn" id="acc">Accept (<span id="cd">15</span>)</button></div>`;
      const pp = L.marker(t.pickup, { icon: pinA }).addTo(layer); map.fitBounds([[loc.lat, loc.lng], [t.pickup.lat, t.pickup.lng]], { padding: [60, 60] });
      const h = setInterval(() => { left--; if ($('#cd')) $('#cd').textContent = left; if (left <= 0) decline(); }, 1000);
      const decline = () => { clearInterval(h); pp.remove(); offer = null; bus.publish('trip/' + t.id, { type: 'decline', driver: me.id }); idle(); };
      $('#dec').onclick = decline;
      $('#acc').onclick = async () => { clearInterval(h); pp.remove(); offer = null; trip = t; status = 'busy';
        sub('trip/' + t.id, (m) => { if (trip && m.type === 'cancel' && m.by === 'rider') { speak('Rider cancelled'); endTrip(); sheet.innerHTML = '<h2>Rider cancelled the trip</h2><button class="btn" id="bk">OK</button>'; $('#bk').onclick = idle; } if (m.type === 'rate' && m.driver === me.id) { const r = store.get('ratings', []); r.push(m.stars); store.set('ratings', r.slice(-200)); } if (m.type === 'timeout' && m.driver === me.id && trip && phase === null) endTrip(); });
        bus.publish('trip/' + t.id, { type: 'accept', driver: info() }); presence(); await navTo('pickup'); };
    }
    async function navTo(p) {
      phase = p; const target = p === 'pickup' ? trip.pickup : trip.dest;
      rt = await route(p === 'pickup' ? loc : trip.pickup, target); simM = 0; lastStep = null;
      line?.remove(); line = L.polyline(rt.latlngs, { color: p === 'pickup' ? '#2563eb' : '#111', weight: 6 }).addTo(layer); L.marker(target, { icon: p === 'pickup' ? pinA : pinB }).addTo(line._map ? layer : layer);
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
      sheet.innerHTML = `<div class="nav"><div class="turn" id="turn">Starting navigation…</div><div class="muted" id="tdist"></div></div>
      <div class="card"><b>${p === 'pickup' ? 'Pick up ' + esc(trip.rider.name) : 'Drop off at ' + esc(trip.dest.label.split(',')[0])}</b><div class="muted">${esc(target.label)}</div><div id="rem" class="muted"></div></div>
      ${p === 'pickup' && trip.rider.phone ? `<a class="btn alt" href="tel:${esc(trip.rider.phone)}">Call rider</a>` : ''}
      <a class="btn alt" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving">Open in Google Maps</a>
      <button class="btn" id="act">${p === 'pickup' ? "I've arrived" : 'Complete trip'}</button>${p === 'pickup' ? '<button class="btn link" id="dcx">Cancel trip</button>' : ''}`;
      $('#act').onclick = p === 'pickup' ? arrived : complete;
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
      const f = estimateFare({ meters: rt.distance, seconds: rt.duration, dropoff: trip.dest.label });
      bus.publish('trip/' + trip.id, { type: 'complete', driver: me.id, fare: f.total, meters: rt.distance, seconds: rt.duration });
      const h = store.get('history_driver', []); h.unshift({ id: trip.id, date: new Date().toISOString(), fare: f.total, to: trip.dest.label, rider: trip.rider.name }); store.set('history_driver', h.slice(0, 500));
      speak('Trip complete. Collect ' + f.total.toFixed(2) + ' dollars.');
      sheet.innerHTML = `<h2 id="tdone">Trip complete</h2><div class="card fare"><div>Collect from rider</div><div class="price">${money(f.total)}</div></div><p class="fine">Collect payment directly (cash or your card reader). Tolls extra. Rocapulco Supreme rates.</p><button class="btn" id="bk">Back online</button>`;
      endTrip(); $('#bk').onclick = idle;
    }
    function endTrip() { trip = null; rt = null; phase = null; line?.remove(); layer.eachLayer(l => { if (l !== meMk) l.remove(); }); status = online ? 'available' : 'offline'; presence(); }
    idle();
  });
}

// ===== DISPATCHER =====
function admin() {
  const drivers = new Map(), mk = new Map(), trips = new Map();
  sheet.innerHTML = `${tabs('admin')}<h2>Dispatcher</h2><div class="grid"><div class="card stat"><span>Online drivers</span><b id="nd">0</b></div><div class="card stat"><span>Active trips</span><b id="nt">0</b></div></div><div id="tl"></div><p class="fine">Live view of channel “${esc(NS)}”. Demo drivers shown with a dashed outline.</p>`;
  const draw = () => {
    const now = Date.now(), on = [...drivers.values()].filter(d => d.status !== 'offline' && now - d.ts < 20000);
    $('#nd') && ($('#nd').textContent = on.length);
    mk.forEach((m, id) => { if (!on.find(d => d.id === id)) { m.remove(); mk.delete(id); } });
    const list = [...trips.values()].sort((a, b) => b.ts - a.ts).slice(0, 30);
    $('#nt') && ($('#nt').textContent = list.filter(t => !['completed', 'cancelled'].includes(t.state)).length);
    $('#tl') && ($('#tl').innerHTML = list.map(t => `<div class="card hist"><div><b>${esc(t.rider)} → ${esc(t.to)}</b><div class="muted">${esc(t.state)}${t.driver ? ' · ' + esc(t.driver) : ''} · ${new Date(t.ts).toLocaleTimeString()}</div></div><b>${money(t.fare || 0)}</b></div>`).join(''));
  };
  sub('drivers/+', (d) => { drivers.set(d.id, d); if (d.status === 'offline') return draw(); if (!mk.has(d.id)) mk.set(d.id, L.marker([d.lat, d.lng], { icon: carIcon(d) }).bindTooltip(`${d.name} · ${d.status}`).addTo(layer)); else mk.get(d.id).setLatLng([d.lat, d.lng]).setTooltipContent(`${d.name} · ${d.status}`); draw(); });
  sub('trip/+', (m, topic) => {
    const id = topic.split('/')[1];
    if (m.type === 'request') trips.set(id, { rider: m.trip.rider.name, to: m.trip.dest.label.split(',')[0], fare: m.trip.fare, ts: m.trip.ts, state: 'requested' });
    const t = trips.get(id); if (!t) return;
    const st = { accept: 'driver en route', arrived: 'driver arrived', start: 'in trip', complete: 'completed', cancel: 'cancelled' }[m.type];
    if (st) t.state = st; if (m.type === 'accept') t.driver = m.driver.name; if (m.type === 'complete') t.fare = m.fare; draw();
  });
  every(draw, 5000);
}

function router() { reset(); const r = location.hash.replace('#/', ''); document.body.dataset.view = r || 'home'; ({ rider, driver, admin }[r] || home)(); setTimeout(() => map.invalidateSize(), 50); }
addEventListener('hashchange', router); router();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
window.__qc = { bus, NS };
