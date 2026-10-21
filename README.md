# 🚕 Rocapulco Supreme — web app

The browser/PWA rebuild of [Ace9x/rocapulco-supreme](https://github.com/Ace9x/rocapulco-supreme) (Fan's Expo + Supabase ride-hailing app for Far Rockaway). Same vision — phone sign-up, rider GPS pickup, dispatcher, driver status flow en route → arrived → on trip → completed, cash on completion, $5 + $2.50/mi + $0.40/min with JFK $45 / LGA $55 flat rates — but it runs in any browser with no app store, no Supabase project and no Twilio account.

A phone-first, installable (PWA) taxi app for NYC with **rider**, **driver** and **dispatcher** views — live in your browser, no install or account required.

**Live:** https://ace9x.github.io/rocapulco-supreme-web/

## What works
**Rider** — profile sign-up · pickup from live GPS (or search / long-press map) · destination search (or tap map) · real road route + fare estimate · request ride · automatic dispatch to the nearest online driver (15 s offer, then next driver) · driver card (name, car, plate, call) · live car on map with ETA · "driver arrived" alert · in-trip tracking · receipt · 1–5★ rating · trip history.

**Driver** — sign-up (vehicle, plate/TLC #) · go online/offline · live location sharing (device GPS) · incoming request with fare, distance, 15 s accept/decline countdown · turn-by-turn navigation to pickup then drop-off (OSRM maneuvers, voice prompts, auto-reroute when off route, "Open in Google Maps" fallback) · arrived / start / complete · earnings today & week, trip log, rating.

**Dispatcher** (`#/admin`) — live map of online drivers and a feed of trips with their status.

**Demo mode** (rider, on by default) spawns 4 *clearly labeled* simulated drivers near you so anyone can watch a full trip. Turn it off to only match real drivers. Driver "Simulate GPS" moves the car along the route for indoor testing.

## Try it on two phones
1. Phone A: open the link → **I'm a driver** → sign up → **Go online** (allow location).
2. Phone B: **I need a ride** → turn **Demo mode off** → pick a destination → **Request ride**.
Use the same `?ns=yourname` on both links for a private channel, e.g. `https://ace9x.github.io/rocapulco-supreme-web/?ns=fan`.

## Fares & payments
Fares use the original Rocapulco Supreme model (`fare.js`, ported from `packages/shared/src/fare.ts`): $5.00 base + $2.50/mile + $0.40/minute, $8 minimum, flat $45 to JFK and $55 to LaGuardia, computed from the real road route. Tolls/tip extra. Upfront estimate, not a licensed meter. **The app takes no payments — riders pay the driver directly (cash/card reader).**

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
- Accounts, history and earnings are stored on each device (localStorage), not in a cloud database.
- OSRM/Photon/OSM tile servers are free community services with fair-use limits; heavy production traffic needs your own or paid providers. Routing has no live traffic.
- Public relays can rate-limit or go down; the app uses three for redundancy and shows ● Live / reconnecting in the header.
- Not a TLC-licensed dispatch base or meter. No background location when the browser is closed (web platform limit).
