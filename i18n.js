// Spanish for the rider app. Translates rendered text (exact strings + a few patterns) so every screen stays in one code path.
// Staff apps stay English. Toggle stored per device.
const ES = {
  'Book a ride': 'Pedir un viaje', 'Fares': 'Tarifas', 'Where to?': '¿A dónde vamos?', 'Request ride': 'Pedir viaje', 'Schedule ride': 'Programar viaje', 'Now': 'Ahora', 'Schedule': 'Programar',
  'Wallet': 'Billetera', 'History': 'Historial', 'Back': 'Atrás', 'Done': 'Listo', 'Cancel': 'Cancelar', 'Continue': 'Continuar', 'Next': 'Siguiente', 'Skip': 'Saltar', 'Get started': 'Empezar',
  'Home': 'Casa', 'Work': 'Trabajo', 'Set Home': 'Guardar casa', 'Set Work': 'Guardar trabajo', 'Black Sedan': 'Sedán negro', 'Black SUV': 'SUV negra',
  "Flat — won't change": 'Precio fijo — no cambia', 'Upfront — locked when you book': 'Precio por adelantado — fijo al reservar', 'Checking cars…': 'Buscando autos…',
  'Popular pickups near you': 'Recogidas populares cerca', 'Popular destinations': 'Destinos populares', 'Airports': 'Aeropuertos', 'Landmarks': 'Lugares conocidos', 'Recent trips': 'Viajes recientes',
  'Pay driver with': 'Pagar al conductor con', 'Cash': 'Efectivo', 'Card': 'Tarjeta', 'Ride options': 'Opciones del viaje', 'Share trip': 'Compartir viaje', 'Call driver': 'Llamar al conductor',
  'Message': 'Mensaje', 'Edit drop-off': 'Cambiar destino', 'Safety · call 911': 'Seguridad · llamar al 911', 'Call dispatch': 'Llamar a despacho', 'Cancel ride': 'Cancelar viaje',
  'Driver is on the way': 'El conductor va en camino', 'Your driver has arrived': 'Tu conductor llegó', "You've arrived": 'Llegaste', 'Rate your ride': 'Califica tu viaje',
  'Report a problem': 'Reportar un problema', 'Download receipt': 'Descargar recibo', 'Share receipt': 'Compartir recibo', 'Receipt': 'Recibo', 'Your trips': 'Tus viajes',
  'Finding your driver…': 'Buscando tu conductor…', 'Contacting nearby chauffeurs…': 'Contactando choferes cercanos…', 'Cancel (free)': 'Cancelar (gratis)', 'away': 'de distancia',
  'Your rider account': 'Tu cuenta', 'Full name': 'Nombre completo', 'Phone': 'Teléfono', 'Departures': 'Salidas', 'Arrivals': 'Llegadas', 'Send to dispatch': 'Enviar a despacho',
  'Fare breakdown — no hidden fees': 'Desglose de tarifa — sin cargos ocultos', 'Total you pay': 'Total a pagar', 'Base fare': 'Tarifa base', 'Minimum fare adjustment': 'Ajuste de tarifa mínima',
  'Calculating route…': 'Calculando ruta…', 'Cross street': 'Calle transversal', 'Which side / entrance': 'Lado / entrada',
};
const PAT = [
  [/^Hi (.+)$/, 'Hola $1'], [/^(\d+) min away$/, 'a $1 min'], [/^(\d+) min$/, '$1 min'], [/^Pay (\$[\d.]+) once — locked price$/, 'Paga $1 una sola vez — precio fijo'],
  [/^Paid (\w+) to your driver at drop-off\. Never pay twice, never pay extra in cash\.$/, 'Pago a tu conductor al llegar. Nunca pagues dos veces ni extra en efectivo.'],
  [/^I need a wheelchair-accessible vehicle \(ramp or lift\)$/, 'Necesito un vehículo accesible para silla de ruedas (rampa o elevador)'],
  [/^Your ride PIN$/, 'Tu PIN del viaje'], [/^Tell it to your driver before you get in\. The trip can't start without it\.$/, 'Díselo a tu conductor antes de subir. El viaje no empieza sin él.'],
  [/^ No surge, ever$/, ' Sin tarifa dinámica, nunca'], [/^Black-car luxury for Far Rockaway & all of NYC\. Real human dispatch, upfront fares, $/, 'Autos negros de lujo en Far Rockaway y toda NYC. Despacho con personas reales, tarifas por adelantado, '],
  [/^no surge, ever\.$/, 'sin tarifa dinámica, nunca.'], [/^ flat · LGA $/, ' fijo · LGA '], [/^I agree to the $/, 'Acepto los '], [/^Terms & fare policy$/, 'Términos y política de tarifas'], [/^Privacy policy$/, 'Política de privacidad'], [/^ and $/, ' y '],
];
export const lang = () => localStorage.getItem('qc_lang') === '"es"' ? 'es' : 'en';
const tr = (t) => { const k = t.trim(); if (!k) return t; if (ES[k]) return t.replace(k, ES[k]); for (const [re, to] of PAT) if (re.test(t)) return t.replace(re, to); return t; };
function walk(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  root.querySelectorAll?.('[placeholder],[aria-label]').forEach(e => { for (const a of ['placeholder', 'aria-label']) { const v = e.getAttribute(a); if (v && tr(v) !== v) e.setAttribute(a, tr(v)); } });
}
export function initI18n(targets) {
  document.documentElement.lang = lang();
  if (lang() !== 'es') return;
  const run = () => targets.forEach(t => t && walk(t)); run();
  const mo = new MutationObserver(() => { mo.disconnect(); run(); targets.forEach(t => t && mo.observe(t, { childList: true, subtree: true, characterData: true })); });
  targets.forEach(t => t && mo.observe(t, { childList: true, subtree: true, characterData: true }));
}
export function setLang(l) { localStorage.setItem('qc_lang', JSON.stringify(l)); location.reload(); }
