# 🚕 Queens Cab

A phone-first, installable (PWA) taxi app for NYC with **rider**, **driver** and **dispatcher** views — live in your browser, no install or account required.

**Live:** https://ace9x.github.io/queens-cab/

## What works
**Rider** — profile sign-up · pickup from live GPS (or search / long-press map) · destination search (or tap map) · real road route + fare estimate · request ride · automatic dispatch to the nearest online driver (15 s offer, then next driver) · driver card (name, car, plate, call) · live car on map with ETA · "driver arrived" alert · in-trip tracking · receipt · 1–5★ rating · trip history.

**Driver** — sign-up (vehicle, plate/TLC #) · go online/offline · live location sharing (device GPS) · incoming request with fare, distance, 15 s accept/decline countdown · turn-by-turn navigation to pickup then drop-off (OSRM maneuvers, voice prompts, auto-reroute when off route, "Open in Google Maps" fallback) · arrived / start / complete · earnings today & week, trip log, rating.

**Dispatcher** (`#/admin`) — live map of online drivers and a feed of trips with their status.

**Demo mode** (rider, on by default) spawns 4 *clearly labeled* simulated drivers near you so anyone can watch a full trip. Turn it off to only match real drivers. Driver "Simulate GPS" moves the car along the route for indoor testing.

## Try it on two phones
1. Phone A: open the link → **I'm a driver** → sign up → **Go online** (allow location).
2. Phone B: **I need a ride** → turn **Demo mode off** → pick a destination → **Request ride**.
Use the same `?ns=yourname` on both links for a private channel, e.g. `https://ace9x.github.io/queens-cab/?ns=fan`.

## Fares & payments
Estimates follow the NYC TLC yellow-cab meter structure ($3.00 base, $0.70 per ⅕ mile, $0.70/min slow traffic, $1.00 improvement + $0.50 MTA surcharges, tolls/tip extra) using real route distance/time. It is an **estimate, not a licensed meter**. **The app takes no payments — riders pay the driver directly (cash/card reader).**

## How it works
Static site (GitHub Pages) + real-time messaging over a **public MQTT-over-WebSocket broker** (HiveMQ public broker, falls back to EMQX / Mosquitto test brokers). Maps: © OpenStreetMap contributors (Leaflet). Routing: OSRM demo server. Geocoding: Photon (Komoot). No accounts or API keys needed.

| File | Purpose |
|---|---|
| `fare.js` | NYC fare model |
| `dispatch.js` | driver ranking, trip state machine, route geometry, turn instructions |
| `transport.js` | MQTT / BroadcastChannel real-time bus |
| `app.js` | rider, driver, dispatcher UIs |

## Tests
```
npm test                 # unit tests (fare, dispatch, state machine, geometry)
npm run serve & npx playwright test                       # E2E, local transport
BASE=https://ace9x.github.io/queens-cab/ TRANSPORT=mqtt npx playwright test   # E2E against live site + broker
```

## Honest limitations
- Public broker = anyone who knows the channel name can see messages on it (names, phone numbers, locations). Fine for demos/pilots; for real operations move to a private broker or backend with auth (see `transport.js`, one URL to change).
- Accounts, history and earnings are stored on each device (localStorage), not in a cloud database.
- OSRM/Photon/OSM tile servers are free community services with fair-use limits; heavy production traffic needs your own or paid providers. Routing has no live traffic.
- Not a TLC-licensed dispatch base or meter. No background location when the browser is closed (web platform limit).
