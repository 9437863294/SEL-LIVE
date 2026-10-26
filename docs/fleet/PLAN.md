# SEL Fleet — trips, geofences, fuel & payment report: PLAN

Status: **approved 2026-10-25 ("build all") and built** — Phases 0–3 together. Decisions D1–D6 (§11)
were taken at the recommended defaults; [ASSUMPTIONS.md](ASSUMPTIONS.md) records them and every
departure found while building. What to publish by hand: [DEPLOY.md](DEPLOY.md). Checks:
[MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md).
Spec: "Antigravity build prompt — SEL Fleet Trip, Geofence, Fuel & Payment System" (pasted 2026-10-25).
Companion: [ASSUMPTIONS.md](ASSUMPTIONS.md) — every place this plan departs from the spec, and why.

> The pasted spec ends at §7. It refers to §9 (offline queue), Phases 1–3 and Reports A–D, which
> were not included. This plan proposes them (§8, §9 below); paste the missing sections to replace
> any of them.

---

## 1. What is being built

Company vehicles (bikes, cars, pickups — 96 in Vehicle Master today, 75 of them two-wheelers) get:

1. **Geofences** — office, yards, fuel stations, project sites — and automatic site arrival/departure.
2. **A daily km limit per vehicle.** Running beyond it needs the manager's approval *before the trip
   starts*, with escalation, a 2-hour expiry and a counted emergency override.
3. **Project and purpose on every trip**, so running is billed to a project.
4. **Odometer photos** at trip start and end (OCR-suggested reading), cross-checked against GPS km.
5. **Fuel entries with bill photos**; full-tank-to-full-tank mileage against the vehicle's standard,
   with alerts.
6. **A monthly payment report** — project-wise, vehicle-wise, held/flagged trips, driver
   reimbursements — as Excel, PDF and JSON, emailed and approved for payment.

Personal-vehicle travel is **not** part of this: it stays in Driver Management › My Trips / claims
(per-km reimbursement, reporting-authority approval) as built on 2026-10-23.

## 2. How the spec maps onto this repository

The spec's stack (§3–4: npm-workspace monorepo, Expo app, Vite admin web, Cloud Functions) does not
match this repo. Per §0 the design is adapted to what exists:

| Spec | This repo (what the build uses) |
| --- | --- |
| Expo / React Native driver + manager app | The **SEL Driver** Android app (Capacitor, `com.sel.driver`) — a WebView of the live site at `/driver-management`. Driver and manager screens are responsive pages in **Driver Management**. |
| Background location (expo-location / task-manager) | `@capacitor-community/background-geolocation` (already installed, `src/lib/driver-mobile-geolocation.ts`) with its foreground-service notification. On a desktop browser: foreground only. |
| expo-sqlite offline queue | **IndexedDB** queue in the WebView (points, geofence events, photos, end-trip), flushed on reconnect (`@capacitor/network`). |
| ML Kit odometer OCR | **Decision needed** (see §11): Google Cloud Vision on the server (no app update), native ML Kit (new APK), or photo + typed reading only. |
| Vite admin web, React Router, TanStack Query | Next.js 16 App Router pages under `/driver-management` and `/vehicle-management`, the app's design system (ModuleShell, DataList, FormDialog, KpiCard). |
| react-leaflet / OpenStreetMap | **Google Maps** — `trip-map-view.tsx` and `google-maps-loader.ts` already exist; the geofence picker uses a draggable circle on it. |
| Cloud Functions callables | **Next API routes on the Admin SDK** (`/api/fleet/*`), in the Bill Tracking / Trip Claims pattern: one route wrapper, zod-parsed input, transactions, role checks. |
| Firestore triggers (`onTripWritten`, …) | Post-write steps inside the same API call, plus a nightly reconciliation job. No Cloud Functions deployment exists. |
| Cloud Scheduler → scheduled functions | Cloud Scheduler → **fail-closed cron routes** (`Bearer CRON_SECRET`), added to `scripts/setup-cloud-scheduler.sh`. |
| exceljs / pdfmake | `exceljs` (installed; `src/lib/report-excel.ts` `buildWorkbookBuffer`) and **pdf-lib** (installed) for the PDF. No new dependency. |
| nodemailer via SMTP | `sendEmail()` in `src/lib/mail.ts` (SMTP already configured). |
| WhatsApp / MSG91 behind `messaging.send()` | The adapter is built; channels today: **push (FCM, existing) + email**. WhatsApp/SMS plug in when a provider and keys are given. |
| Custom claims for roles | The app's permission registry + linked driver records + per-vehicle approvers (§6). |
| Zod shared package | `src/lib/fleet/*` — pure TypeScript, Zod schemas, node-tested (as `src/lib/employee-trips`). |
| Vitest + emulator tests | `node --test` (strip-types) for pure logic, and the **in-memory Firestore harness** (`tests/helpers/fake-firestore.mjs`) for API flows — the local env points at production, so no live test data. |

## 3. Existing pieces reused (extend, never duplicate)

| Spec collection | Existing | Plan |
| --- | --- | --- |
| `vehicles` | `vehicleManagementVehicles` (Vehicle Master) | **Extend** with fleet fields (§5.1). `currentOdometerKm` *is* `lastOdometer`; `vehicleStatus` *is* status. |
| `drivers` | `vehicleManagementDriver` (Driver Master; `linkedUserId`, `assignedVehicleId`) | **Extend** (override counter). |
| `projects` | `projects` (`projectName`, `siteCode`, `clientName`, `status`) | **Extend** with `siteGeofenceIds`; project code = `siteCode` (assumption — confirm). |
| `trips` + `points` | `vehicleManagementTrips` + `vehicleManagementTripLocations` (the fleet trip register that Vehicle Management › Trip Management and GPS Trip Log read; nothing has written new ones since 2026-10-24) | **Extend and revive** as the fleet trip, written only by the API. Points stay a flat collection keyed by `clientPointId`. |
| `fuelEntries` | `vehicleManagementFuelLogs` (`fillType` Full Tank/Partial/Top-Up, bill URL, mileage) | **Extend**; creation moves behind the API so mileage and flags are server-computed. |
| `auditLog` | `userLogs` via `logServerActivity` | **Reuse** with `{ before, after }` in `details`. No new collection. |
| Approvals with escalation | Insurance workflow escalation, `working-hours.ts` | Pattern reused; **new** `fleetApprovals` collection (the claim workflow is a different thing). |
| Rates per km | Trip-claims rate card (by vehicle type, own/company) | Fleet cost uses the **vehicle's own `ratePerKm`** (spec §5.2); the claims rate card stays for reimbursement. |
| Daily km "limit" | Trip claims `maxKmPerDay` only *flags* | Fleet limit **blocks** until approved; claims unchanged. |

**New collections:** `fleetGeofences`, `fleetPurposes`, `fleetApprovals`, `fleetDailySummary`,
`fleetPaymentReports` (+ row subcollections), `fleetSettings`. All server-only in `firestore.rules`.

**The one overlap to settle:** My Trips' GPS recorder (added 2026-10-24) also records *company*-vehicle
trips as claim drafts. With this build, company-vehicle running belongs to the fleet trip (§5.3), and
My Trips should take personal vehicles only — see decision D1.

## 4. Roles

| Spec role | Here |
| --- | --- |
| driver | A login linked to a Vehicle Master driver record (as today). |
| manager | The vehicle's **approver** (new `approverUid` on the vehicle), else the driver's **reporting authority** (Access Management / greytHR, as trip claims). A backup approver per vehicle for escalation. Being assigned is the authority — no role permission needed. |
| admin | `Vehicle Management · Fleet Settings · Edit` (masters, limits, geofences, baselines, force-close). |
| accounts | `Vehicle Management · Fleet Reports · View / Approve for Payment`. |

## 5. Data model (additions)

Every new document carries `createdAt/By`, `updatedAt/By`, `deletedAt` (soft delete), ISO strings
in UTC; "today" is computed in Asia/Kolkata (`dateKey`). Zod schemas in `src/lib/fleet/schemas`.

### 5.1 Vehicle (`vehicleManagementVehicles`, new fields)

`fleetCategory` (bike/car/pickup, derived from `vehicleType` unless set), `tankCapacityL`,
`stdMileageKmpl`, `mileageTolerancePct` (10), `dailyKmLimit` (car 120 / bike 80),
`monthlyKmLimit` (2500), `costBasis` (`per_km` | `fixed_plus_fuel`), `ratePerKm`,
`fixedMonthlyCost`, `homeGeofenceId`, `approverUid`, `backupApproverUid`,
`odometerBaselineHistory[]`, `serviceIntervalKm` (5000), `lastServiceKm`, `lastServiceDate`,
`siteInternalExemptFromLimit`, `currentTripId` (**the one-running-trip lock**).
Edited in a new "Fleet" section of the Vehicle Master form.

### 5.2 Geofence (`fleetGeofences`), purpose (`fleetPurposes`), project link

As spec §5.5–5.6. Purposes seeded: Site visit, Material delivery, Client meeting, Office transfer,
Fuel fill, Service / repair, Other (reason required).

### 5.3 Fleet trip (`vehicleManagementTrips`, extended)

Spec §5.7 fields on the existing document (`driverId`, `vehicleId`, `tripStatus` keep their names;
new statuses `running` | `paused` | `completed` | `pending_review` | `cancelled` map from the old
`In Progress` / `Completed` / `Cancelled`): `projectId`, `purposeId`, `purposeReason`, `dateKey`,
start/end geofence, start/end odometer + photo + OCR raw + confirmed, `expectedKm`,
`gpsDistanceKm`, `odoDistanceKm`, `billableDistanceKm`, `billableSource`, `pointCount`,
`lastPointAt/Lat/Lng`, `flags{…}`, `approvalId`, `approvedKmCap`, `isEmergency`, `siteInternal`,
`chainPrevTripId`, `costSnapshot`, review fields, `clientEndId`.
Points (`vehicleManagementTripLocations`): doc id = `clientPointId`; geofence events in
`vehicleManagementTripGeofenceEvents` (doc id = `clientEventId`).

### 5.4 Approvals, fuel, summaries, reports

`fleetApprovals` as spec §5.10. Fuel log new fields as §5.11 (`fullTank` = `fillType === 'Full Tank'`,
`paidBy` from `paymentMode`). `fleetDailySummary/{vehicleId_dateKey}` as §5.12.
`fleetPaymentReports/{YYYY-MM}` with `reportA…D` row subcollections as §5.13.

### 5.5 Invariants (server, in transactions — spec §5.17)

One running trip per vehicle (`currentTripId`); odometer never regresses without a baseline;
billable = odometer km when |GPS − odo| ≤ max(3 km, 5 %), otherwise `pending_review` until a
manager picks; end-trip idempotent on `clientEndId`; points idempotent on `clientPointId`;
soft delete only.

**Indexes:** queries are designed single-field (e.g. `flagged == true`, `flagCodes array-contains`,
`dateKey ==`) so nothing waits on composite indexes being created in production (they are not
auto-deployed). Any composite index needed is listed in the phase PR and created by hand.

## 6. API ("callables") and scheduled jobs

`/api/fleet/…` (Admin SDK, zod, role + ownership checks, audit row on every mutation):
`trips/start`, `trips/[id]/points` (≤200/batch), `trips/[id]/geofence-events`, `trips/[id]/end`,
`trips/[id]/review` (pick billable), `trips/[id]/force-close`, `approvals` (raise over-limit),
`approvals/[id]` (approve / approve with cap / approve and raise limit / reject),
`trips/emergency-start`, `fuel` (create), `exceptions/[id]/resolve`, `vehicles/[id]/baseline`,
`reports/generate`, `reports/[id]/approve`, `uploads` (photo; compressed client-side to 1600 px).

Cron routes (Cloud Scheduler, IST): approvals escalate + expire (every 5 min), idle-trip check
(15 min), split trips at midnight (23:58), daily summary (00:30), monthly report (06:00 on the 1st),
daily digest (08:00), service-due check (daily). All fail-closed on `CRON_SECRET`.

## 7. Screens

**Driver (SEL Driver app / phone):** Fleet home (today's km vs limit, start trip) · Start trip
(vehicle, project, purpose, expected km, odometer photo) · Over-limit request · Active trip (live
map, geofence arrivals, pause) · End trip (odometer photo, remark) · New fuel entry (bill + odometer
photos, full tank) · My fleet trips + trip map.
**Manager:** Fleet approvals inbox + request detail (today's trips attached) · Review mismatched
trips · Team vehicles.
**Admin / accounts (web):** Fleet overview dashboard · Exceptions · Masters (fleet fields on
Vehicle Master, Geofences with map picker, Purposes, project–geofence links, limits) · Reports
(Payment report, Project running, Vehicle running, Fuel register, Approval log).

## 8. Phases (proposed — the spec's own phase list was not included)

Each phase: one branch + PR, tests, `MANUAL_TEST_CHECKLIST` section, changelog entry.

**Phase 0 — prerequisites (small):** fix the two defects found while surveying — a GPS trip cannot
be saved when "odometer required" is on (the readings are hidden but demanded), and GPS km uses raw
rather than filtered points; settle decisions D1–D6.

**Phase 1 — trips, geofences, limits, approvals.** Masters (vehicle fleet fields, geofences + picker,
purposes, project links) · server-authoritative start/end with the vehicle lock · project + purpose
· odometer photos (+ OCR per D2) and the GPS/odometer cross-check with manager review · points sync
with the offline queue · geofence arrival/departure · daily-limit check, over-limit approval,
escalation, expiry, emergency override · idle / midnight-split / 12-hour jobs · live and trip maps ·
Vehicle Management Trip Management and GPS Trip Log read the new fields.

**Phase 2 — fuel and mileage.** Fuel through the API with mandatory bill + odometer photos ·
full-to-full mileage vs standard, expected fuel · flags (low mileage, unexplained fill, rate
variance, no trip between fills) · Exceptions screen and resolve · daily summary + 08:00 digest ·
service-due check against `serviceIntervalKm`.

**Phase 3 — monthly payment report.** Report A (project-wise km and cost), B (vehicle-wise km, cost,
expected vs actual fuel, mileage), C (held / flagged trips and amounts), D (driver reimbursements —
fuel paid by the driver or from a cash advance) · Excel + PDF + JSON stored and emailed on the 1st ·
custom-period runs · approve for payment (locks the report) · corrections carried to next month.

## 9. Offline and background (proposed — spec §9 not included)

Points are written to IndexedDB as they arrive and sent in batches of ≤200 when online; the server
ignores duplicates by `clientPointId`. Photos queue the same way (compressed first). Starting a trip
needs connectivity (the lock, the limit and the approval are server decisions); everything after
start works offline and syncs later. Geofence enter/exit is detected on the phone (with a 2-fix
hysteresis) and recomputed on the server from synced points, which is authoritative.

## 10. Security

All fleet collections are API-only (`serverOnly` in `firestore.rules` — needs publishing). Photos
are uploaded through the API (Admin SDK) to `fleet/odometer/…`, `fleet/fuel/…`, `fleet/baselines/…`,
`fleet/reports/…`, and `storage.rules` gains an exclusion for `fleet/**` (the current catch-all lets
any signed-in user read unlisted paths). Every route checks role and ownership.

## 11. Decisions needed before Phase 1

> Applied 2026-10-25: every recommendation below was taken as the default (ASSUMPTIONS.md 17–25).

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Company-vehicle trips: fleet trip only (My Trips becomes personal vehicles only)? | **Yes** — one record per company-vehicle run, billed to a project; claims stay for personal vehicles. |
| D2 | Odometer OCR: Google Cloud Vision on the server / native ML Kit (new APK) / photo + typed reading only | **Cloud Vision** — works in the existing app and browser, no APK release; about ₹0.13 a photo after the first 1,000 a month (Google's list price); needs the Vision API enabled on the Firebase project. |
| D3 | Project code: use `projects.siteCode`, or add a `code`? | Use `siteCode`. |
| D4 | Manager of a vehicle: per-vehicle approver, falling back to the driver's reporting authority? | Yes. |
| D5 | WhatsApp/SMS provider and keys (spec `<<FILL>>`) | Push + email now; add the provider when keys are ready. |
| D6 | The spec's missing §8+ (phases, offline, reports A–D, screens, notifications) | Paste them, or accept §8–9 above. |

## 12. Risks

- **Another session is changing Driver Management right now** (GPS recorder, all-trips register,
  trip form). Phase 1 touches the same area; work should be coordinated or serialised.
- **Background tracking on Android** depends on battery-optimisation exemptions per phone; drivers
  get a guided setup screen, and idle/gap detection flags trips with long silences.
- **Firestore rules, Storage rules, indexes and Cloud Scheduler jobs are deployed by hand** in this
  project; each phase lists exactly what to publish.
- **Production data**: the local environment talks to production Firestore. All server flows are
  tested against the in-memory harness; nothing is seeded into production without approval.
