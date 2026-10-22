// Rocapulco Supreme ⇄ Supabase (project ace-platform, free tier). Public publishable key only — all access is enforced by Row Level Security.
// Riders book as guests via book_ride() (no account needed); the Dispatch Center signs in with a dispatcher account.
// If the server is unreachable the app keeps working over the live relay bus (transport.js).
export const SUPABASE = { url: 'https://czjwiudbasqwlwvezmaz.supabase.co', anonKey: 'sb_publishable_I9N8lydmQ1h6NQD6JT-jDQ_PQkjsBAK' };
let _sb; export async function sb() { if (_sb) return _sb; const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.4'); _sb = createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: true, storageKey: 'roca-sb-auth' } }); globalThis.ROC_SB = _sb; return _sb; }
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const flat = d => /jfk|kennedy/i.test(d || '') ? 'JFK' : /laguardia|lga/i.test(d || '') ? 'LGA' : null;
export async function bookRide(t) { const c = await sb(); const r = must(await c.rpc('book_ride', { p: { ext_id: t.id, rider_name: t.rider?.name, rider_phone: t.rider?.phone, pickup_address: t.pickup?.name || t.pickup?.label || t.pickup?.address || 'Pickup', pickup_lat: t.pickup?.lat, pickup_lng: t.pickup?.lng,
  dropoff_address: t.dest?.name || t.dest?.label || t.dest?.address || 'Dropoff', dropoff_lat: t.dest?.lat, dropoff_lng: t.dest?.lng, est_miles: t.miles, est_minutes: t.minutes, flat_rate: flat(t.dest?.name || t.dest?.label), vehicle_class: t.vclass === 'suv' ? 'suv' : 'sedan', rider_pub: t.riderPub || null, payment_method: t.pay, scheduled_for: t.scheduledFor ? new Date(t.scheduledFor).toISOString() : null } }))[0];
  const mine = JSON.parse(localStorage.getItem('roca_server_rides') || '{}'); mine[t.id] = { id: r.id, token: r.token }; localStorage.setItem('roca_server_rides', JSON.stringify(mine)); return r; }
const ref = extId => JSON.parse(localStorage.getItem('roca_server_rides') || '{}')[extId];
export async function cancelRide(extId) { const k = ref(extId); if (!k) return; const c = await sb(); return must(await c.rpc('rider_cancel', { p_id: k.id, p_token: k.token })); }
export async function rideStatus(extId) { const k = ref(extId); if (!k) return null; const c = await sb(); return must(await c.rpc('ride_status', { p_id: k.id, p_token: k.token }))[0] || null; }
// ---- Dispatch Center (dispatcher account)
export const STATUS = { requested: 'Needs a driver', assigned: 'Assigned', en_route: 'Driver en route', arrived: 'Driver arrived', in_progress: 'On trip', completed: 'Completed', cancelled_rider: 'Rider cancelled', cancelled_driver: 'Driver cancelled (no charge)' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => n == null ? '' : '$' + Number(n).toFixed(2), PAY = { cash: 'Cash', card: 'Card', zelle: 'Zelle', venmo: 'Venmo' };
export async function mountDispatch(el) { const c = await sb(); let unsub = null, keepInv = null;
  const role = async () => { const { data } = await c.auth.getSession(); if (!data.session) return null; return (await c.from('profiles').select('role,taxi_role,display_name').eq('id', data.session.user.id).maybeSingle()).data; };
  async function render() { if (!el.isConnected) return unsub?.(); const me = await role();
    if (!me) { el.innerHTML = `<div class="card"><b>Server bookings</b><p class="muted">Sign in with your Rocapulco dispatcher account to see every booking saved on the server.</p>
      <form id="sbf"><input name="email" type="email" required placeholder="Dispatcher email" autocomplete="username"><input name="password" type="password" required minlength="8" placeholder="Password" autocomplete="current-password"><button class="btn gold">Sign in</button></form><p id="sbm" class="fine"></p></div>`;
      const f = el.querySelector('#sbf'), msg = t => el.querySelector('#sbm').textContent = t, cred = () => ({ email: f.email.value.trim(), password: f.password.value });
      const check = () => { const { email, password } = cred(); if (!email) return 'Enter your email address.'; if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'That email doesn\'t look right (example: name@gmail.com).';
        if (!password) return 'Enter a password.'; if (password.length < 8) return 'Password must be at least 8 characters.'; return null; };
      const nice = e => /rate limit/i.test(e.message) ? 'Too many sign-up emails right now — please try again in an hour or call dispatch.' : /already registered/i.test(e.message) ? 'An account with this email already exists — use Sign in.' : /invalid login/i.test(e.message) ? 'Wrong email or password.' : /not confirmed/i.test(e.message) ? 'Confirm your email first (check your inbox), then sign in.' : e.message;
      f.onsubmit = async e => { e.preventDefault(); const bad = check(); if (bad) return msg(bad); msg('Signing in…'); const { error } = await c.auth.signInWithPassword(cred()); if (error) msg(nice(error)); else render(); }; return; }
    if (!['dispatcher', 'owner'].includes(me.taxi_role)) { el.innerHTML = '<div class="card">This account is not a dispatcher account. <button class="btn" id="sbo">Sign out</button></div>'; el.querySelector('#sbo').onclick = async () => { await c.auth.signOut(); render(); }; return; }
    const rows = must(await c.from('taxi_bookings').select('id,ext_id,vehicle_class,rider_name,rider_phone,pickup_address,dropoff_address,fare_estimate,flat_rate,payment_method,status,assigned_driver_name,scheduled_for,created_at').order('created_at', { ascending: false }).limit(40));
    el.innerHTML = `<div class="card"><b>Server bookings</b> <span class="muted">(${esc(me.display_name || 'dispatcher')})</span> <button class="btn" id="sbo">Sign out</button></div>
      <div class="card invite"><div><b>Invite staff</b><div class="muted">Drivers can only join with an invite. Links work once and expire in 7 days.</div></div><div class="two eq"><button class="btn gold" id="invD">Invite driver</button>${me.taxi_role === 'owner' ? '<button class="btn alt" id="invX">Invite dispatcher</button>' : ''}</div><div id="invOut"></div></div>` + (rows.map(b => `<div class="card assign" data-sb="${b.id}"><div><b>${esc(b.rider_name || 'Guest')}</b>${b.rider_phone ? ' · <a href="tel:' + esc(b.rider_phone) + '">' + esc(b.rider_phone) + '</a>' : ''}<br>${esc(b.pickup_address)} → ${esc(b.dropoff_address)}
      <div class="muted">${money(b.fare_estimate)}${b.flat_rate ? ' flat ' + b.flat_rate : ''} · ${b.vehicle_class === 'suv' ? 'Black SUV' : 'Black Sedan'} · ${PAY[b.payment_method]} · <b data-st="${b.status}">${STATUS[b.status]}</b>${b.assigned_driver_name ? ' · ' + esc(b.assigned_driver_name) : ''}${b.scheduled_for ? ' · ' + new Date(b.scheduled_for).toLocaleString('en-US', { timeZone: 'America/New_York' }) : ''}</div></div>
      <div>${b.status === 'requested' ? '<input data-dn placeholder="Driver name" style="max-width:140px"><button class="btn gold" data-as>Assign</button>' : ''}${['assigned', 'en_route', 'arrived', 'in_progress'].includes(b.status) ? '<button class="btn" data-nx>' + ({ assigned: 'En route', en_route: 'Arrived', arrived: 'Start', in_progress: 'Complete' })[b.status] + '</button><button class="btn" data-dc>Driver cancelled</button>' : ''}</div></div>`).join('') || '<p class="muted">No server bookings yet.</p>');
    el.querySelector('#sbo').onclick = async () => { await c.auth.signOut(); render(); };
    const paintInv = iv => { const out = el.querySelector('#invOut'); if (!out || !iv) return; const role = iv.role;
        out.innerHTML = `<div class="invbox" data-code="${esc(iv.code)}"><p>${role === 'driver' ? 'Driver' : 'Dispatcher'} invite code <b class="code">${esc(iv.code)}</b> · expires ${new Date(iv.expires_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}</p>
          <img id="invQR" alt="Invite QR code" width="160" height="160" style="background:#fff;border-radius:8px"><input readonly id="invLink" value="${esc(iv.link)}"><div class="two eq"><button class="btn" id="invCopy">Copy link</button>${navigator.share ? '<button class="btn alt" id="invShare">Share</button>' : ''}</div></div>`;
        import('https://esm.sh/qrcode@1.5.4').then(q => q.toDataURL(iv.link, { margin: 1, width: 320 })).then(u => { const i = el.querySelector('#invQR'); if (i) i.src = u; }).catch(() => el.querySelector('#invQR')?.remove());
        el.querySelector('#invCopy').onclick = () => navigator.clipboard?.writeText(iv.link).then(() => el.querySelector('#invCopy').textContent = 'Copied');
        el.querySelector('#invShare')?.addEventListener('click', () => navigator.share({ title: 'Join Rocapulco', text: 'Your Rocapulco invite', url: iv.link }).catch(() => {}));
      };
    const showInv = async role => { const out = el.querySelector('#invOut'); out.textContent = 'Creating invite…'; try { keepInv = await createInvite(role); paintInv(keepInv); } catch (e) { out.textContent = e.message; } };
    paintInv(keepInv);
    el.querySelector('#invD').onclick = () => showInv('driver'); el.querySelector('#invX')?.addEventListener('click', () => showInv('dispatcher'));
    const NEXT = { assigned: 'en_route', en_route: 'arrived', arrived: 'in_progress', in_progress: 'completed' };
    el.querySelectorAll('[data-sb]').forEach(card => { const id = card.dataset.sb, b = rows.find(x => x.id === id), up = async patch => { const { error } = await c.from('taxi_bookings').update(patch).eq('id', id); if (error) alert(error.message); render(); };
      card.querySelector('[data-as]')?.addEventListener('click', () => { const n = card.querySelector('[data-dn]').value.trim(); if (!n) return alert('Type the driver name'); up({ status: 'assigned', assigned_driver_name: n }); });
      card.querySelector('[data-nx]')?.addEventListener('click', () => up({ status: NEXT[b.status] })); card.querySelector('[data-dc]')?.addEventListener('click', () => up({ status: 'requested', assigned_driver_name: null })); }); }
  await render(); await c.realtime.setAuth(); const ch = c.channel('taxi-dispatch').on('postgres_changes', { event: '*', schema: 'public', table: 'taxi_bookings' }, () => render()).subscribe(); unsub = () => c.removeChannel(ch);
  c.auth.onAuthStateChange(() => setTimeout(async () => { await c.realtime.setAuth(); render(); }, 0)); }

// ================= Accounts: riders (Google / Apple / email) and invite-only staff =================
export const SITE = new URL('./', import.meta.url).href; // .../rocapulco-supreme-web/
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function validateCreds(email, password) { if (!email) return 'Enter your email address.'; if (!okEmail(email)) return 'That email doesn\'t look right (example: name@gmail.com).';
  if (!password) return 'Enter a password.'; if (password.length < 8) return 'Password must be at least 8 characters.'; return null; }
export const niceErr = e => { const m = e?.message || String(e); return /rate limit/i.test(m) ? 'Too many sign-up emails right now. Please try again in an hour or call dispatch.' : /already registered/i.test(m) ? 'An account with this email already exists. Use Sign in.'
  : /invalid login/i.test(m) ? 'Wrong email or password.' : /not confirmed/i.test(m) ? 'Confirm your email first (check your inbox), then sign in.' : /invite/i.test(m) ? 'That invite code is invalid, expired or already used.' : m; };
let _prov; export async function providers() { if (_prov) return _prov; try { const r = await fetch(SUPABASE.url + '/auth/v1/settings', { headers: { apikey: SUPABASE.anonKey } }); const j = await r.json(); _prov = { google: !!j.external?.google, apple: !!j.external?.apple }; } catch { _prov = { google: false, apple: false }; } return _prov; }
export async function oauth(provider) { const c = await sb(); const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: location.href.split('#')[0].split('?')[0] + location.hash } }); if (error) throw error; }
export async function session() { const c = await sb(); return (await c.auth.getSession()).data.session; }
export async function me() { const c = await sb(), s = await session(); if (!s) return null; const { data } = await c.from('profiles').select('display_name,taxi_role,role').eq('id', s.user.id).maybeSingle();
  return { id: s.user.id, email: s.user.email, name: data?.display_name || s.user.user_metadata?.full_name || s.user.email, taxiRole: data?.taxi_role || 'rider', isAdmin: data?.role === 'admin' }; }
export async function signOut() { const c = await sb(); await c.auth.signOut(); }
export async function emailSignIn(email, password) { const bad = validateCreds(email, password); if (bad) throw new Error(bad); const c = await sb(); const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw new Error(niceErr(error)); return me(); }
export async function emailSignUp(email, password, name, invite = null) { const bad = validateCreds(email, password); if (bad) throw new Error(bad); const c = await sb();
  if (invite) { const { data: r, error: e } = await c.rpc('check_invite', { p_code: invite }); if (e || !r) throw new Error('That invite code is invalid, expired or already used.'); }
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { display_name: name || null, ...(invite ? { invite } : {}) }, emailRedirectTo: location.href.split('#')[0] } });
  if (error) throw new Error(niceErr(error)); return { session: !!data.session, profile: data.session ? await me() : null }; }
export async function redeemInvite(code) { const c = await sb(); const { data, error } = await c.rpc('redeem_invite', { p_code: code }); if (error) throw new Error(niceErr(error)); return data; }
export async function createInvite(role = 'driver', days = 7, note = null) { const c = await sb(); const { data, error } = await c.from('invites').insert({ role, note, expires_at: new Date(Date.now() + days * 864e5).toISOString() }).select('code,role,expires_at').single();
  if (error) throw new Error(/row-level/i.test(error.message) ? 'Only dispatchers can invite drivers, and only the owner can invite dispatchers.' : error.message); return { ...data, link: SITE + (role === 'driver' ? 'driver/' : 'dispatch/') + '?invite=' + data.code }; }
export async function myInvites() { const c = await sb(); return (await c.from('invites').select('code,role,expires_at,used_at,note').order('created_at', { ascending: false }).limit(20)).data || []; }

// Staff gate for the Driver and Dispatch apps. Resolves with the profile once the signed-in user has one of `allowed` taxi roles.
// Server-side, every staff read/write is enforced by RLS on taxi_role; this screen only decides what to show.
export function staffGate(sheet, { app, allowed }) { const T = app === 'driver' ? 'Rocapulco Driver' : 'Rocapulco Dispatch';
  const inv = new URLSearchParams(location.search).get('invite') || '';
  return new Promise(resolve => { let mode = inv ? 'up' : 'in';
    const check = async () => { const m = await me().catch(() => null); if (!m) return draw();
      const code = new URLSearchParams(location.search).get('invite'); if (code && !allowed.includes(m.taxiRole)) { try { await redeemInvite(code); return check(); } catch (e) { return draw(niceErr(e), m); } }
      if (allowed.includes(m.taxiRole)) return resolve(m); draw(null, m); };
    const draw = (msg, m) => { if (m) { sheet.innerHTML = `<div class="brand"><div class="crest">R</div><h1>${T}</h1></div><div class="card" id="noaccess"><b>This app is for invited Rocapulco ${app === 'driver' ? 'drivers' : 'dispatchers'}.</b><p class="muted">You're signed in as ${esc(m.email || m.name)}${m.taxiRole === 'rider' ? ' (rider account)' : ''}. Got an invite code? Enter it below.</p>
          <form id="rdm"><input name="code" required placeholder="Invite code" autocomplete="off" value="${esc(inv)}"><button class="btn gold">Use invite</button></form><p class="fine" id="gm">${esc(msg || '')}</p>
          <a class="btn alt" href="${SITE}" id="toRider">Go to the rider app</a> <button class="btn link" id="gout">Sign out</button></div>`;
        sheet.querySelector('#rdm').onsubmit = async e => { e.preventDefault(); try { await redeemInvite(e.target.code.value); check(); } catch (err) { sheet.querySelector('#gm').textContent = niceErr(err); } };
        sheet.querySelector('#gout').onclick = async () => { await signOut(); draw(); }; return; }
      sheet.innerHTML = `<div class="brand"><div class="crest">R</div><h1>${T}</h1><p class="muted">${app === 'driver' ? 'Driver' : 'Dispatch'} access is by invite only.</p></div>
        <div class="seg"><button id="gin" class="${mode === 'in' ? 'on' : ''}">Sign in</button><button id="gup" class="${mode === 'up' ? 'on' : ''}">I have an invite</button></div>
        <form id="gf" novalidate>${mode === 'up' ? `<input name="code" required placeholder="Invite code" autocomplete="off" value="${esc(inv)}"><input name="name" required placeholder="Full name" autocomplete="name">` : ''}
        <input name="email" type="email" required placeholder="Email" autocomplete="username"><input name="password" type="password" required minlength="8" placeholder="Password (8+ characters)" autocomplete="${mode === 'up' ? 'new' : 'current'}-password">
        <button class="btn gold big" id="ggo">${mode === 'up' ? 'Create staff account' : 'Sign in'}</button></form><p class="fine" id="gm">${esc(msg || '')}</p>
        <p class="fine">Riders: <a href="${SITE}">book a ride here</a>.</p>`;
      sheet.querySelector('#gin').onclick = () => { mode = 'in'; draw(); }; sheet.querySelector('#gup').onclick = () => { mode = 'up'; draw(); };
      sheet.querySelector('#gf').onsubmit = async e => { e.preventDefault(); const f = e.target, gm = sheet.querySelector('#gm'); gm.textContent = 'Working…';
        try { if (mode === 'in') { await emailSignIn(f.email.value.trim(), f.password.value); return check(); }
          const r = await emailSignUp(f.email.value.trim(), f.password.value, f.name.value.trim(), f.code.value.trim()); if (r.session) return check(); gm.textContent = 'Account created. Check your email, tap the confirmation link, then sign in here.'; mode = 'in'; }
        catch (err) { gm.textContent = niceErr(err); } }; };
    check(); }); }

// Rider account card (Google / Apple / email). Guests can still book with just name + phone.
export async function mountRiderAccount(el, onChange = () => {}) { const p = await providers(); const c = await sb();
  const draw = async (msg = '') => { const m = await me().catch(() => null);
    if (m) { el.innerHTML = `<div class="card acct"><div>Signed in as <b>${esc(m.name)}</b><div class="muted">${esc(m.email || '')}</div></div><button class="btn link" id="rout">Sign out</button></div>`; el.querySelector('#rout').onclick = async () => { await signOut(); onChange(null); draw(); }; onChange(m); return; }
    el.innerHTML = `<div class="acct-opts"><button class="btn oauth google" id="og" ${p.google ? '' : 'hidden'}><svg viewBox="0 0 24 24" class="ds-ic" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5z"/><path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.4 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5z"/><path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4z"/><path fill="#EA4335" d="M12 4.6c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3c.9-2.8 3.4-5.2 6.4-5.2z"/></svg>Continue with Google</button>
      <button class="btn oauth apple" id="oa" ${p.apple ? '' : 'hidden'}><svg viewBox="0 0 24 24" class="ds-ic" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8a4.9 4.9 0 0 0-4.1 2.5c-1.8 3-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.2 3-2.5a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.7-4.1zM14 5.2A4.3 4.3 0 0 0 15 2a4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1 3.1A3.7 3.7 0 0 0 14 5.2z"/></svg>Sign in with Apple</button>
      <details class="emailacct"><summary>Use email and password</summary><form id="ref"><input name="email" type="email" placeholder="Email" autocomplete="username"><input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" autocomplete="current-password">
      <div class="two eq"><button class="btn gold" data-a="in">Sign in</button><button class="btn alt" type="button" data-a="up">Create account</button></div></form></details><p class="fine" id="ram">${esc(msg)}</p></div>`;
    el.querySelector('#og').onclick = () => oauth('google').catch(e => draw(niceErr(e))); el.querySelector('#oa').onclick = () => oauth('apple').catch(e => draw(niceErr(e)));
    const f = el.querySelector('#ref'), go = async a => { const ram = el.querySelector('#ram'); ram.textContent = 'Working…'; try { if (a === 'in') { await emailSignIn(f.email.value.trim(), f.password.value); draw(); }
      else { const r = await emailSignUp(f.email.value.trim(), f.password.value, ''); r.session ? draw() : draw('Account created. Check your email to confirm, then sign in.'); } } catch (e) { ram.textContent = niceErr(e); } };
    f.onsubmit = e => { e.preventDefault(); go('in'); }; f.querySelector('[data-a=up]').onclick = () => go('up'); };
  c.auth.onAuthStateChange(e => { if (e === 'SIGNED_IN' || e === 'SIGNED_OUT') setTimeout(() => draw(), 0); }); return draw(); }
// ---- signed relay: staff signing key (one per signed-in staff user on this device) + public key lookup
import { newKeyPair, importPriv } from './sign.js';
export async function staffSigner() { const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user?.id; if (!uid) throw new Error('not signed in');
  const LS = 'roca_staff_key_' + uid; let st = null; try { st = JSON.parse(localStorage.getItem(LS)); } catch {}
  if (st?.kid && (await staffKey(st.kid))) return { kid: st.kid, priv: await importPriv(st.priv) };
  const k = await newKeyPair(); const kid = must(await c.rpc('register_staff_key', { p_pub: k.pub }));
  localStorage.setItem(LS, JSON.stringify({ kid, priv: k.privJwk })); keyCache.delete(kid); return { kid, priv: k.priv }; }
const keyCache = new Map();
export async function staffKey(kid) { if (!/^[0-9a-f-]{36}$/i.test(kid || '')) return null; const hit = keyCache.get(kid); if (hit && Date.now() - hit.t < 300e3) return hit.v;
  const c = await sb(); const { data, error } = await c.rpc('staff_key', { p_kid: kid }); if (error) return null; const v = data?.[0] || null; keyCache.set(kid, { t: Date.now(), v }); return v; }
export async function verifyBooking(extId) { const c = await sb(); const { data, error } = await c.rpc('verify_booking', { p_ext: extId }); if (error) throw new Error(error.message); return data?.[0] || null; }
// ---- compliance: driver documents, go-online gate, ride records, complaints
export async function myDocs() { const c = await sb(); const { data } = await c.auth.getSession(); if (!data.session) return null; return must(await c.from('taxi_driver_docs').select('*').eq('user_id', data.session.user.id).maybeSingle()); }
export async function saveDocs(p) { const c = await sb(); return must(await c.rpc('save_driver_docs', { p })); }
export async function driverReady() { const c = await sb(); return must(await c.rpc('driver_ready'))[0]; }
export async function rideEvent(ext, type, data = {}) { const c = await sb(); return must(await c.rpc('ride_event', { p_ext: ext, p_type: type, p_data: data })); }
const cardCache = new Map();
export async function driverCard(kid) { if (!/^[0-9a-f-]{36}$/i.test(kid || '')) return null; if (cardCache.has(kid)) return cardCache.get(kid); const c = await sb(); const v = must(await c.rpc('driver_card', { p_kid: kid }))[0] || null; cardCache.set(kid, v); return v; }
export async function fileComplaint(extId, reason, details, driver, plate) { const k = ref(extId); if (!k) throw new Error('no server booking for this ride'); const c = await sb(); return must(await c.rpc('file_complaint', { p_id: k.id, p_token: k.token, p_reason: reason, p_details: details, p_driver: driver, p_plate: plate })); }
export async function listDocs() { const c = await sb(); return must(await c.from('taxi_driver_docs').select('*').order('updated_at', { ascending: false }).limit(50)); }
export async function reviewDriver(user, status, note, handleOk) { const c = await sb(); return must(await c.rpc('review_driver', { p_user: user, p_status: status, p_note: note || null, p_handle_ok: handleOk })); }
export async function riderContact(ext) { const c = await sb(); return must(await c.rpc('rider_contact', { p_ext: ext }))[0] || null; }

// ---- Dispatch quick-review: applicants (public apply form) + drivers' document updates ----
const DOCN = { license: 'DMV license', tlc: 'TLC license', insurance: 'Insurance', registration: 'Registration' };
export async function listApplications() { const c = await sb(); return must(await c.from('taxi_applications').select('id,name,phone,email,area,lang,has_tlc,tlc_license,vehicle,fhv_plate,wav,status,review_note,needs,invite_code,updated_at').in('status', ['submitted', 'needs_doc', 'approved']).order('updated_at', { ascending: false }).limit(30)); }
export async function applicationDocs(id) { const c = await sb(); return must(await c.from('taxi_application_docs').select('kind,photo,sharpness,blurry,expires').eq('app_id', id)); }
export async function reviewApplication(id, status, note, needs) { const c = await sb(); return must(await c.rpc('apply_review', { p_id: id, p_status: status, p_note: note || null, p_needs: needs || null })); }
export async function mountReview(el) {
  const day = d => d ? new Date(d + 'T12:00:00') : null, expChip = d => { const x = day(d); if (!x) return '<span class="dchip bad">no expiry date</span>'; const days = Math.round((x - Date.now()) / 864e5);
    return `<span class="dchip ${days < 0 ? 'bad' : days < 30 ? 'warn' : 'ok'}">${days < 0 ? 'expired' : 'exp'} ${esc(d)}</span>`; };
  async function draw() {
    let apps = [], docs = []; try { [apps, docs] = await Promise.all([listApplications(), listDocs()]); } catch (e) { el.innerHTML = `<p class="muted">Review list unavailable: ${esc(e.message)}</p>`; return; }
    const pend = docs.filter(d => d.review_status === 'pending' || d.review_status === 'needs_doc');
    const open = apps.filter(a => a.status !== 'approved'), done = apps.filter(a => a.status === 'approved').slice(0, 5);
    el.innerHTML = (open.length || pend.length ? '' : '<p class="muted">Nothing to review. New applicants from the careers page show up here.</p>') +
      open.map(a => `<div class="card rev" data-app="${esc(a.id)}"><div class="qrow"><div class="grow"><b>${esc(a.name || 'Applicant')}</b> <span class="ds-badge ${a.status === 'needs_doc' ? 'up' : 'flat'}">${a.status === 'needs_doc' ? 'waiting on docs' : 'new applicant'}</span>
        <div class="muted">${esc(a.area || '')} · ${a.has_tlc ? 'TLC #' + esc(a.tlc_license || '—') : 'no TLC license yet'} · ${esc(a.vehicle || 'vehicle —')} ${a.fhv_plate ? '· plate ' + esc(a.fhv_plate) : ''}${a.wav ? ' · WAV' : ''}${a.lang === 'es' ? ' · habla español' : ''}</div>
        ${a.phone ? `<a class="btn sm" href="tel:${esc(a.phone)}">Call ${esc(a.phone)}</a>` : ''}</div></div><div class="appdocs muted">Loading documents…</div>
        <div class="revb"><button class="btn sm" data-act="approve">Approve</button><button class="btn sm" data-act="ask">Request a document</button><button class="btn sm ghost" data-act="decline">Decline</button></div><div class="revx"></div></div>`).join('') +
      pend.map(d => `<div class="card rev" data-drv="${esc(d.user_id)}"><div><b>Driver documents</b> <span class="ds-badge up">${esc(d.review_status)}</span><div class="muted">TLC #${esc(d.tlc_driver_license || '—')} · vehicle ${esc(d.tlc_vehicle_license || '—')} · plate ${esc(d.plate || '—')}${d.wav ? ' · WAV' : ''}</div>
        <div>${['dmv_exp', 'tlc_exp', 'reg_exp', 'ins_exp'].map(k => `<small>${k.slice(0, 3).toUpperCase()}</small> ${expChip(d[k])}`).join(' ')}</div>${d.pay_handle ? `<label class="row"><input type="checkbox" class="hok" ${d.handle_verified ? 'checked' : ''}> ${esc(d.pay_kind)} handle <b>${esc(d.pay_handle)}</b> checked by phone</label>` : ''}</div>
        <div class="revb"><button class="btn sm" data-act="approve">Approve</button><button class="btn sm" data-act="ask">Request a document</button><button class="btn sm ghost" data-act="decline">Decline</button></div><div class="revx"></div></div>`).join('') +
      (done.length ? '<div class="lbl">Recently approved — send them their invite link</div>' + done.map(a => { const link = new URL('driver/?invite=' + a.invite_code, new URL('./', import.meta.url)).href;
        return `<div class="card hist"><div><b>${esc(a.name)}</b><div class="muted ell">${esc(link)}</div></div><span><button class="btn sm" data-copy="${esc(link)}">Copy link</button>${a.phone ? ` <a class="btn sm" href="sms:${esc(a.phone)}?&body=${encodeURIComponent('Rocapulco: you are approved to drive. Open this link to set up the driver app: ' + link)}">Text it</a>` : ''}</span></div>`; }).join('') : '');
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; }));
    el.querySelectorAll('[data-app]').forEach(async card => { const id = card.dataset.app; const box = card.querySelector('.appdocs');
      try { const ds = await applicationDocs(id); const have = Object.fromEntries(ds.map(d => [d.kind, d]));
        box.innerHTML = Object.keys(DOCN).map(k => { const d = have[k]; return d ? `<a href="${esc(d.photo)}" target="_blank" class="adoc"><img alt="${DOCN[k]}" src="${esc(d.photo)}"><span>${DOCN[k]}</span>${d.blurry ? '<span class="dchip warn">blurry</span>' : ''}${expChip(d.expires)}</a>` : `<span class="adoc miss"><span>${DOCN[k]}</span><span class="dchip bad">missing</span></span>`; }).join('');
      } catch (e) { box.textContent = 'Documents unavailable: ' + e.message; } });
    el.querySelectorAll('.rev').forEach(card => card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(card, b.dataset.act)));
  }
  function act(card, what) {
    const x = card.querySelector('.revx'), isApp = !!card.dataset.app;
    const run = async (status, note, needs) => { x.textContent = 'Saving…';
      try { if (isApp) { await reviewApplication(card.dataset.app, status, note, needs); } else await reviewDriver(card.dataset.drv, status, note, card.querySelector('.hok')?.checked ?? null); await draw(); }
      catch (e) { x.innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
    if (what === 'approve') return run('approved', null);
    if (what === 'decline') { x.innerHTML = `<input class="rnote" placeholder="Reason (the applicant sees this)" maxlength="300"><button class="btn sm" data-go>Decline</button>`; x.querySelector('[data-go]').onclick = () => run('declined', x.querySelector('.rnote').value); return; }
    x.innerHTML = `<div class="row">${Object.entries(DOCN).map(([k, n]) => `<label><input type="checkbox" value="${k}"> ${n}</label>`).join(' ')}</div><div class="pop rsn">${['Photo is blurry', 'Document expired', 'Wrong document', 'Name doesn’t match', 'Corner cut off'].map(r => `<button type="button" class="ds-chip" data-rsn="${r}">${r}</button>`).join('')}</div><input class="rnote" placeholder="What to fix, e.g. photo is blurry" maxlength="300"><button class="btn sm" data-go>Send request</button>`;
    x.querySelectorAll('[data-rsn]').forEach(b => b.onclick = () => { const n = x.querySelector('.rnote'); n.value = n.value ? n.value + '; ' + b.dataset.rsn : b.dataset.rsn; });
    x.querySelector('[data-go]').onclick = () => { const needs = [...x.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value); const note = x.querySelector('.rnote').value;
      if (!needs.length && !note.trim()) { x.querySelector('.rnote').placeholder = 'Pick a document or write a note'; return; } run('needs_doc', note || ('Please re-upload: ' + needs.map(k => DOCN[k]).join(', ')), needs); };
  }
  await draw(); return draw;
}
