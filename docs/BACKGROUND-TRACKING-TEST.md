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
| Gradle compile of the native recorder (`cd android && ./gradlew :app:compileDebugJavaWithJavac`) | ⏳ not run — the development machine had < 1 GB free RAM |
| `assembleDebug` (no `cap sync` needed: no new npm plugin) | ⏳ |

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
8. ⏳ Gradle build and `npx cap sync android` complete cleanly at targetSdk 36, with no
   foreground-service-type warnings.

## Acceptance

1. ⏳ 2-hour trip, phone locked throughout → continuous track, no gap > 2 min while moving.
2. ⏳ Zero point loss across a 10-minute offline window; no duplicates after retry.
3. ⏳ The trip end is sent only after the trip's buffered points ("Syncing N points…", then
   "Finishing trip — waiting for network" when offline); stored point count = recorded count.
4. ⏳ Manifest builds warning-free with `foregroundServiceType="location"`.
5. ⏳ OEM guide + battery-optimisation request on the listed brands, not repeated once done.
6. 🖥 ✅ Typed, lint-clean (bar the pre-existing finding above); plan, test and assumption docs written.
