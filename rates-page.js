import { RATE_SCHEDULE, ratesFor, TLC_BASE, CLASS_LABEL } from './fare.js';
const m = (n) => '$' + n.toFixed(2), $ = (s) => document.querySelector(s);
const row = (k) => { const r = ratesFor(k); return `<tr><th scope="row">${CLASS_LABEL[k]}</th><td>${m(r.base)}</td><td>${m(r.perMile)}</td><td>${m(r.perMinute)}</td><td>${m(r.minimum)}</td><td>${m(r.jfk)}</td><td>${m(r.laguardia)}</td></tr>`; };
$('#rates').innerHTML = `<table class="rt"><caption>Rate schedule v${RATE_SCHEDULE.version}, effective ${RATE_SCHEDULE.effectiveFrom}</caption><thead><tr><th>Vehicle</th><th>Base fare</th><th>Per mile</th><th>Per minute</th><th>Minimum</th><th>To JFK (flat)</th><th>To LaGuardia (flat)</th></tr></thead><tbody>${row('sedan')}${row('suv')}</tbody></table>
<p>Metered fare = base + miles × per-mile + minutes × per-minute, never less than the minimum. Trips <b>to</b> JFK or LaGuardia are one flat price. Miles and minutes come from the planned route when you book, and that quote is what you pay.</p>`;
$('#tolls').textContent = RATE_SCHEDULE.tollsNote + '.';
$('#base').textContent = TLC_BASE;
$('#ver').textContent = `Rate schedule version ${RATE_SCHEDULE.version} · effective ${RATE_SCHEDULE.effectiveFrom}`;
