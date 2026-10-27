# Assumptions — background GPS trip tracking

Every place the build departs from, or had to interpret, the background-tracking brief. Design:
`docs/BACKGROUND-TRACKING-PLAN.md`; tests: `docs/BACKGROUND-TRACKING-TEST.md`. (Fleet-module
assumptions stay in `docs/fleet/ASSUMPTIONS.md`.)

## Architecture

1. **A native recorder service instead of `@capacitor-community/background-geolocation` for trips.**
   The plugin stops its watchers when the Activity is destroyed (`handleOnDestroy` → `stopService`,
   `onUnbind` → `removeLocationUpdates`), so a swipe from Recents or an OEM kill ends tracking —
   the brief's test 2 and acceptance 1 could not pass with it. Agreed with the product owner
   (2026-10-26). `TripRecorderService` is modelled on the existing `UserLocationForegroundService`.
   The plugin stays installed and remains the path on APKs built before this change.
2. **Android's built-in SQLite, written natively — not `@capacitor-community/sqlite`.** A buffer
   written from JS is lost exactly when JS is dead, which is the failure being fixed. Table shape as
   briefed (`trip_points` + the index), plus `client_point_id` (unique) and `synced_at`; gap records
   in `trip_gaps`.
3. **"Synced" means "handed to the app's outbox".** Most drivers sign in through the web SDK (only
   Google sign-in is native), so the service has no token of its own to upload with. The app drains
   the native buffer into the existing IndexedDB outbox (`offline-queue.ts`), which uploads to the
   existing `POST /api/fleet/trips/:id/points`; a native row is marked synced only once the outbox
   has stored it. Points recorded while the WebView is dead wait in SQLite and upload when the app
   is next opened — none are lost, but the server sees them late.
4. **Own-vehicle trips** have no server-side point upload (their route is saved as the trip's GPS
   evidence at Stop & review), so their drain appends to the in-flight trip in `localStorage`,
   written synchronously before the rows are marked synced. The recorder key is a local
   `recorderId` (`own_…`); the trip has no server id until it is saved.

## Interfaces

5. **Module path** `src/lib/trip-tracking/` (`rules.ts` pure, `native.ts` bindings, `tracking.ts`
   runtime), not `src/services/tripTracking.ts` — the repo keeps libraries in `src/lib` and has no
   `src/services`. Exports as briefed: `startTracking(tripId, options)` (also takes the trip kind and
   notification text), `stopTracking(tripId)`, `resumeIfActive()`, `getStatus(tripId?)` — the last
   is **async**, because the figures live in the native service.
6. **Idempotency key** `clientPointId = pt_<tripId>_<recordedAt ms>` (fits the server's
   `[A-Za-z0-9_-]{8,80}`); the server already stores points as `${tripId}_${clientPointId}` and skips
   existing ones, so no server-side dedupe had to be added.
7. **Preferences**: native state in `SharedPreferences` (`sel_trip_recorder`); the one-time OEM-guide
   flag in the WebView's `localStorage` (`sel-trip-tracking:oem-guide-shown`), which persists per
   install — avoids adding `@capacitor/preferences` (a native plugin, i.e. another APK dependency).
8. **Gap events** ride on the next points request as an optional `gaps: [{ fromAt, toAt }]`
   (≤ 20 per request); a request may now carry gaps and no points. The server keeps the last 50 on
   the trip document as `trackingGaps`. Older apps never send it. A gap is recorded natively when the
   service (re)starts with a saved active trip and its last heartbeat is more than 5 minutes old —
   i.e. the service itself was down, not a parked vehicle (the 30 m distance filter sends no fixes
   while parked, so fix silence is not a gap).
9. **No heartbeat endpoint** exists and none was added; the native heartbeat (60 s) keeps
   `lastAliveAt` and the notification text current, and the gap record carries the outage to the
   server.

## Behaviour

10. **Filters** as briefed (accuracy > 50 m, 0/NaN, not newer than the last accepted fix, < 5 m
    within 5 s), applied natively before a fix is stored. Interval 5 s, distance filter 30 m.
11. **Trip end**: the native buffer is drained into the outbox before the end is sent ("Syncing N
    points…"). If points of the trip are still in the outbox after the flush (offline, or the server
    refused for now), the end is queued behind them instead of being posted ("Finishing trip —
    waiting for network"); the outbox sends strictly in order per trip. The photo already uploaded is
    not uploaded again. A refused end leaves the recorder running.
12. **Pause** stops the native recorder; resume starts it again. Leaving the Fleet page does not.
    A fleet recording the server no longer has as running (ended from the web, force-closed) is
    stopped on the next Fleet Trip load, and its buffer sent (late points are accepted for 48 h).
13. **Outbox retry** is now exponential (5 s doubling to 5 min, reset on success or reconnection)
    and also listens to Capacitor's `networkStatusChange`. It is a web timer, which only runs while
    the app is open — acceptable because recording no longer depends on it.
14. **Permissions gate** blocks a start until location, precise location, "Allow all the time",
    notifications (13+) and the Location switch are on; battery optimisation is shown as
    recommended, not required. The prominent disclosure (the brief's wording) is shown in the gate
    before the first location request, and natively in `MainActivity` before the first-launch
    request.
15. **Native recorder details** (`android/app/src/main/java/com/sel/`):
    - **Stopping** clears the trip's saved state, then delivers a stop *intent* (`startService`)
      rather than calling `stopService`. Stopping a service started with `startForegroundService`
      before it reaches `startForeground` crashes the app; the intent arrives after any queued
      start. If Android refuses that, it falls back to `stopService`.
    - **Errors that stop the service but keep the trip** for `resume()`: `NOT_AUTHORIZED`,
      `FOREGROUND_START_FAILED`, `LOCATION_UPDATES_FAILED`. `STORAGE_FAILED` reports and keeps
      recording.
    - **`start()` rejects with** `NOT_AUTHORIZED`, `ANOTHER_TRIP_ACTIVE`, `INVALID_ARGUMENT` or
      `START_FAILED`. Calling `start()` again for the same trip keeps the first call's settings.
    - **`lastFixAt` / `lastAccuracy`** describe the last fix *received* (accepted or dropped), so
      weak GPS shows on the chip. Fixes with no accuracy are dropped.
    - **A gap's start** is the last 60 s heartbeat, which does not run while the phone sleeps. So
      `fromAt` can be a little earlier than the actual kill.
    - **OEM settings** components are best-effort and need checking on devices. The Honor MagicOS
      one (`com.hihonor.systemmanager`) is the least certain; every attempt falls back to App info.
    - **No new Gradle dependencies and no new npm plugin**, so `npx cap sync` is not required for
      these Java files (it is harmless).
16. **No signal mid-trip (both kinds of vehicle)**: recording never needs the network; what differs
    is what happens at the end.
    - **Company vehicle**: the server cannot tell "offline" from "forgotten", so its idle job still
      closes a running trip after `idleAutoCloseMinutes` (3 h by default) without a fix, for review.
      The driver's own end is now still taken for such a trip (`awaitsDriverEnd`, 48 h, the same window
      as late points): their reading and photo settle it again (`endTrip` → `settle` with
      `lateDriverEnd`), the auto-close no longer counts against it. A manager's resolved review or an
      approved payment report keeps the last word. On the phone, such a trip stays on Fleet Trip as
      "End your trip on …" and keeps recording until the driver ends it or leaves it to the manager;
      a new start waits. The vehicle stays released from the auto-close (an abandoned trip must not
      block it); the late end only clears the vehicle's lock if it still points at this trip and only
      moves its odometer forward.
    - **Own vehicle**: there is no server-side trip until it is saved, so nothing closes it. Save
      without a connection goes to the phone's own-trip outbox (`own-trip-outbox.ts`, localStorage)
      and is sent by itself when the network is back; the trip carries `clientTripId` (the
      recording's id), which the server uses as the trip's id, so a save sent twice is one trip. A
      refusal a retry will not fix (the claim window closed meanwhile) is kept and shown with Retry /
      Remove, never dropped.
    - Both outboxes keep sending on every Driver Management page (`OutboxSync`), not only Fleet Trip.
17. **Not done**: iOS background tracking (out of scope; iOS keeps the in-app watcher); resuming a
    trip after a phone **reboot** (Android 14+ restricts starting a location foreground service
    from `BOOT_COMPLETED`; the trip resumes when the app is next opened, with a gap recorded).
    Battery and on-road figures need real phones — see the test checklist.
