# Rocapulco Supreme rs-v26 — Highbeam on dispatch + owner screens; gold accents removed; brand audit
Visual only (CSS + copy). No JS logic changed. TLC records, receipts, rates page untouched (rates "no surge" asserted).
Changes
- dispatch/index.html loads ../highbeam.css (owner home renders inside the dispatch app, same stylesheet); queue tabs as pills, prices white tabular.
- owner-guide/ loads ../highbeam-doc.css (black, green links, Inter headline).
- highbeam.css: remaining gold accents (selected car card, fare numbers, "Flat" badge, airport chips, links, crest) → Highbeam white/green.
- Brand audit: removed visible "TODO: Fan's contact email" from privacy.html and terms.html (now "use Report a problem in the app, or call dispatch"); replaced "Fan" in public JS comments / README with "owner" / "Ace Apps". No personal Gmail found in public files.
- sw rs-v25 → rs-v26 (+ highbeam-doc.css in shell).
Local gate, Chromium (tests/highbeam-gate.spec.mjs + tests/highbeam-dispatch-gate.spec.mjs): 7/7 pass
- Rider + driver at 390x844, 412x915 (from v25 spec).
- Dispatch (sandbox, nothing written to server) at 390, 412, 1280: Highbeam bg; each queue tab click selects exactly that tab; all visible sheet/header buttons ≥44px, no clip, no pairwise overlap; reload; offline reload; owner guide black + PDF 200 + no horizontal scroll; rates page; 0 console errors.
- Unit tests 34/34. carservice.spec sandbox queue test is flaky (2 of 7 runs failed "#1 of 1" vs "#2 of 2" timing; 2/2 passed on baseline) — CSS-only change, logged as flaky, not fixed.
WebKit (real engine, Playwright webkit-2370 on Linux)
- Installed and launches, but this box's WebKit build has no TLS ("TLS support is not available"); apt install of glib-networking failed (mirror SSL errors / proxy 500). HTTPS was shimmed through Playwright route.fetch.
- With that shim: all layout/tap/overlap/tab/reload/offline assertions passed; console-error check FAILED with maplibre blob/createImageBitmap and "access control checks" errors that come from the shim (cross-origin re-served responses). Plain WebKit load of rider + driver on base and new code: 0 errors. Not a clean WebKit 0-error result — honest status: WebKit layout verified, WebKit console not verified.
Known visual gap: route line on the map is still gold (painted by map.js, JS — out of a CSS-only pass).
Before/after: qa/v26/before/*.png (rs-v24 code) vs qa/v26/*.png; v25 rider/driver/home before in qa/v25/before/.
