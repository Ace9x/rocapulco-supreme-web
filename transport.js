// Real-time bus. "mqtt" = public MQTT-over-WSS broker (cross-device, no account needed).
// "local" = BroadcastChannel (same browser, used for offline testing).
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
export function match(pattern, topic) {
  const p = pattern.split('/'), t = topic.split('/');
  for (let i = 0; i < p.length; i++) { if (p[i] === '#') return true; if (p[i] !== '+' && p[i] !== t[i]) return false; }
  return p.length === t.length;
}
export class Bus {
  constructor({ mode = 'mqtt', ns = 'nyc', onStatus = () => {} } = {}) {
    this.prefix = `queenscab/v1/${ns}/`; this.subs = []; this.mode = mode; this.onStatus = onStatus;
    if (mode === 'local') {
      this.bc = new BroadcastChannel('queenscab-' + ns);
      this.bc.onmessage = (e) => this._deliver(e.data.topic, e.data.msg);
      setTimeout(() => onStatus('local'), 0);
    } else this._connect(0);
  }
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
    const s = { pattern, cb }; this.subs.push(s);
    if (this.client && this.client.connected) this.client.subscribe(this.prefix + pattern);
    return () => { this.subs = this.subs.filter(x => x !== s); };
  }
  publish(topic, msg, retain = false) {
    if (this.mode === 'local') { this.bc.postMessage({ topic, msg }); this._deliver(topic, msg); }
    else if (this.client && this.client.connected) this.client.publish(this.prefix + topic, JSON.stringify(msg), { qos: 1, retain });
  }
}
