// tlc-verify: checks a driver's TLC driver license + FHV vehicle license against NYC Open Data (free, public Socrata):
//   For Hire Vehicles - Active Drivers  xjfq-wh2d   |  For Hire Vehicles (FHV) - Active  8wbx-tsch
// Writes the result to taxi_driver_docs.tlc_check with the service role, so the client can't fake it.
import { createClient } from 'npm:@supabase/supabase-js@2';
const ORIGINS = ['https://ace9x.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const cors = (o: string | null) => ({ 'Access-Control-Allow-Origin': o && ORIGINS.includes(o) ? o : ORIGINS[0], 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' });
const SODA = 'https://data.cityofnewyork.us/resource/';
async function soda(ds: string, field: string, v: string) {
  const u = `${SODA}${ds}.json?${field}=${encodeURIComponent(v)}&$limit=1`;
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('NYC Open Data ' + r.status);
  return (await r.json())[0] || null;
}
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('authorization') || '';
    const admin = createClient(url, svc, { auth: { persistSession: false } });
    const jwt = auth.replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(jwt); if (!u?.user) return new Response(JSON.stringify({ error: 'sign in' }), { status: 401, headers: h });
    const body = await req.json().catch(() => ({}));
    const { data: me } = await admin.from('profiles').select('taxi_role').eq('id', u.user.id).maybeSingle();
    const role = me?.taxi_role; let target = u.user.id;
    if (body.user && body.user !== u.user.id) { if (!['dispatcher', 'owner'].includes(role)) return new Response(JSON.stringify({ error: 'dispatch only' }), { status: 403, headers: h }); target = body.user; }
    if (!['driver', 'dispatcher', 'owner'].includes(role)) return new Response(JSON.stringify({ error: 'staff only' }), { status: 403, headers: h });
    // simple rate limit: one check per target per 60 s
    const { data: d } = await admin.from('taxi_driver_docs').select('tlc_driver_license,tlc_vehicle_license,plate,tlc_checked_at').eq('user_id', target).maybeSingle();
    if (!d) return new Response(JSON.stringify({ error: 'save your documents first' }), { status: 400, headers: h });
    if (d.tlc_checked_at && Date.now() - Date.parse(d.tlc_checked_at) < 60e3) return new Response(JSON.stringify({ error: 'checked under a minute ago, try again shortly' }), { status: 429, headers: h });
    const [drv, veh] = await Promise.all([
      d.tlc_driver_license ? soda('xjfq-wh2d', 'license_number', String(d.tlc_driver_license).trim()) : null,
      d.tlc_vehicle_license ? soda('8wbx-tsch', 'vehicle_license_number', String(d.tlc_vehicle_license).trim()) : null]);
    const plateMatch = veh && d.plate ? norm(veh.dmv_license_plate_number) === norm(d.plate) : null;
    const check = {
      driver_active: !!drv, driver_name: drv?.name ?? null, driver_expires: drv?.expiration_date?.slice(0, 10) ?? null,
      vehicle_active: !!veh && String(veh.active).toUpperCase() === 'YES' && (plateMatch !== false), vehicle_found: !!veh, plate_match: plateMatch,
      vehicle_expires: veh?.expiration_date?.slice(0, 10) ?? null, vehicle_base: veh?.base_number ?? null, vehicle_base_name: veh?.base_name ?? null,
      vehicle_year: veh?.vehicle_year ?? null, wav: veh?.wheelchair_accessible ?? null,
      data_as_of: drv?.last_date_updated?.slice(0, 10) || veh?.last_date_updated?.slice(0, 10) || null,
      source: 'NYC Open Data: TLC FHV Active Drivers (xjfq-wh2d), FHV Active Vehicles (8wbx-tsch)' };
    await admin.from('taxi_driver_docs').update({ tlc_check: check, tlc_checked_at: new Date().toISOString() }).eq('user_id', target);
    return new Response(JSON.stringify(check), { headers: h });
  } catch (e) { return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers: h }); }
});
