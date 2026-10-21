// Real-time bus. "mqtt" = public MQTT-over-WSS broker (cross-device, no account needed).
// "nostr" (default) = ephemeral events over public Nostr relays on port 443 (works on networks that block MQTT ports).
// "local" = BroadcastChannel (same browser, used for offline testing).
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
export function match(pattern, topic) {
  const p = pattern.split('/'), t = topic.split('/');
  for (let i = 0; i < p.length; i++) { if (p[i] === '#') return true; if (p[i] !== '+' && p[i] !== t[i]) return false; }
  return p.length === t.length;
}
import { finalizeEvent, generateSecretKey } from './vendor/nostr.js';
const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
const KIND = 20333; // ephemeral: relayed live, never stored
export function tagsFor(prefix, topic) {
  const p = topic.split('/'); const t = [['t', prefix + topic]];
  if (p.length === 2) t.push(['t', prefix + p[0] + '/+']);
  return t;
}
export class Bus {
  constructor({ mode = 'mqtt', ns = 'nyc', onStatus = () => {} } = {}) {
    this.prefix = `queenscab/v1/${ns}/`; this.subs = []; this.mode = mode; this.onStatus = onStatus;
    if (mode === 'local') {
      this.bc = new BroadcastChannel('queenscab-' + ns);
      this.bc.onmessage = (e) => this._deliver(e.data.topic, e.data.msg);
      setTimeout(() => onStatus('local'), 0);
    } else if (mode === 'mqtt') this._connect(0);
    else this._nostr();
  }
  _nostr() {
    this.sk = generateSecretKey(); this.seen = new Set(); this.relays = []; this.sid = 0;
    const open = (url) => {
      const r = { url, ws: new WebSocket(url), open: false }; this.relays.push(r);
      r.ws.onopen = () => { r.open = true; this.onStatus('online'); this.subs.forEach(s => this._req(r, s)); };
      r.ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m[0] !== 'EVENT') return; const ev = m[2];
        if (this.seen.has(ev.id)) return; this._seen(ev.id);
        const tt = ev.tags.find(x => x[0] === 't'); if (!tt || !tt[1].startsWith(this.prefix)) return;
        this._deliver(tt[1].slice(this.prefix.length), JSON.parse(ev.content)); } catch {} };
      r.ws.onclose = () => { r.open = false; this.relays = this.relays.filter(x => x !== r); if (!this.relays.some(x => x.open)) this.onStatus('reconnecting'); setTimeout(() => open(url), 2500); };
      r.ws.onerror = () => {};
    };
    RELAYS.forEach(open);
  }
  _seen(id) { this.seen.add(id); if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000)); }
  _req(r, s) { try { r.ws.send(JSON.stringify(['REQ', s.sid, { kinds: [KIND], '#t': [this.prefix + s.pattern], since: Math.floor(Date.now() / 1000) - 10 }])); } catch {} }
  _connect(i) {
    const url = BROKERS[i % BROKERS.length];
    this.client = window.mqtt.connect(url, { clientId: 'qc_' + Math.random().toString(16).slice(2), reconnectPeriod: 0, connectTimeout: 8000, clean: true });
    this.client.on('connect', () => { this.onStatus('online'); this.subs.forEach(s => this.client.subscribe(this.prefix + s.pattern)); });
    this.client.on('message', (topic, payload) => { try { this._deliver(topic.slice(this.prefix.length), JSON.parse(payload.toString())); } catch {} });
    const retry = () => { if (this._closing) return; this.onStatus('reconnecting'); try { this.client.end(true); } catch {} setTimeout(() => this._connect(i + 1), 1500); };
    this.client.on('close', retry); this.client.on('error', () => {});
  }
  _deliver(topic, msg) { this.subs.forEach(s => { if (match(s.pattern, topic)) s.cb(msg, topic); }); }
  subscribe(pattern, cb) {
    const s = { pattern, cb, sid: 'q' + (++this.sid || (this.sid = 1)) }; this.subs.push(s);
    if (this.client && this.client.connected) this.client.subscribe(this.prefix + pattern);
    if (this.relays) this.relays.filter(r => r.open).forEach(r => this._req(r, s));
    return () => { this.subs = this.subs.filter(x => x !== s); if (this.relays) this.relays.forEach(r => { try { r.open && r.ws.send(JSON.stringify(['CLOSE', s.sid])); } catch {} }); };
  }
  publish(topic, msg, { localOnly = false } = {}) {
    if (localOnly) return this._deliver(topic, msg);
    if (this.mode === 'nostr') {
      const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: tagsFor(this.prefix, topic), content: JSON.stringify(msg) }, this.sk);
      this._seen(ev.id); this._deliver(topic, msg);
      const out = JSON.stringify(['EVENT', ev]); this.relays.forEach(r => { if (r.open) try { r.ws.send(out); } catch {} });
      return;
    }
    if (this.mode === 'local') { this.bc.postMessage({ topic, msg }); this._deliver(topic, msg); }
    else if (this.client && this.client.connected) this.client.publish(this.prefix + topic, JSON.stringify(msg), { qos: 1 });
  }
}
