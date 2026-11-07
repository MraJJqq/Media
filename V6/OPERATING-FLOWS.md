# VEGAS V6 — System Modules & Operating Flows

This directory is the reusable source snapshot of the V6 system as of commit `c9be0978f30f2e20307d8c184966b378941b87f9`. The source files are copied without changing their contents. Existing Media assets and project files remain untouched.

## Scope

This package records the five display/runtime systems and the connected signal ticker:

1. Shared viewport and page lifecycle coordination.
2. Rolling market-card system.
3. Logo and countdown system.
4. Timeframe selector.
5. Gate K-line system.
6. V12 signal feed and bottom ticker.

Background artwork and background-generation files are intentionally outside this synchronization scope.

## Page boot and system orchestration

Entry: `index.html` → `modules/v6-runtime.js`.

1. Load the shared lifecycle manager, page lifecycle manager, 27-instrument universe, Gate contract map, V12 feed, signal ticker, K-line view and Gate K-line controller.
2. Restore the selected timeframe from local storage key `vegas-v6-selected-timeframe`; accepted values are `1H`, `4H`, `8H`, and `D`. Default is `4H`.
3. Build the 27-item session rotation queue. The first symbol is selected so it differs from the previous session's first symbol when possible; the previous start is stored as `vegas-v6-last-random-start`.
4. Verify that the instrument universe and Gate contract map both contain exactly 27 complete entries.
5. Initialize the K-line view/controller, V12 feed and ticker. The host page sends state to the Logo and timeframe iframe modules using same-origin `postMessage`.
6. Rotate symbols through the session queue. The runtime uses a 7-second display interval and a 1.5-second transition stage; active user interaction locks pause rotation.
7. Refresh V12 signals and Gate card quotes only while the page is active. Page lifecycle suspension prevents background work and resumes the runtime when visible again.
8. On teardown, stop timers, requests, subscriptions and lifecycle-owned resources.

The host page owns coordination. Child modules own their rendering and interaction details; the host passes state through explicit messages rather than reaching into their internal DOM.

## Shared viewport, lifecycle and state

Sources:
- `modules/shared/lifecycle.js`
- `modules/shared/page-lifecycle-v6.js`
- `modules/shared/config.js`
- `modules/shared/universe-v6.js`
- `modules/shared/gate-universe.js`
- `assets/css/v6-modules.css`
- `modules/v6-runtime.js`

Responsibilities:
- Maintain one 27-instrument universe and its Gate contract mapping.
- Coordinate page visibility, pagehide/pageshow and suspended/resumed work.
- Own page-level timers and cleanups; prevent hidden-page polling and animation work.
- Coordinate symbol selection, timeframe changes, K-line state and user-interaction locks.
- Keep layout and responsive presentation in the host stylesheet; the individual modules retain their own internal sizing and rendering rules.

## Rolling market cards

Sources:
- `cards/rolling-cards.js`
- `cards/rolling-cards.css`

Operating flow:
1. Build the fixed 27-card set once from the instrument list and attach it to the rolling-card viewport.
2. Resolve each card's logo through the local `assets/logos/Core` or `assets/logos/Stocks` paths.
3. Maintain price/open/change state in fixed-size arrays. Update only dirty card text; off-screen cards defer text refresh until they re-enter view.
4. Calculate the ring layout when the viewport dimensions change; animate the ring using the module's animation loop.
5. Accept market quote updates through the exposed `updateQuote` / `updateQuotes` window interface. The host obtains Gate USDT perpetual tickers and passes validated quote values to the card module.
6. Pointer/touch drag and inertia are handled within the card module. Interaction with the page's main symbol rotation is coordinated by the host runtime.

## Logo and countdown

Sources:
- `modules/logo/logo.html`
- `modules/logo/logo.css`
- `modules/logo/logo.js`
- `modules/logo/host.css`

Operating flow:
1. The host sends `VEGAS_LOGO_SET_SYMBOL` and `VEGAS_LOGO_SET_TIMEFRAME` messages to the same-origin Logo iframe.
2. The Logo module maps each of the 27 symbols to its local SVG asset.
3. Symbol changes use the module's fade transition; the previous image is faded before the new symbol is applied.
4. Countdown uses the device clock and the selected timeframe duration. It updates at minute boundaries and pauses its clock scheduling while the document is hidden.
5. Incoming messages are accepted only from the same-origin parent window.

## Timeframe selector

Sources:
- `modules/timeframe-switch/index.html`
- `modules/timeframe-switch/host.css`

Operating flow:
1. Present the four native display intervals: `1H`, `4H`, `8H`, `D`.
2. A user selection updates the selector's pressed state and sends `VEGAS_TIMEFRAME_SELECT` to the parent.
3. The host validates the value, stores it under `vegas-v6-selected-timeframe`, updates Logo/countdown state, and reselects the active Gate contract at the new interval.
4. The host can also send `VEGAS_TIMEFRAME_SET` to restore the selector after page initialization or state changes.
5. The iframe accepts messages only from the same-origin parent.

## Gate K-line system

Sources:
- `kline/gate-kline-controller.js`
- `kline/v6-kline-view.js`
- `kline/v6-vegas-ema.js`
- `kline/v6-viewport-state.js`
- `kline/cache-standard.md`

Operating flow:
1. The host maps the selected symbol to its Gate USDT perpetual contract and selected interval.
2. The controller validates the contract against Gate's contract list and requests historical candlesticks from Gate's USDT futures REST API.
3. Historical pages are fetched in bounded batches; normalized candles are merged by timestamp, sorted, validated, and stored in IndexedDB.
4. Cache namespace: database `vegas-v6-market-cache`, object store `candles`; per-contract/per-interval keys use `gate-usdt:<contract>:<timeframe>`.
5. The controller loads cached history, obtains the latest exchange candles, repairs detected gaps, and merges verified data. The cache records history-boundary and latest-gap status separately.
6. The live connection uses Gate's USDT futures WebSocket endpoint. Reconnect, retry and pending cache writes are managed by the controller.
7. The K-line view renders candles and Vegas EMA overlays. Viewport state is normalized and persisted by the V6 viewport-state module.
8. User gesture interaction is reported to the host. The host acquires an interaction lock so automatic symbol rotation does not interrupt K-line use.
9. When the page is hidden or suspended, requests, live work and timers are paused/cancelled; the lifecycle resumes them when the page becomes active.

Supported intervals in this system are `1H`, `4H`, `8H`, and `D`. Data source is Gate USDT perpetual futures.

## V12 signal feed and bottom ticker

Sources:
- `modules/signal-ticker/v12-feed.js`
- `modules/signal-ticker/ticker.js`

Operating flow:
1. Read `https://raw.githubusercontent.com/MraJJqq/v12/main/v12/public-signals.json`.
2. Cache a successful payload for 30 seconds; requests have a 10-second timeout and are skipped while the page is hidden.
3. Validate source name, schema version, current Beijing signal day, completed full-pool scan status, and exact 27-symbol universe.
4. The ticker accepts only a complete valid V12 payload. Formal signals are matched against the V6 contract universe and rendered into their instrument groups.
5. The ticker creates a continuous marquee. Resize/layout recalculations preserve the existing animation timeline rather than restarting it.
6. Invalid, incomplete or unavailable feed data is represented as a waiting/unavailable state; it is not treated as a formal signal.

## Local assets and dependencies

- Logos: `assets/logos/Core` and `assets/logos/Stocks` (27 SVG files).
- Font: `assets/fonts/ChakraPetch-Bold.ttf`.
- App icons: `assets/icons/App-Icon.svg` and `assets/icons/App-Icon-180.png`.
- Shared host layout: `assets/css/v6-modules.css`.
- Runtime data providers: Gate USDT perpetual REST/WebSocket APIs and the V12 public JSON feed.
- Browser capabilities: Fetch, WebSocket, IndexedDB, localStorage, postMessage, Page Visibility API, ResizeObserver and animation-frame scheduling.

## Validation checklist

- Confirm all relative imports and asset paths resolve within this V6 package, excluding the deliberately out-of-scope background artwork.
- Confirm all 27 symbols have a Gate contract mapping and local logo mapping.
- Confirm all four intervals propagate from selector → host runtime → K-line controller → Logo countdown.
- Confirm hidden-page suspension stops polling/animation work and visible-page restoration resumes it.
- Confirm K-line history/cache/live update and viewport persistence.
- Confirm V12 payload validation rejects stale-day, partial-pool, duplicate or foreign-symbol data.
- Confirm cards, Logo, timeframe selector, K-line and ticker remain independent child modules coordinated by the host runtime.

