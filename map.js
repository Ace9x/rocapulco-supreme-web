// Rocapulco map engine: MapLibre GL (vector, retina, tilt) behind a tiny Leaflet-style API so app.js stays unchanged.
(function () {
  const STYLE = 'https://tiles.openfreemap.org/styles/dark';
  const GOLD = '#D4AF37';
  const R = Math.PI / 180;
  const toLL = (p) => Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng };
  const dist = (a, b) => { const dLat = (b.lat - a.lat) * R, dLng = (b.lng - a.lng) * R; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
  const bearing = (a, b) => { const y = Math.sin((b.lng - a.lng) * R) * Math.cos(b.lat * R), x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lng - a.lng) * R); return (Math.atan2(y, x) / R + 360) % 360; };
  const mkLL = (o) => ({ lat: o.lat, lng: o.lng, distanceTo: (t) => dist(o, toLL(t)) });
  const bbox = (pts) => { const b = new maplibregl.LngLatBounds(); pts.map(toLL).forEach(p => b.extend([p.lng, p.lat])); return b; };
  let uidN = 0;

  // Original top-down black luxury sedan (gold trim), drawn pointing north.
  const ART = new URL('art/', document.currentScript?.src || location.href).href;
  const CAR = (sim) => `<img src="${ART}rocapulco-car-marker.svg" width="40" height="40" alt="" draggable="false"${sim ? ' style="opacity:.75"' : ''}>`;

  class Marker {
    constructor(latlng, o = {}) { this.ll = toLL(latlng); this.o = o; this.h = {}; this.head = 0; }
    _el() {
      const ic = this.o.icon || { html: '', className: '' }; const el = document.createElement('div');
      let html = ic.html, cls = ic.className || '';
      if (html === '🚘') { html = CAR(/sim/.test(cls)); cls += ' car'; }
      if (/pin/.test(cls)) html = `<span class="pulse"></span>${html}`;
      el.className = 'mk ' + cls; el.innerHTML = `<div class="rot">${html}</div>`; el.style.zIndex = this.o.zIndexOffset ? 2 : 1;
      if (this.tip) el.title = this.tip; return el;
    }
    addTo(g) { const m = g instanceof Group ? g.map : g; if (g instanceof Group) g.add(this); this._map = m;
      this.el = this._el(); this.mm = new maplibregl.Marker({ element: this.el, draggable: !!this.o.draggable, anchor: 'center' }).setLngLat([this.ll.lng, this.ll.lat]).addTo(m.gl);
      this.mm.on('dragend', () => { const p = this.mm.getLngLat(); this.ll = { lat: p.lat, lng: p.lng }; (this.h.dragend || []).forEach(f => f()); }); return this; }
    setLatLng(p) { const n = toLL(p); if (this.el && /car/.test(this.el.className) && dist(this.ll, n) > 2) { this.head = bearing(this.ll, n); this.el.firstChild.style.transform = `rotate(${this.head - (this._map?.gl.getBearing() || 0)}deg)`; }
      this.ll = n; this.mm?.setLngLat([n.lng, n.lat]); return this; }
    getLatLng() { return mkLL(this.ll); }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
    bindTooltip(t) { this.tip = t; if (this.el) this.el.title = t; return this; }
    setTooltipContent(t) { return this.bindTooltip(t); }
    remove() { this.mm?.remove(); this.mm = null; this._map = null; this.g?.items.delete(this); return this; }
  }

  class Line {
    constructor(lls, o = {}) { this.lls = lls.map(toLL); this.o = o; this.id = 'ln' + (++uidN); }
    _data() { return { type: 'Feature', geometry: { type: 'LineString', coordinates: this.lls.map(p => [p.lng, p.lat]) } }; }
    addTo(g) { const m = g instanceof Group ? g.map : g; if (g instanceof Group) g.add(this); this._map = m;
      const color = this.o.color === '#2563eb' ? '#60a5fa' : GOLD;
      m.ready(() => { if (!this._map) return; const gl = m.gl; gl.addSource(this.id, { type: 'geojson', data: this._data(), lineMetrics: true });
        gl.addLayer({ id: this.id + 'g', type: 'line', source: this.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 16, 'line-blur': 10, 'line-opacity': .45 } });
        gl.addLayer({ id: this.id + 'c', type: 'line', source: this.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 8 } });
        gl.addLayer({ id: this.id, type: 'line', source: this.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, color === GOLD ? '#F5D77A' : '#bfdbfe', 1, color] } });
        if (color === GOLD && !matchMedia('(prefers-reduced-motion: reduce)').matches) { const t0 = performance.now(), id = this.id; const f = (t) => { const k = Math.min(1, (t - t0) / 800); if (!gl.getLayer(id)) return; gl.setPaintProperty(id, 'line-gradient', k < 1 ? ['step', ['line-progress'], ['interpolate', ['linear'], ['line-progress'], 0, '#F5D77A', 1, '#D4AF37'], Math.max(.001, k), 'rgba(0,0,0,0)'] : ['interpolate', ['linear'], ['line-progress'], 0, '#F5D77A', 1, '#D4AF37']); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
        this.on = true; }); return this; }
    setLatLngs(l) { this.lls = l.map(toLL); if (this.on) this._map.gl.getSource(this.id)?.setData(this._data()); return this; }
    getBounds() { return this.lls; }
    remove() { const m = this._map; if (m && this.on) { const gl = m.gl; ['g', 'c', ''].forEach(s => gl.getLayer(this.id + s) && gl.removeLayer(this.id + s)); gl.getSource(this.id) && gl.removeSource(this.id); }
      this.on = false; this._map = null; this.g?.items.delete(this); return this; }
  }

  class Group {
    constructor() { this.items = new Set(); }
    addTo(m) { this.map = m; return this; }
    add(x) { x.g = this; this.items.add(x); }
    clearLayers() { [...this.items].forEach(x => x.remove()); }
    eachLayer(f) { [...this.items].forEach(f); }
  }

  class Map {
    constructor(id) {
      this.q = []; this.loaded = false; this.h = {};
      this.gl = new maplibregl.Map({ container: id, style: STYLE, center: [-73.7551, 40.6054], zoom: 13, attributionControl: false, pixelRatio: Math.max(2, devicePixelRatio || 1), maxPitch: 70, fadeDuration: 150 });
      this.gl.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Routing <a href="https://project-osrm.org">OSRM</a> · Search <a href="https://photon.komoot.io">Photon</a> · <a href="https://openfreemap.org">OpenFreeMap</a>' }), 'top-right');
      this.gl.on('load', () => { this._theme(); this.loaded = true; this.q.splice(0).forEach(f => f()); document.getElementById(id).dataset.ready = '1'; document.querySelectorAll('.maplibregl-ctrl-attrib').forEach(e => e.classList.remove('maplibregl-compact-show')); });
      
      const wrap = (e) => ({ latlng: mkLL(e.lngLat), originalEvent: e.originalEvent });
      this.gl.on('click', e => (this.h.click || []).forEach(f => f(wrap(e))));
      this.gl.on('contextmenu', e => (this.h.contextmenu || []).forEach(f => f(wrap(e))));
      let lp; this.gl.on('touchstart', e => { if (e.points?.length !== 1) return; clearTimeout(lp); lp = setTimeout(() => (this.h.contextmenu || []).forEach(f => f(wrap(e))), 600); });
      ['touchend', 'touchmove', 'dragstart'].forEach(ev => this.gl.on(ev, () => clearTimeout(lp)));
    }
    _theme() {
      const gl = this.gl, set = (l, p, v) => gl.getLayer(l) && gl.setPaintProperty(l, p, v);
      set('background', 'background-color', '#0b0b0d'); set('water', 'fill-color', '#0d1824'); set('landuse_park', 'fill-color', '#0f1a12');
      ['highway_motorway_inner', 'highway_motorway_subtle'].forEach(l => set(l, 'line-color', '#5a4a1c'));
      ['highway_major_inner', 'highway_major_subtle'].forEach(l => set(l, 'line-color', '#34302a'));
      set('highway_minor', 'line-color', '#24231f');
      gl.getStyle().layers.filter(l => l.type === 'symbol' && /poi/.test(l.id)).forEach(l => gl.setLayoutProperty(l.id, 'visibility', 'none'));
      if (gl.getLayer('building')) gl.setLayoutProperty('building', 'visibility', 'none');
      gl.addLayer({ id: 'b3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, paint: {
        'fill-extrusion-color': '#1c1b19', 'fill-extrusion-opacity': .85,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } }, 'highway_name_other');
    }
    ready(f) { this.loaded ? f() : this.q.push(f); }
    setView(p, z) { const l = toLL(p); this.gl.flyTo({ center: [l.lng, l.lat], zoom: z ?? this.gl.getZoom(), pitch: 0, bearing: 0, duration: 900, essential: true }); return this; }
    panTo(p) { const l = toLL(p); this.gl.easeTo({ center: [l.lng, l.lat], zoom: Math.max(16, this.gl.getZoom()), pitch: 55, duration: 900 }); return this; }
    fitBounds(b, o = {}) { const bb = Array.isArray(b) ? bbox(b) : b; const pd = (o.padding || [40, 40])[0];
      const bottom = Math.min(innerHeight * .45, (document.getElementById('sheet')?.offsetHeight || 0) + 30);
      this.gl.fitBounds(bb, { padding: { top: 80, left: pd, right: pd, bottom: Math.max(pd, bottom) }, pitch: 35, maxZoom: 16.5, duration: 1200 }); return this; }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
    off(e, f) { this.h[e] = (this.h[e] || []).filter(x => x !== f); return this; }
    invalidateSize() { this.gl.resize(); }
  }

  window.L = {
    map: (id) => new Map(id), layerGroup: () => new Group(), marker: (p, o) => new Marker(p, o), polyline: (l, o) => new Line(l, o),
    divIcon: (o) => o, tileLayer: () => ({ addTo() { return this; } })
  };
})();
