// Owner home + guided tour (shown the first time the owner signs in; replay from "Owner guide").
// Display only: every owner power (dispatcher invites, TLC override, reports) is enforced server-side by RLS/RPC checks.
import { myInvites, signOutEverywhere, passkeyUI } from './cloud.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DONE = 'roc_owner_tour_v1';
export const STEPS = [
  { sel: '#ownr', t: 'Welcome, this is your app', b: 'You are the owner. This page is your home base. You can see everything here: rides, drivers and reports. Tap Next to see each part.' },
  { sel: '#qtabs', t: 'New rides', b: 'Ride requests come in here. "New" means no driver yet. "Assigned" means a driver said yes. "On trip" means the rider is in the car.' },
  { sel: '#phb', t: 'Book a ride for a caller', b: 'When someone calls on the phone, type their name, phone, pickup and drop-off here. The price is shown before you book.' },
  { sel: '#dfresh', t: 'Your drivers', b: 'These are drivers who are online now. Green means we just heard from them. Tap a driver to give them a ride.' },
  { sel: '#tl', t: 'Live trips', b: 'Every trip that is happening now shows here, with where it is going and its status.' },
  { sel: '#invD', t: 'Invite a driver', b: 'Tap "Invite driver" to make a code. Send the link or show the QR code. Each code works one time and ends in 7 days.' },
  { sel: '#invX', t: 'Invite a dispatcher', b: 'Only you, the owner, can invite dispatchers. Dispatchers help you take calls and send rides.' },
  { sel: '#rev', t: 'Approve drivers', b: 'New drivers send their papers here: license, car papers and insurance. Look them over, then tap Approve or ask for a missing paper.' },
  { sel: '#tlco', t: 'TLC records check', b: 'A driver can only take rides if the city TLC records match. If the records are wrong but you know the driver is fine, only you can use "Owner override". You must write why. You can stop it any time.' },
  { sel: '#ownRates', t: 'Your prices', b: 'This is the one price list we filed with the TLC. Riders see it before they book, and the price they are told is the price they pay. Tolls are added at cost.' },
  { sel: '#tlcr', t: 'Trip records and the TLC report', b: 'The app saves every trip for 19 months. Each month, download the TLC file here and upload it to TLC UP. If no cars went out, file "No Vehicles Dispatched". It is due by the end of the next month.' },
  { sel: '#ownRcpt', t: 'Receipts', b: 'After each ride the rider gets a receipt with the price, the base number, the driver and the car license numbers. You do not have to do anything.' },
  { sel: '#hcall', t: 'Safety tools', b: 'Riders can share their trip, see the driver photo and car, and call 911 or dispatch. Drivers must pass the checks before they can go online.' },
  { sel: '#ownSet', t: 'Settings and safety for your account', b: 'Add a passkey (Face ID) so signing in is fast and safe. If you lose your phone, tap "Sign out everywhere" to kick out every device.' },
  { sel: '#ownGuide', t: 'You are done!', b: 'Tap "Owner guide" any time to see this again, or open the printable guide.' }];
export function tour(i = 0) {
  document.querySelector('#otour')?.remove(); if (i >= STEPS.length) { localStorage.setItem(DONE, '1'); return; }
  const s = STEPS[i], el = document.querySelector(s.sel); el?.scrollIntoView({ block: 'center', behavior: 'instant' });
  const o = document.createElement('div'); o.id = 'otour'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', s.t);
  const r = el?.getBoundingClientRect(); const hi = r && r.width ? `<div class="ot-hi" style="top:${r.top - 6}px;left:${r.left - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>` : '<div class="ot-dim"></div>';
  o.innerHTML = `${hi}<div class="ot-box"><small>Step ${i + 1} of ${STEPS.length}</small><h3>${esc(s.t)}</h3><p>${esc(s.b)}</p><div class="ot-btn"><button class="btn link" data-x>Skip</button>${i ? '<button class="btn" data-p>Back</button>' : ''}<button class="btn gold" data-n>${i === STEPS.length - 1 ? 'Finish' : 'Next'}</button></div></div>`;
  document.body.append(o); o.querySelector('[data-n]').focus();
  o.querySelector('[data-n]').onclick = () => tour(i + 1); o.querySelector('[data-p]')?.addEventListener('click', () => tour(i - 1));
  o.querySelector('[data-x]').onclick = () => { localStorage.setItem(DONE, '1'); o.remove(); };
  o.onkeydown = e => { if (e.key === 'Escape') o.querySelector('[data-x]').click(); };
}
export async function mountOwner(el, m) {
  if (m?.taxiRole !== 'owner') { el.innerHTML = ''; return; }
  const inv = await myInvites().catch(() => []);
  el.innerHTML = `<div class="card owner"><b>Owner · ${esc(m.name || '')}</b><div class="muted">You run Rocapulco Supreme (TLC base B00639).</div>
    <div class="two eq"><button class="btn gold" id="ownGuide">Owner guide</button><a class="btn alt" href="../owner-guide/" target="_blank" rel="noopener">Printable guide</a></div>
    <p class="fine"><a id="ownRates" href="../rates.html" target="_blank" rel="noopener">Rate schedule</a> · <span id="ownRcpt">Receipts go to riders automatically</span></p>
    <details><summary>Invite codes (${inv.length})</summary>${inv.map(x => `<div class="fine">${esc(x.role)} · ${esc(x.code)} · ${x.used_at ? 'used' : new Date(x.expires_at) < new Date() ? 'expired' : 'open until ' + new Date(x.expires_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}</div>`).join('') || '<p class="fine">None yet. Use "Invite driver" below.</p>'}</details>
    <div id="ownSet" class="fine">Settings: <span id="ownPk"></span> <button class="btn sm ghost" id="ownAll">Sign out everywhere</button></div></div>`;
  passkeyUI(el.querySelector('#ownPk'), 'Rocapulco').catch(() => {});
  el.querySelector('#ownGuide').onclick = () => tour(0);
  el.querySelector('#ownAll').onclick = async () => { if (!confirm('Sign out on every phone and computer?')) return; await signOutEverywhere(); location.reload(); };
  if (!localStorage.getItem(DONE)) setTimeout(() => tour(0), 1500);
}
