# 🚕 Rocapulco Supreme — web app

The browser/PWA rebuild of [Ace9x/rocapulco-supreme](https://github.com/Ace9x/rocapulco-supreme) (Fan's Expo + Supabase ride-hailing app for Far Rockaway). Same vision — phone sign-up, rider GPS pickup, dispatcher, driver status flow en route → arrived → on trip → completed, cash on completion, $5 + $2.50/mi + $0.40/min with JFK $45 / LGA $55 flat rates — but it runs in any browser with no app store, no Supabase project and no Twilio account.

A phone-first, installable (PWA) taxi app for NYC with **rider**, **driver** and **dispatcher** views — live in your browser, no install or account required.

**Live:** https://ace9x.github.io/rocapulco-supreme-web/

## What works
**Rider** — profile sign-up · pickup from live GPS (or search / long-press map) · destination search (or tap map) · real road route + fare estimate · request ride · automatic dispatch to the nearest online driver (15 s offer, then next driver) · driver card (name, car, plate, call) · live car on map with ETA · "driver arrived" alert · in-trip tracking · receipt · 1–5★ rating · trip history.

**Driver** — sign-up (vehicle, plate/TLC #) · go online/offline · live location sharing (device GPS) · incoming request with fare, distance, 15 s accept/decline countdown · turn-by-turn navigation to pickup then drop-off (OSRM maneuvers, voice prompts, auto-reroute when off route, "Open in Google Maps" fallback) · arrived / start / complete · earnings today & week, trip log, rating.

**Dispatcher** (`#/admin`) — live map of online drivers and a feed of trips with their status.

**Demo mode** (rider, on by default) spawns 4 *clearly labeled* simulated drivers near you so anyone can watch a full trip. Turn it off to only match real drivers. Driver "Simulate GPS" moves the car along the route for indoor testing.

## Round 2: competitor-driven upgrades (from Uber/Lyft/Curb review research)
1. **Honest ETA**: no ETA promise until a real driver accepts. Then you get a smoothed road ETA and a visible **free-cancel countdown** (3 min, and always free if the driver runs more than 5 min late).
2. **Upfront fare with an itemized breakdown** that sums to the total. No booking, service or cancellation fees. The upfront fare is locked and is exactly what the driver collects.
3. **The driver sees everything before accepting**: pickup, drop-off, rider note, fare, **$/mile** for the trip and $/mile including the pickup leg (from the real road route).
4. **Heading home**: only rides that end closer to home, with **no daily use limit**. Home stays on the driver's device.
5. **No penalty for declining**: there is no acceptance rate at all.
6. **Exact pickup**: drag the pickup pin and leave a note for the driver. **In-app chat** for each trip, plus call buttons (direct numbers; masking needs a telephony backend).
7. **Scheduled rides**: driver search opens 30 min before pickup, with an alert to the rider then. If the driver cancels or goes silent for over 60 s, the ride is **automatically reassigned**, and the same applies to on-demand rides.
8. **Busy-time pricing is off by default**, capped at ×1.5, and only turns on when the dispatcher enters a reason that riders see. It never applies to airport flat rates.
9. **One tap for "Driver never showed"**: available 5 min after the promised arrival. The rider is charged $0, the report goes to the dispatcher, and the next driver is one tap away. Receipts have a "Report a problem" button.
10. **Smooth animated car markers**; **battery-friendly GPS** (low-power while waiting, high accuracy only on trips, location sent only after moving 25 m or every 15 s); and **matching by road ETA** using the OSRM table service, not straight-line distance.

## Backend / Supabase
All app code goes through one interface in `data.js` (`publish(topic,msg)` / `subscribe(pattern,cb)`, topics `drivers/*`, `offer/*`, `trip/*`, `reports/*`, `config`). A `SupabaseBus` adapter using Supabase Realtime Broadcast is included. Fill in `SUPABASE.url/anonKey` in `data.js`, or open with `?transport=supabase&sb_url=…&sb_key=…`. The phone-OTP auth and Postgres write hooks are marked `TODO(auth)` / `TODO(db)`. This adapter has not been tested yet, because no Supabase project exists so far.

## Try it on two phones
1. Phone A: open the link → **I'm a driver** → sign up → **Go online** (allow location).
2. Phone B: **I need a ride** → turn **Demo mode off** → pick a destination → **Request ride**.
Use the same `?ns=yourname` on both links for a private channel, e.g. `https://ace9x.github.io/rocapulco-supreme-web/?ns=fan`.

## Fares & payments
Fares (`fare.js`, enforced again on the server by `taxi_fare()`): **Black Sedan** $3.50 base + $2.50/mile + $0.40/minute, $10 local minimum, flat JFK $75 / LaGuardia $82.50. **Black SUV** is 1.5× every Sedan rule ($15 minimum, JFK $112.50, LGA $123.75). No surge, ever. Drivers keep 70%.

## How it works
Static site (GitHub Pages) + real-time messaging as signed *ephemeral* events (relayed live, never stored) over public **Nostr relays on port 443** (nos.lol, relay.primal.net, nostr.mom — sent to all three, de-duplicated). `?transport=mqtt` switches to public MQTT brokers; `?transport=local` uses BroadcastChannel (same browser, for tests). Maps: © OpenStreetMap contributors (Leaflet). Routing: OSRM demo server. Geocoding: Photon (Komoot). No accounts or API keys needed.

| File | Purpose |
|---|---|
| `fare.js` | NYC fare model |
| `dispatch.js` | driver ranking, trip state machine, route geometry, turn instructions |
| `transport.js` | Nostr / MQTT / BroadcastChannel real-time bus |
| `app.js` | rider, driver, dispatcher UIs |

## Tests
```
npm test                 # unit tests (fare, dispatch, state machine, geometry)
npm run serve & npx playwright test                       # E2E, local transport
BASE=https://ace9x.github.io/rocapulco-supreme-web/ TRANSPORT=nostr npx playwright test   # E2E against live site + broker
```

## Honest limitations
- Public relays = anyone who knows the channel name can see messages on it (names, phone numbers, locations). Fine for demos/pilots; for real operations run a private relay/broker with auth (see `transport.js`, one URL to change).
- Scheduled rides are stored on the rider's device and dispatched while the app is open (a browser can't wake itself up). For guaranteed dispatch, use the Supabase backend.
- Accounts, history and earnings are stored on each device (localStorage), not in a cloud database.
- OSRM/Photon/OSM tile servers are free community services with fair-use limits; heavy production traffic needs your own or paid providers. Routing has no live traffic.
- Public relays can rate-limit or go down; the app uses three for redundancy and shows ● Live / reconnecting in the header.
- Not a TLC-licensed dispatch base or meter. No background location when the browser is closed (web platform limit).
