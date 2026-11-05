# Rocapulco Supreme rs-v25 — Highbeam visual layer — release gate
Date: Nov 4 2026 9:52 PM ET
Change: new highbeam.css (loaded last on rider index.html + driver/index.html); visual only, no JS/business logic touched. SW rs-v24 → rs-v25 (highbeam.css added to shell).
Gate (tests/highbeam-gate.spec.mjs, local http server): 4/4 pass
- 390x844 and 412x915: rider JFK quote ($75.00), primary button signal green ≥56px, sheet radius 28, sheet/header targets ≥44px, no horizontal clipping (except intentional chip scrollers), reload keeps quote, offline shows dispatch phone, home shows TLC base B00639, rates page shows no surge, no "taxi/cab" in rider text, 0 console errors.
- Driver screen loads at both sizes, no clipped buttons, 0 console errors.
Fix found during gate: GPS button in route box was 40px → 44px.
Regression: full Playwright suite — same 7 failures exist on the unchanged rs-v24 baseline (network/Supabase-dependent: e2e full trip, demo trip, Valhalla routing, etc.); no new failures.
    tests/e2e.spec.mjs:8:1 › rider + real driver complete a full trip with simulated GPS 
    tests/e2e.spec.mjs:79:1 › demo mode: rider completes trip with a simulated driver 
    tests/growth.spec.mjs:5:1 › fare first, deep link + referral, rating actions, rebook/reverse 
    tests/growth.spec.mjs:36:1 › driver seatback QR card encodes the referral deep link 
    tests/routing.spec.mjs:3:1 › quote routes via Valhalla, never OSRM 
    tests/v7shots.spec.mjs:5:3 › v7 screens m 
    tests/v7shots.spec.mjs:5:3 › v7 screens d 
Not covered: no booking submitted (quote step only, local transport, no rows created); real Safari engine not tested; dispatch/owner screens not restyled.
Screenshots: rider-quote/offline/home/driver at 390 and 412.

## Live gate (https://ace9x.github.io/rocapulco-supreme-web/, live sw.js = rs-v25, highbeam.css 200)
Run 1: 3/4 pass — one rider quote timed out waiting for the fare/element (live routing call). Run 2: 4/4 pass, 0 console errors. Screenshots in qa/v25/live/.
