// Data layer. The whole app talks to ONE interface:
//   bus.publish(topic, message, { localOnly? })   bus.subscribe(pattern, cb) -> unsubscribe()
// Topics:  drivers/<id>  offer/<driverId>  trip/<tripId>  reports/<id>  config
// Swap the transport here without touching app.js.
//   ?transport=nostr (default)  public Nostr relays, port 443, no account
//   ?transport=mqtt             public MQTT brokers
//   ?transport=local            BroadcastChannel (same browser; tests)
//   ?transport=supabase         Supabase Realtime Broadcast — set SUPABASE below (or ?sb_url=&sb_key=)
import { Bus, match } from './transport.js';

export const SUPABASE = { url: '', anonKey: '' }; // fill in once the Supabase project exists

export function createBus({ transport, ns, onStatus }) {
  const q = new URLSearchParams(location.search);
  const url = q.get('sb_url') || SUPABASE.url, key = q.get('sb_key') || SUPABASE.anonKey;
  if (transport === 'supabase' || (!transport && url && key)) return new SupabaseBus({ url, key, ns, onStatus });
  return new Bus({ mode: ['local', 'mqtt'].includes(transport) ? transport : 'nostr', ns, onStatus });
}

// Supabase Realtime Broadcast adapter (same interface). Auth (phone OTP) and Postgres persistence
// plug in at the marked points; until then it behaves like the relay transport.
export class SupabaseBus {
  constructor({ url, key, ns, onStatus = () => {} }) {
    this.subs = []; this.queue = []; this.onStatus = onStatus;
    import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => {
      this.sb = createClient(url, key); // TODO(auth): this.sb.auth.signInWithOtp({ phone }) in profileForm
      this.ch = this.sb.channel('rocapulco:' + ns, { config: { broadcast: { self: false } } });
      this.ch.on('broadcast', { event: '*' }, ({ event, payload }) => this._deliver(event, payload));
      this.ch.subscribe((s) => { onStatus(s === 'SUBSCRIBED' ? 'online' : 'reconnecting'); if (s === 'SUBSCRIBED') this.queue.splice(0).forEach(([t, m]) => this._send(t, m)); });
    }).catch(() => onStatus('reconnecting'));
  }
  _deliver(topic, msg) { this.subs.forEach(s => { if (match(s.pattern, topic)) s.cb(msg, topic); }); }
  _send(topic, msg) { this.ch.send({ type: 'broadcast', event: topic, payload: msg }); /* TODO(db): upsert trips/drivers rows here */ }
  subscribe(pattern, cb) { const s = { pattern, cb }; this.subs.push(s); return () => { this.subs = this.subs.filter(x => x !== s); }; }
  publish(topic, msg, { localOnly = false } = {}) {
    this._deliver(topic, msg); if (localOnly) return;
    this.ch && this.ch.state === 'joined' ? this._send(topic, msg) : this.queue.push([topic, msg]);
  }
}
