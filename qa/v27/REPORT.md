# Rocapulco Supreme rs-v27 — map route line + markers to Highbeam green
Changes (visual only)
- map.js: route color #D4AF37 → #06C167; gradient start / inner highlight / draw-in animation #F5D77A → #7CF0B4 (light green). Black casing under the line kept for contrast (#06C167 on the dark basemap is roughly 8:1).
- app.js: trip-history route thumbnail gold gradient → green.
- highbeam.css: ride marker (.mk.ride b) green with black text (was white-on-gold after v26: low contrast); radar marker gold → green.
- Splash crest gradient (app.js) left gold on purpose, as brand art. Basemap road colors come from the tile style and are unchanged.
- sw rs-v26 → rs-v27.
Local gate, Chromium
- Highbeam gates (rider/driver 390+412, dispatch 390/412/1280): pass. Unit tests 34/34.
- Full Playwright suite: 14 failures, the SAME 14 on unchanged rs-v26 code in the same run window (network/Supabase-dependent e2e, growth, routing, v7 shots, accounts, apply, security, sandbox). No new failures.
- Pre-existing issue found, not fixed (it's logic, not visual): sandbox.spec shows sandbox mode still calls the server (rpc expiring_docs, tlc_reports, ride_event, rider_contact). Same on rs-v26.
Screenshots: qa/v27/before/ (rs-v26) vs qa/v27/; the rider-route-map-*.png clips show the route. Full-page headless shots render the map blank (a screenshot artifact; clipped shots of the same page show the map), so use the -map- clips.

## Live (rs-v27 confirmed in live sw.js; live map.js has #06C167): Highbeam gates 7/7 pass, 0 console errors, 12:03 AM ET. A first live attempt at ~11:55 PM failed 7/7 because the push had not gone through (a rebase was blocked by gate-overwritten qa/v25 shots) and the old build was still live; fixed and re-run. Shots: qa/v27/live/.
