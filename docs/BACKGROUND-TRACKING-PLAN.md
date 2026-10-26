# Background GPS trip tracking — plan

Status: agreed 2026-10-26 (architecture choice confirmed by the product owner: native recorder
service). Scope: the Android **SEL Driver** app. iOS keeps its current behaviour and must still build.

## 1. What exists today (audit)

| Piece | Where | Notes |
| --- | --- | --- |
| Capacitor | `package.json` | **8.3** (core, android, cli). No major upgrade in this work. |
| App shell | `capacitor.config.ts` | `server.url` = `CAPACITOR_LIVE_URL` (`https://seltech.store`): the APK loads the live site. Web changes ship with a site deploy; native changes need a new APK. `android.useLegacyBridge: true`. |
| SDK levels | `android/variables.gradle` | minSdk 24, compileSdk 36, **targetSdk 36**. |
| Manifest | `android/app/src/main/AndroidManifest.xml` | Already declares every permission the prompt lists (fine/coarse/background location, FOREGROUND_SERVICE(+_LOCATION), POST_NOTIFICATIONS, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, WAKE_LOCK, RECEIVE_BOOT_COMPLETED). |
| Background plugin | `@capacitor-community/background-geolocation` **1.2.26** | Its service declares `foregroundServiceType="location"`. |
| Location wrapper | `src/lib/driver-mobile-geolocation.ts` | `watchDriverPosition`: on native → `BackgroundGeolocation.addWatcher` (foreground service + notification); web → `navigator.geolocation.watchPosition`. One-off fixes: `getCurrentDriverPosition`. |
| Fleet (company-vehicle) tracker | `src/components/fleet/use-trip-tracker.ts` | Watches via `watchDriverPosition` (distanceFilter 10 m), stamps `clientPointId`, batches 10 fixes / 30 s into the outbox; live route + geofences in localStorage. |
| Outbox | `src/components/fleet/offline-queue.ts` | **IndexedDB**, FIFO per trip, points ≤ 200 per request, end of trip queued *after* its points, retry every 20 s / on `online`. |
| Upload path | `POST /api/fleet/trips/:id/points` → `addPoints` (`src/lib/fleet/server/trips.ts`) | **Idempotent**: point doc id = `${tripId}_${clientPointId}`, existing ones skipped. Schema `pointsSchema` (`src/lib/fleet/schemas.ts`). |
| Fleet trip end | `end-trip-dialog.tsx` → `enqueueEnd` | Offline-capable: "Trip ended — waiting to sync" card in `active-trip.tsx`. |
| Own-vehicle tracker | `src/components/driver-management/trips/gps-trip-recorder.tsx` | Watches via `watchDriverPosition` (no distance filter); every fix appended to React state + localStorage; the path is saved as the trip's GPS evidence at Stop & review (no per-point upload). |
| Native code | `android/app/src/main/java/com/sel/` | `MainActivity` (first-launch permission onboarding, **no prominent disclosure**), `NativeSettingsPlugin` (open app / location / battery settings), `NativeUserLocationPlugin` + `UserLocationForegroundService` (admin-requested user-location sharing; native Firestore writes; `stopWithTask=false`). |

## 2. Root cause

Recording already happens in the plugin's foreground service, but **only while the app's Activity
is alive**:

- `BackgroundGeolocation.handleOnDestroy()` calls `service.stopService()`, and the service's
  `onUnbind()` removes every watcher and `stopSelf()`s (upstream issue #59). Swiping the app from
  Recents, or an OEM battery manager (MIUI, ColorOS, Funtouch, One UI) destroying the Activity, stops
  tracking.
- The plugin keeps nothing natively; fixes are handed to JS. While JS is dead, fixes are lost. A JS
  SQLite buffer (the prompt's `@capacitor-community/sqlite` design) would not help — it is written
  from the same dead JS.
- The own-vehicle recorder rewrites its whole route into localStorage on every fix (no distance
  filter), which grows heavy on long trips.

## 3. Architecture (agreed)

```
Native (survives swipe-away, restarted by Android)            App code (WebView, when alive)
──────────────────────────────────────────────────           ────────────────────────────────
TripRecorderService  (foreground, type=location,              src/lib/trip-tracking/*
  stopWithTask=false, START_STICKY)                             startTracking / stopTracking /
  FusedLocationProvider (5 s, 30 m)                             resumeIfActive / getStatus
  → accept filters (acc ≤ 50 m, no 0/NaN, monotonic,           drain native buffer →
    jitter < 5 m & < 5 s)                                         fleet: existing IndexedDB outbox
  → SQLite trip_points (Android built-in SQLiteOpenHelper)               → POST …/points (idempotent)
  → heartbeat 60 s: lastAliveAt, notification text                 own:   the trip's route (evidence)
  → errors: status + local notification "tap to fix"           PermissionsGate · disclosure ·
TripRecorderPlugin (Capacitor bridge to the above)             OEM guide · status chip · End gate
BatteryOptimizationPlugin (isIgnoring / requestIgnore /
  openAppInfo / openOemSettings)
```

Deviations from the prompt, and why (also in `docs/ASSUMPTIONS.md`):

1. **No `@capacitor-community/background-geolocation` for trips** — it stops on Activity destroy
   (§2). A native foreground service of our own, modelled on the existing
   `UserLocationForegroundService`, records independently of the WebView. The plugin stays installed
   for nothing else to break, and remains the fallback on old APKs.
2. **No `@capacitor-community/sqlite`** — the buffer is written natively with Android's built-in
   SQLite (no new dependency), so a fix is stored even when JS is dead. Same table shape as the
   prompt, plus `client_point_id`.
3. **"Synced" = handed to the outbox.** The native service does not upload: most drivers sign in
   with the web SDK (only Google sign-in is native), so the service has no reliable token. JS drains
   the native buffer into the existing IndexedDB outbox, which uploads with retry/backoff; a row is
   marked synced only after the outbox has persisted it. Points recorded while the app is dead wait
   in SQLite and upload when it is next opened — none are lost.
4. **Module path** `src/lib/trip-tracking/` (the repo has no `src/services/`; libraries live in
   `src/lib`). Same exports as the prompt.
5. **Preferences**: native state in `SharedPreferences`; the one-time OEM-guide flag in
   `localStorage` (persists in the app's WebView; avoids a new native plugin).
6. **Gap events** ride on the next points request as an optional `gaps` field; the server keeps the
   last 50 on the trip (`trackingGaps`). No other backend shape changes. No heartbeat endpoint exists;
   none is added (the gap record covers the need).
7. **Backward compatibility**: the web code is shared by every installed APK. When the
   `TripRecorder` plugin is not present (old APK, iOS, browser), the recorders keep today's
   `watchDriverPosition` path unchanged.

## 4. Native interface (contract)

Plugin **`TripRecorder`** (`TripRecorderPlugin.java`). All times are epoch milliseconds.

| Method | Args | Resolves |
| --- | --- | --- |
| `getPermissionStatus()` | — | `{ location: boolean, precise: boolean, background: boolean, notifications: boolean, locationServices: boolean, sdkInt: number }` |
| `requestLocationPermission()` | — | the status above (fine + coarse request) |
| `requestBackgroundLocationPermission()` | — | the status (API 29: dialog; 30+: the system's settings page; < 29: already true) |
| `requestNotificationPermission()` | — | the status (API 33+: dialog; below: opens the app's notification settings if disabled) |
| `start()` | `{ tripId, kind: 'fleet'\|'own', title, message, intervalMs?=5000, distanceFilterM?=30, maxAccuracyM?=50 }` | `{ started: true }`; rejects `NOT_AUTHORIZED` (no location permission) or `ANOTHER_TRIP_ACTIVE` (a different trip is recording). Same trip again → idempotent. |
| `stop()` | `{ tripId }` | `{ stopped: boolean, pending: number }` — stops updates and the service; keeps unsynced rows |
| `resume()` | — | `{ resumed: boolean, tripId: string\|null }` — restarts the service from saved state if a trip is active and not running |
| `getStatus()` | `{ tripId? }` | `{ activeTripId, kind, startedAt, running, lastFixAt, lastAccuracy, accepted, pending, lastAliveAt, consecutiveErrors, lastError: {code,message,at}\|null, gapsPending }` (`accepted`/`pending`/`gapsPending` for `tripId`, default the active trip) |
| `getPoints()` | `{ tripId, limit?=200 (≤500) }` | `{ points: [{ id, clientPointId, lat, lng, accuracy, speed, bearing, altitude, recordedAt }] }` — unsynced, oldest first |
| `markSynced()` | `{ tripId, upToId }` | `{ marked: number }` |
| `getGaps()` | `{ tripId }` | `{ gaps: [{ id, fromMs, toMs }] }` — unsynced |
| `markGapsSynced()` | `{ tripId, upToId }` | `{ marked: number }` |
| `purge()` | `{ olderThanDays?=7 }` | `{ deleted: number }` (synced rows only; also runs on plugin load) |

Events (`addListener`): `fix` `{ tripId, id, recordedAt }` (a nudge — JS drains with `getPoints`),
`trackingError` `{ tripId, code, message, consecutive }`, `status` (the `getStatus` shape).

`clientPointId` = `pt_<tripId>_<recordedAt>` (fits the server's `[A-Za-z0-9_-]{8,80}`), so a
re-sent batch never creates duplicates (`addPoints` keys on it).

Plugin **`BatteryOptimization`** (`BatteryOptimizationPlugin.java`): `isIgnoring() → { ignoring }`,
`requestIgnore()`, `openAppInfo()`, `openOemSettings() → { opened: 'oem'|'appInfo', component }`.

Service behaviour: `startForeground(…, FOREGROUND_SERVICE_TYPE_LOCATION)` on API 29+; notification
title/message from `start()`, text updated by the 60 s heartbeat ("Last fix 2 min ago · 340 points
saved"); on (re)start with a saved active trip and `now − lastAliveAt > 5 min`, a gap row
`{from: lastAliveAt, to: now}` is recorded; `SecurityException`/foreground-start failure → error
recorded, `trackingError` event, and a local notification "Trip tracking stopped — tap to fix".

## 5. Files

Add:
- `android/app/src/main/java/com/sel/TripRecorderService.java`, `TripPointStore.java`,
  `TripRecorderPlugin.java`, `BatteryOptimizationPlugin.java`
- `src/lib/trip-tracking/native.ts` (plugin bindings), `src/lib/trip-tracking/rules.ts` (pure: point
  conversion, status → chip, permission rows, OEM steps), `src/lib/trip-tracking/tracking.ts`
  (`startTracking`, `stopTracking`, `resumeIfActive`, `getStatus`, drain)
- `src/components/driver-management/tracking/` — `permissions-gate.tsx` (disclosure + gate),
  `oem-guide.tsx`, `tracking-status-chip.tsx`, `tracking-readiness.tsx` (provider: `ensureReady()`),
  `resume-tracking.tsx` (app-launch / resume hook)
- `tests/trip-tracking.test.mjs`
- `docs/BACKGROUND-TRACKING-TEST.md`, `docs/ASSUMPTIONS.md`

Modify:
- `AndroidManifest.xml` (the new service), `res/values/strings.xml` (channel names),
  `MainActivity.java` (register plugins; prominent disclosure before the first location request)
- `use-trip-tracker.ts` and `gps-trip-recorder.tsx` (native path when available; old path otherwise)
- `active-trip.tsx` (status chip; Stop & review drains first, "Syncing N points…")
- `fleet-home.tsx` / start dialogs (readiness gate before a trip starts)
- `offline-queue.ts` + `schemas.ts` + `trips.ts` (optional `gaps` on a points batch)
- `package.json` (`test:fleet` includes the new test)

## 6. Rollout

1. Deploy the site (web changes are inert until the new APK is installed — old APKs keep the old path).
2. Build and install the new APK (`docs/mobile-apk-build.md`); drivers must reinstall.
3. Run `docs/BACKGROUND-TRACKING-TEST.md` on real phones (Xiaomi/Redmi, Vivo or Oppo, Samsung,
   stock Android 14+).
