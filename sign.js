// Signed relay messages. Every message that changes a ride (offer, assign, accept, arrive, start, complete, cancel, location)
// carries sig = { kid, ts, s }: an ECDSA P-256 signature over [topic, message, kid, ts].
//   staff keys: registered server-side (register_staff_key, staff only), looked up by kid (staff_key RPC, role re-checked live)
//   rider keys: one fresh key per trip; its public half rides in the request and is stored on the server booking
const C = globalThis.crypto.subtle, ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
const enc = new TextEncoder(), MAX_AGE = 120e3;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const strip = ({ sig, ...m }) => m;
const canon = (topic, m, kid, ts) => enc.encode(JSON.stringify([topic, strip(m), kid, ts]));
export const pubOnly = (j) => ({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y });
export async function newKeyPair() { const k = await C.generateKey(ALG, true, ['sign', 'verify']); return { priv: k.privateKey, pub: pubOnly(await C.exportKey('jwk', k.publicKey)), privJwk: await C.exportKey('jwk', k.privateKey) }; }
export const importPriv = (jwk) => C.importKey('jwk', jwk, ALG, false, ['sign']);
const pubCache = new Map();
const importPub = async (jwk) => { const k = jwk.x + jwk.y; if (!pubCache.has(k)) pubCache.set(k, C.importKey('jwk', pubOnly(jwk), ALG, false, ['verify'])); return pubCache.get(k); };
export async function sign(priv, kid, topic, m) { const ts = Date.now(), s = b64(await C.sign(SIG, priv, canon(topic, m, kid, ts))); return { ...strip(m), sig: { kid, ts, s } }; }
const seen = new Set();
// Returns true only for a fresh, unreplayed message whose signature matches pubJwk.
export async function verify(pubJwk, topic, m, now = Date.now()) {
  const g = m && m.sig; if (!g || !pubJwk || typeof g.s !== 'string' || !(Math.abs(now - g.ts) < MAX_AGE)) return false;
  const key = topic + '|' + g.s; if (seen.has(key)) return false;
  let ok = false; try { ok = await C.verify(SIG, await importPub(pubJwk), unb64(g.s), canon(topic, m, g.kid, g.ts)); } catch { ok = false; }
  if (ok) { seen.add(key); if (seen.size > 5000) seen.delete(seen.values().next().value); }
  return ok;
}
export const samePub = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
