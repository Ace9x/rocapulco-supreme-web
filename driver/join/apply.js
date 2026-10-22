// Driver application: 3 steps, progress saved on this device and on the server (apply_save). No account needed; a private token proves it's you.
import { SUPABASE } from '../../cloud.js';
const KEY = 'qc_driver_app';
const lang = new URLSearchParams(location.search).get('lang') === 'es' || (localStorage.getItem('qc_lang') === 'es' && !location.search.includes('lang=en')) ? 'es' : 'en';
document.documentElement.lang = lang;
const L = {
  en: { t: 'Apply to drive', s: ['About you', 'License & vehicle', 'Documents'], name: 'Full name', phone: 'Mobile phone', email: 'Email (optional)', area: 'Where do you usually drive?',
    hastlc: 'I have a TLC Driver License', tlc: 'TLC Driver License #', veh: 'Vehicle (year, make, model)', plate: 'TLC / FHV plate', wav: 'Wheelchair-accessible vehicle (ramp or lift)',
    next: 'Save & continue', back: 'Back', submit: 'Submit application', saved: 'Saved', exp: 'Expires', take: 'Take or choose photo', retake: 'Retake photo',
    docs: { license: 'NY DMV driver license', tlc: 'TLC Driver License', insurance: 'Insurance card / certificate', registration: 'Vehicle registration' },
    blurry: 'This photo looks blurry — hold steady in good light and retake. You can still send it, but dispatch may ask again.', sharp: 'Photo is clear', up: 'Uploading…',
    need: 'Name and mobile phone are required.', st: { submitted: 'Application received. Dispatch will call you, usually within 2 business days.', needs_doc: 'Dispatch asked for:', approved: 'Approved! Open your private invite link:', declined: 'Thanks for applying. We can’t offer a spot right now.', draft: '' },
    status: 'Your application', check: 'Check status', fix: 'Upload the requested documents below, then press Submit again.', other: 'Other' },
  es: { t: 'Solicitud de chofer', s: ['Tus datos', 'Licencia y vehículo', 'Documentos'], name: 'Nombre completo', phone: 'Teléfono móvil', email: 'Correo (opcional)', area: '¿Dónde manejas normalmente?',
    hastlc: 'Tengo Licencia de Chofer TLC', tlc: 'Nº de Licencia TLC', veh: 'Vehículo (año, marca, modelo)', plate: 'Placa TLC / FHV', wav: 'Vehículo accesible para silla de ruedas (rampa o elevador)',
    next: 'Guardar y seguir', back: 'Atrás', submit: 'Enviar solicitud', saved: 'Guardado', exp: 'Vence', take: 'Tomar o elegir foto', retake: 'Tomar otra foto',
    docs: { license: 'Licencia de conducir NY (DMV)', tlc: 'Licencia de Chofer TLC', insurance: 'Tarjeta / certificado de seguro', registration: 'Registro del vehículo' },
    blurry: 'La foto se ve borrosa: sostén firme con buena luz y tómala otra vez. Puedes enviarla, pero despacho podría pedirla de nuevo.', sharp: 'Foto clara', up: 'Subiendo…',
    need: 'Nombre y teléfono móvil son obligatorios.', st: { submitted: 'Solicitud recibida. Despacho te llamará, normalmente en 2 días hábiles.', needs_doc: 'Despacho pidió:', approved: '¡Aprobado! Abre tu enlace privado de invitación:', declined: 'Gracias por solicitar. Ahora no tenemos un lugar disponible.', draft: '' },
    status: 'Tu solicitud', check: 'Ver estado', fix: 'Sube los documentos pedidos abajo y presiona Enviar otra vez.', other: 'Otro' } }[lang];
const AREAS = ['Queens', 'Brooklyn', 'Manhattan', 'Bronx', 'Staten Island', 'Nassau', 'Suffolk'];
const KINDS = ['license', 'tlc', 'insurance', 'registration'];
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let st = JSON.parse(localStorage.getItem(KEY) || 'null') || { step: 1, f: {}, docs: {} };
const keep = () => localStorage.setItem(KEY, JSON.stringify(st));
async function rpc(fn, args) {
  const r = await fetch(SUPABASE.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && j.message) || 'Network error — your answers are saved on this device; try again.'); return j;
}
async function save(extra = {}) {
  const r = await rpc('apply_save', { p_id: st.id || null, p_token: st.token || null, p: { ...st.f, lang, step: st.step, ...extra } });
  const row = Array.isArray(r) ? r[0] : r; st.id = row.id; st.token = row.token; st.status = row.status; keep(); return row;
}
// variance of the Laplacian on a 480px grayscale copy: low = blurry
export function sharpness(data, w, h) {
  const g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let n = 0, s = 0, s2 = 0; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; s += v; s2 += v * v; n++; }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
async function prep(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas'), k = Math.min(1, 480 / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
  const sh = sharpness(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  const o = document.createElement('canvas'), k2 = Math.min(1, 1280 / Math.max(img.width, img.height)); o.width = Math.round(img.width * k2); o.height = Math.round(img.height * k2); o.getContext('2d').drawImage(img, 0, 0, o.width, o.height);
  let q = 0.75, url = o.toDataURL('image/jpeg', q); while (url.length > 550000 && q > 0.3) { q -= 0.15; url = o.toDataURL('image/jpeg', q); }
  return { url, sharpness: Math.round(sh) };
}
const bar = () => `<div class="steps" aria-label="Step ${st.step} of 3">${[1, 2, 3].map(i => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('')}</div><p class="v">${st.step}/3 · ${L.s[st.step - 1]}</p>`;
const inp = (id, label, type = 'text', extra = '') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(st.f[id] || '')}" ${extra}>`;
function statusBox() {
  if (!st.status || st.status === 'draft') return '';
  let x = `<div class="doc" id="apst"><b>${L.status}:</b> <span>${L.st[st.status] || st.status}</span>`;
  if (st.status === 'needs_doc') x += ` <b>${(st.needs || []).map(k => L.docs[k] || k).join(', ')}</b>${st.note ? `<p>“${esc(st.note)}”</p>` : ''}<p>${L.fix}</p>`;
  if (st.status === 'approved' && st.invite) { const link = new URL('../?invite=' + st.invite, location.href).href; x += `<p><a id="invlink" href="${esc(link)}">${esc(link)}</a></p>`; }
  if (st.note && st.status !== 'needs_doc') x += `<p>“${esc(st.note)}”</p>`;
  return x + `<button id="chk" type="button">${L.check}</button></div>`;
}
function render(msg = '') {
  const a = $('#app'); let body = '';
  if (st.step === 1) body = inp('name', L.name, 'text', 'autocomplete="name" required') + inp('phone', L.phone, 'tel', 'autocomplete="tel" required') + inp('email', L.email, 'email', 'autocomplete="email"') +
    `<label for="area">${L.area}</label><select id="area">${AREAS.map(x => `<option ${st.f.area === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  if (st.step === 2) body = `<label class="row"><input id="has_tlc" type="checkbox" ${st.f.has_tlc ? 'checked' : ''}> ${L.hastlc}</label>` + inp('tlc_license', L.tlc, 'text', 'inputmode="numeric" maxlength="20"') +
    inp('vehicle', L.veh, 'text', 'maxlength="80" placeholder="2021 Toyota Camry"') + inp('fhv_plate', L.plate, 'text', 'maxlength="12" placeholder="T123456C"') + `<label class="row"><input id="wav" type="checkbox" ${st.f.wav ? 'checked' : ''}> ${L.wav}</label>`;
  if (st.step === 3) body = KINDS.map(k => { const d = st.docs[k] || {}; return `<div class="doc" data-doc="${k}"><b>${L.docs[k]}</b>
    <label for="f-${k}">${d.ok ? L.retake : L.take}</label><input id="f-${k}" type="file" accept="image/*" capture="environment">
    <label for="e-${k}">${L.exp}</label><input id="e-${k}" type="date" value="${esc(d.expires || '')}">
    <div class="msg" id="m-${k}">${d.ok ? (d.blurry ? `<span class="warn">${L.blurry}</span>` : `<span class="ok">✓ ${L.sharp}</span>`) : ''}</div>${d.thumb ? `<img alt="" src="${d.thumb}">` : ''}</div>`; }).join('');
  a.innerHTML = `<h1>${L.t}</h1>${statusBox()}${bar()}<form id="f" novalidate>${body}<div class="btns">${st.step > 1 ? `<button type="button" id="back">${L.back}</button>` : ''}<button class="cta" id="next">${st.step < 3 ? L.next : L.submit}</button></div><div class="msg" id="msg" role="status">${msg}</div></form>`;
  $('#back') && ($('#back').onclick = () => { collect(); st.step--; keep(); render(); });
  $('#chk') && ($('#chk').onclick = refresh);
  if (st.step === 3) KINDS.forEach(k => {
    $('#e-' + k).onchange = e => { st.docs[k] = { ...(st.docs[k] || {}), expires: e.target.value }; keep(); if (st.docs[k].url) upload(k); };
    $('#f-' + k).onchange = async e => { const file = e.target.files[0]; if (!file) return; $('#m-' + k).textContent = L.up;
      try { const p = await prep(file); const t = document.createElement('canvas'); st.docs[k] = { ...(st.docs[k] || {}), url: p.url, sharpness: p.sharpness, blurry: p.sharpness < 60 }; await upload(k);
        st.docs[k].thumb = p.url.length < 120000 ? p.url : null; delete st.docs[k].url; keep(); render(); } catch (er) { $('#m-' + k).innerHTML = `<span class="err">${esc(er.message)}</span>`; } };
  });
  $('#f').onsubmit = async e => { e.preventDefault(); collect();
    if (st.step === 1 && (!st.f.name?.trim() || (st.f.phone || '').replace(/\D/g, '').length < 10)) return render(`<span class="err">${L.need}</span>`);
    try { if (st.step < 3) { await save(); st.step++; keep(); render(`<span class="ok">✓ ${L.saved}</span>`); } else { await save({ submit: true }); await refresh(); } }
    catch (er) { render(`<span class="err">${esc(er.message)}</span>`); } };
}
async function upload(k) { if (!st.id) await save(); const d = st.docs[k]; if (!d.url) return; await rpc('apply_doc', { p_id: st.id, p_token: st.token, p_kind: k, p_photo: d.url, p_sharpness: d.sharpness, p_expires: d.expires || null }); d.ok = true; }
function collect() { document.querySelectorAll('#f input:not([type=file]):not([type=date]), #f select').forEach(i => { st.f[i.id] = i.type === 'checkbox' ? i.checked : i.value; }); keep(); }
async function refresh() {
  if (!st.id) return render();
  try { const r = await rpc('apply_get', { p_id: st.id, p_token: st.token }); const row = Array.isArray(r) ? r[0] : r; if (!row) return render();
    Object.assign(st, { status: row.status, needs: row.needs, note: row.review_note, invite: row.invite_code }); keep(); render(); } catch (er) { render(`<span class="err">${esc(er.message)}</span>`); }
}
render(); refresh();
