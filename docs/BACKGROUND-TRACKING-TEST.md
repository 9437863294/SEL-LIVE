# Background GPS trip tracking — test checklist

Design: `docs/BACKGROUND-TRACKING-PLAN.md`. Run on a **new APK** (the native recorder is in the
APK; the web changes are inert on older ones). Mark each line with the date, phone and result.

Legend: ✅ passed · ❌ failed · ⏳ not run yet · 🖥 checked on the development machine (no phone)

## Automated / desk checks (run 2026-10-26)

| Check | Result |
| --- | --- |
| `tsc` over the tracking code and every changed screen | 🖥 ✅ clean |
| ESLint over changed files | 🖥 ✅ (one pre-existing `set-state-in-effect` in `gps-trip-recorder.tsx`'s restore effect, unchanged from HEAD) |
| `npm run test:fleet` — 82 tests, incl. `tests/trip-tracking.test.mjs` (point conversion, status chip, permission rows, OEM brands, gap rule) and the `gaps` server flow | 🖥 ✅ 82/82 |
| `npm run test:driver-management` — 43 tests | 🖥 ✅ 43/43 |
| Native code reviewed against the contract; framework APIs checked with `javap` against API 36 | 🖥 ✅ |
| Gradle compile of the native recorder (`cd android && ./gradlew :app:compileDebugJavaWithJavac`) | 🖥 ✅ no warnings from the new files (needed a `build.gradle` fix: versionCode/versionName as assignments) |
| `cap sync` (driver target) + `assembleDebug` | 🖥 ✅; merged manifest: `TripRecorderService` `foregroundServiceType="location"`, `stopWithTask="false"`, no warnings |
| Web deploy (App Hosting, commit `ae7f51e6`) | ✅ live on seltech.store ~10 min after the push |

## Emulator (Pixel 10a AVD, Android API 37, debug APK, 2026-10-26)

Driven through the WebView over DevTools (`Capacitor.Plugins.TripRecorder…`) with `adb emu geo fix`
movement ~66 m apart. No login was needed for these native checks; the web flows (gate, chip, drain
into the outbox) need a signed-in driver and are in the phone section below.

| Check | Result |
| --- | --- |
| First launch: prominent disclosure (exact Play wording, Not now / Continue) before any system prompt | ✅ |
| `start()` without location permission → rejected `NOT_AUTHORIZED` | ✅ |
| Recording: fixes stored with `pt_<trip>_<ms>` ids; service foreground, type location (`types=0x8`), ongoing "Trip running" notification | ✅ 6 of 8 fixes accepted (rest filtered / between intervals) |
| Screen locked (power key, device asleep) | ✅ 6 → 12 points while asleep |
| Swiped away from Recents (activity destroyed, process + service + notification stay) | ✅ 12 → 18 points with no activity |
| Process killed (OEM-style `kill -9`) → START_STICKY restart, back in the foreground, recording without a WebView | ✅ restarted in ~1 s; 18 → 25 points; no gap (down ~1 s) |
| Force-stop, 5 min 40 s idle, reopen → recorder resumes on plugin load; gap recorded | ✅ 6-minute gap |
| Second trip while one is active → `ANOTHER_TRIP_ACTIVE`; same trip again → idempotent | ✅ |
| Drain (`getPoints` / `markSynced` / `getGaps` / `markGapsSynced`) → pending 0 | ✅ 26 drained |
| `stop()` → service and notification gone, rows kept; `purge({olderThanDays: 0})` | ✅ 27 rows purged |
| BatteryOptimization: `openOemSettings` (stock Android → App info), `requestIgnore` dialog → Allow → `isIgnoring` true, on the device-idle whitelist | ✅ |
| Crashes (`FATAL EXCEPTION`) across all of the above | ✅ none |

## On phones

1. ⏳ Start a trip, lock the phone, drive/walk 30 min → continuous points, no gap > 90 s while
   moving. (Status chip shows Recording; "last fix" refreshes on return.)
2. ⏳ Swipe the app away from Recents mid-trip → the "Trip running" notification stays, points
   continue (reopen: the route has the swiped-away stretch).
3. ⏳ Airplane mode for 10 min, then restore → every point buffered and synced in order, zero
   duplicates (server: `vehicleManagementTripLocations` count = the recorder's accepted count).
4. ⏳ Force-stop the app (Settings → Force stop), reopen → the trip resumes; a gap is recorded
   (`trackingGaps` on the trip document).
5. ⏳ Deny background location → trip start blocked; the permissions gate lists it with a working
   Fix button; the prominent disclosure shows before the first system location prompt.
6. ⏳ Verify on: Xiaomi/Redmi (MIUI/HyperOS), Vivo or Oppo, Samsung, stock Android 14+. The
   "Keep tracking alive" guide shows once per phone on the first trip; "Open settings" reaches the
   maker's autostart/battery screen (or App info).
7. ⏳ Battery drain ≤ 8–10 % per hour with the 30 m distance filter.
8. 🖥 ✅ Gradle build and `npx cap sync android` complete cleanly at targetSdk 36, with no
   foreground-service-type warnings (2026-10-26).

## Acceptance

1. ⏳ 2-hour trip, phone locked throughout → continuous track, no gap > 2 min while moving.
2. ⏳ Zero point loss across a 10-minute offline window; no duplicates after retry.
3. ⏳ The trip end is sent only after the trip's buffered points ("Syncing N points…", then
   "Finishing trip — waiting for network" when offline); stored point count = recorded count.
4. 🖥 ✅ Manifest builds warning-free with `foregroundServiceType="location"`.
5. ⏳ OEM guide + battery-optimisation request on the listed brands, not repeated once done.
6. 🖥 ✅ Typed, lint-clean (bar the pre-existing finding above); plan, test and assumption docs written.
