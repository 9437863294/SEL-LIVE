# SEL Fleet — assumptions and departures from the spec

Spec §0: where the existing repository differs from the spec, adapt and record it here. Each entry
says what the spec asked, what this build does, and why.

**Decisions D1–D6** ([PLAN.md §11](PLAN.md#11-decisions-needed-before-phase-1)) were not answered
individually: the owner approved the plan with "build all" on 2026-10-25, so the recommended
default was applied for each. Entries marked **(D*n*, default applied)** record them; each is a
setting or a small change if the owner wants it otherwise.

## Stack and layout

1. **No new monorepo** (spec §3–4). The fleet system is built inside the existing Next.js app: pure
   logic in `src/lib/fleet/`, server code in `src/lib/fleet/server/` and `src/app/api/fleet/`,
   screens in Driver Management (driver, manager) and Vehicle Management (admin, reports). A second
   app beside this one would duplicate the vehicle and driver masters, auth and design system.
2. **No Expo app.** The SEL Driver Android app already exists as a Capacitor WebView of the live
   site, with background geolocation, camera, network and push plugins. Driver and manager screens
   are responsive web pages it shows, so **no APK update is needed**.
3. **No Cloud Functions.** Callables are Next API routes on the Admin SDK; triggers are post-write
   steps in those routes; schedules are Cloud Scheduler jobs calling one fail-closed cron route,
   `/api/fleet/cron/[job]` — the pattern Bill Tracking, Office Hub and Mail Hub already use.
4. **Google Maps, not Leaflet** — the app's maps (`trip-map-view.tsx`) and keys already exist.
5. **pdf-lib instead of pdfmake** — pdf-lib is installed; no new dependency for the PDF. Its
   standard Helvetica cannot draw "₹", so the PDF reads "Rs."; the Excel file uses ₹.
6. **Docs live in `docs/fleet/`**, not `docs/` — the repository holds many modules' documents.
7. **Tests:** `node --test` with type stripping and the in-memory Firestore harness
   (`tests/helpers/`), not Vitest and the emulator — the emulator is not set up for app code here,
   and the local environment's credentials reach production. The harness stubs Storage, email and
   the company profile too.
8. **"One PR per phase"**: the owner asked for all phases at once ("build all"), so Phases 0–3 were
   built together on 2026-10-25 and land as one commit series; the PR is opened from GitHub (the
   `gh` CLI is not installed here).

## Data model

9. **Existing collections are extended, not replaced** (spec §0 "never duplicate"):
   `vehicleManagementVehicles`, `vehicleManagementDriver`, `projects`, `vehicleManagementTrips`,
   `vehicleManagementTripLocations`, `vehicleManagementFuelLogs`. Spec names map: `lastOdometer` =
   `currentOdometerKm`; vehicle `status` = `vehicleStatus`; fuel `fullTank` = `fillType ===
   'Full Tank'` (both are written); fuel `paidBy` is its own field.
10. **Trip status: a new `status` field beside the old `tripStatus`.** The spec's statuses
    (`running`, `paused`, `completed`, `pending_review`, `cancelled`) are on `status`; `tripStatus`
    is kept as a mirror (running/paused → In Progress, completed/pending review → Completed,
    cancelled → Cancelled), together with `startTimeIso`, `endTimeIso`, `startAddress` / `endAddress`
    (the start and end geofence names), `totalDistanceKm` (billable km, else GPS km), `totalPoints`,
    `lastLocationLat/Lng` and `linkedUserId`. Trip Management, the Vehicle Management overview's month
    figures, the driver panel and Vehicle Master's "has trips" check read fleet trips unchanged. A
    fleet trip carries `fleet: true`.
11. **Trip points stay a flat collection** (`vehicleManagementTripLocations`, doc id
    `{tripId}_{clientPointId}`) instead of a `points` subcollection, so the existing readers keep
    working. Device-reported geofence events go to `vehicleManagementTripGeofenceEvents`; the
    server's own recomputation (the record) is stored on the trip as `geofenceEvents` and `visits`.
12. **Audit:** the app's `userLogs` (via `logServerActivity`) with `{ before, after }` in `details`,
    not a separate `auditLog` collection.
13. **Timestamps are ISO strings** (as the existing server modules), compared and stored in UTC;
    `dateKey` is the Asia/Kolkata date and `monthKey` its month. Fuel log `createdAt` /
    `updatedAt` stay Firestore timestamps, as the Vehicle Management fuel register writes them
    (`createdAtIso` carries the ISO form).
14. **Roles are not custom claims.** Drivers are linked Driver Master records (or any employee, see
    30); managers are the vehicle's approver, its backup or the driver's reporting authority; admin
    and accounts are grants in the permission registry: `Vehicle Management · Fleet Trips` (View,
    Review, Force Close, Export), `Fleet Reports` (View, Generate, Approve for Payment) and `Fleet
    Settings` (View, Edit; Vehicle Management · Settings · Edit also edits them).
15. **Exceptions query:** `exceptionStatus` (`none` / `open` / `resolved`) and a `flagCodes` array on
    trips and fuel logs replace one composite index per flag (indexes are created by hand in this
    project). Every fleet query is single-field — see [DEPLOY.md](DEPLOY.md#indexes).
16. **Fleet cost uses the vehicle's own `ratePerKm`** (spec §5.2). The trip-claims rate card (by
    vehicle type, own/company) is a separate thing — employee reimbursement — and stays as it is.
    A **fixed-plus-fuel** vehicle has no per-trip cost; its month cost is `fixedMonthlyCost` (× the
    months in the period) plus its fuel in the period, shared over projects by billable km; a pooled
    vehicle with no km in the period is charged to "No project".
17. **(D1, default applied)** Company-vehicle trips are fleet trips; My Trips takes personal
    vehicles. Built as a setting, Settings › Fleet "Company-vehicle trips are fleet trips"
    (`companyTripsInFleet`, on by default): while it is on, the trip-claims bootstrap reports
    company vehicles as off (the form offers own vehicles only), a new company-vehicle trip is
    refused with a pointer to Fleet Trip, and Trip rules says the switch there has no effect.
    Company-vehicle drafts recorded before stay editable, claimable and deletable.
18. **(D3, default applied)** Project code = `projects.siteCode`.
19. **(D4, default applied)** A vehicle's approver is its `approverUid`, else the driver's reporting
    authority (Access Management first, then greytHR — as trip claims). Who manages a trip is frozen
    on it at the start (`managerIds`: approver, backup, and the reporting authority when there is no
    approver); the escalation list in Settings › Fleet manages every trip.
20. **Purposes are seeded, not written, until the first save.** Until an admin saves a purpose, the
    seven spec purposes are offered from code with stable ids (`default-site-visit`, …); the first
    save writes them all, so trips that used a seeded purpose keep pointing at a real record.

## Behaviour

21. **Starting a trip needs a connection** — the vehicle lock, the daily limit and the approval are
    server decisions. After the start, points, geofence events, photos and the end queue offline on
    the phone and sync later (spec §9 not supplied; see PLAN.md §9). The phone's own end time is
    taken when it lies between the start and five minutes from now.
22. **Geofence events** are detected on the phone with a two-fix hysteresis and a 25 m exit margin,
    and recomputed on the server from the synced points at the end; the server's result is the
    record (`geofenceEvents`, `visits`, end geofence). A vehicle exempt from the limit that starts and
    ends in the same project site, crossing no other fence, is **site-internal** and not counted
    toward its daily limit.
23. **(D2, default applied)** Odometer OCR is Google Cloud Vision on the server, behind Settings ›
    Fleet "Read odometer photos" (`ocrEnabled`, **off** until the Vision API is enabled). It uses
    `GOOGLE_CLOUD_VISION_API_KEY` when set, else the Firebase service account. OCR only suggests a
    reading — the plausible number not below the vehicle's last reading; the driver always confirms
    it, both figures are kept, and a difference of 1 km or more flags the trip. Without OCR, the
    photo and the typed reading are both mandatory. Photos are mandatory at the start and end of a
    trip and for a fill-up (bill + odometer; a bill may be a PDF), at most 6 MB each.
24. **(D5, default applied)** The messaging adapter's channels today are push (FCM, the app's
    notification engine) and email. A message that asks for WhatsApp or SMS is delivered by email
    as well, so nothing is dropped, until a provider and keys are supplied (`sendFleetMessage` in
    `src/lib/fleet/server/notify.ts`).
25. **(D6, default applied)** The spec's missing §8+ were replaced by PLAN.md §8–9. **Reports A–D**
    follow spec §2 item 6: A project-wise, B vehicle-wise with expected vs actual fuel, C held and
    flagged trips, D driver reimbursements.
26. **Images** are compressed in the browser to 1600 px on the long edge, JPEG 0.8 (spec §6), and
    uploaded through `POST /api/fleet/uploads`. Each upload can be attached to one record only, by
    the person who took it; it is shown through `GET /api/fleet/uploads/[id]` to that person, the
    record's managers, the escalation list and holders of the fleet grants.
27. **Midnight: km are attributed by date, trips are not split.** A trip that runs past midnight
    stays one trip; its billable km are spread over the IST days it ran in the proportions GPS
    measured (`kmByDate`, flag `crossed_midnight`), so each day's limit counts the running done on it.
    At 23:58 the midnight job writes open trips' km so far by day; the end measures it all again.
28. **The daily limit** counts settled billable km by day, plus a running trip's live GPS km.
    Starting a trip that would take the day past it needs approval first. The allowance is per
    vehicle per day (whoever drives): approve allows what was asked on top of the day's km so far,
    approve-with-cap allows a stated km, approve-and-raise also lifts the vehicle's `dailyKmLimit` for
    good. An approved request is good for that day only. A waiting request moves up a level every
    30 minutes (approver → backup → escalation list; empty levels skipped; everyone reached may still
    decide) and expires two hours after it was raised. Fleet Trips · Review acts as an override.
    Nobody decides their own request.
29. **Emergency starts** past the limit without approval are counted per driver per calendar month
    (two by default) and tell the trip's managers and the escalation list by push and email.
30. **Who drives:** Driver Master drivers, or any active employee while Settings › Fleet "Any
    employee may drive" (`anyEmployeeMayDrive`) is on — the default, because D1 moved company-vehicle
    running out of My Trips, which every employee could use. The same rule decides who enters fuel.
31. **The odometer never goes backwards.** A start reading below the vehicle's last one is refused;
    a replaced or reset meter is an admin's **baseline** (Settings › Fleet › Vehicles; the last 20
    are kept, with the reason and an optional photo), not a driver's typing. A start reading more
    than 5 km above the last one flags `unlogged_km`.
32. **Billable km:** the odometer, when GPS agrees within max(3 km, 5 %); otherwise the trip waits
    as `pending_review` and a manager picks the odometer, GPS or their own figure (a note required
    for their own). With fewer than three usable fixes the odometer stands, flagged `no_gps`.
33. **A manager's force-close with a closing reading is not held for review**: the trip settles as a
    driver's end would (`endedBy: 'force'`, the reason kept). Without a reading GPS stands and the
    trip is flagged `auto_closed` and held for review — as are trips the idle job closes (no fix for
    `idleAutoCloseMinutes`, three hours by default, twice that while paused) or that run past
    `maxTripHours` (12).
34. **Late points:** points are accepted up to 48 hours after a trip ended (a phone flushing its
    queue late) and re-settle the trip — until a manager has reviewed it, or an approved payment
    report has counted it.
35. **A trip started by mistake** can be cancelled in its first 15 minutes, before 30 fixes; the
    approval it used becomes usable again that day.
36. **Fuel** goes through `POST /api/fleet/fuel` with both photos, dated within the last 7 days
    (older fill-ups are entered by the fleet office on Vehicle Management › Fuel). Mileage is full
    tank to full tank over every fuel log of the vehicle (fleet, Fuel register and Site Account
    entries alike). Older entries carry only a payment mode, which does not say whose money it was:
    they count as the company's, and only entries marked "driver paid" or "cash advance" appear in
    Report D.
37. **Payment reports.** Rows are kept on the report document up to 2,000 per section (a month is
    far below that); the Excel, PDF and JSON files in Storage always carry every row. A custom
    period is a preview: never approved, it marks nothing. Approving a month's report locks it and
    marks every trip it paid `reportedIn`, so no later report pays a trip twice; a trip settled after
    its month was approved is carried into the next report (Report A counts it under "carried").
    The scheduled run (06:00 on the 1st, retried on the 2nd and 3rd) never regenerates a month that
    already has a report, and an approved report cannot be regenerated at all.
38. **Duplicate pages removed (2026-10-25, owner's request).** Each now lives in one place, and the
    old address redirects (`next.config.ts`, not permanent, so installed driver apps follow):
    - GPS Trip Log (`/driver-management/trip-log`) → **Fleet Trip**, which lists the driver's trips.
    - Fleet Approvals (`/driver-management/fleet/approvals`) → **Approvals**, one inbox with tabs:
      trip claims, company-vehicle requests, trips to review.
    - Trip Management (`/vehicle-management/trips`) → **Fleet Control › Fleet Trips**, the register
      of every company-vehicle trip. Trips recorded before SEL Fleet (the old browser tracker) are
      listed there read-only, tagged as such. The old grant `Trip Management · View` still opens it.
    - Settings › Trip Tracking (location interval, background hint) → Settings › Fleet: nothing read
      those settings after the old tracker went.
39. **Browsers no longer write trips or points.** The database rules close client creates and
    updates of `vehicleManagementTrips` and creates of `vehicleManagementTripLocations` (the distance
    correction left with Trip Management); every fleet collection is server-only. These rules are in
    the repository file and must be merged into the live rules by hand (DEPLOY.md).
40. **One vehicle register for the installation.** Vehicles, drivers and projects are not scoped by
    organisation, so the installation-wide jobs (digest, service due, monthly report) use the primary
    organisation's fleet settings: the only fleet settings document, else `default`.
41. **A fleet trip is captured exactly as a GPS trip** (owner's request, 2026-10-25): the same live
    recording card as My Trips › Drive & record (Distance / Moving / Stopped / Fixes, the route drawn
    fix by fix, the starting place reverse-geocoded and editable, Stop & review with the ending
    place), one shared component for both. On top of it the fleet adds what a company vehicle
    needs: the limit, approvals, odometer photos, purposes and projects, offline sync, geofences.
    A fleet trip is **not claimable** — it is billed to the project; the screens say so.
42. **Fleet Trip is the one place a trip is recorded** (owner's request, 2026-10-26). My Trips no
    longer has "Type it in" or "Drive & record"; Fleet Trip has one **Start a trip** button that asks
    "Which vehicle are you using?" (a prompt, not tabs left selected on the page), because the two
    are separate calculations:
    - **Own vehicle** — the GPS trip recorder (locked to own vehicles there) drives & records the
      trip and saves it to My Trips as an unclaimed trip, priced per km from the trip-claims rate
      card; My Trips lists, edits and claims it.
    - **Company vehicle** — the fleet trip (limit, approvals, odometer photos, project billing).
    Only one trip runs at a time on the screen. Fleet Trip is in everyone's menu (and the phone's
    second tab). The server holds the same line: a new trip without GPS evidence is refused unless
    Trip Settings › Rules "Trips may be typed in" is on (off by default — `allowTypedTrips`);
    editing a trip already recorded is always allowed.
43. **The module is shown as "Fleet & Travel"** (owner's request, 2026-10-26; it was "Driver
    Management"). Only the on-screen name changed (`src/lib/module-display-names.ts`): the Module
    Hub card, the module header, breadcrumbs, the Overview, notification chips and the profile's
    module chips. The key stays `Driver Management` — it names the permissions roles hold, the
    activity log and notification rows, and each user's saved Module Hub layout — and the address
    stays `/driver-management`, which the SEL Driver Android app opens.
44. **A trip starts from the employee's own project** (owner's request, 2026-10-26).
    - **Source category:** which greytHR category says an employee's project is a setting. It is
      "Project Name" by default, and can be "Project Division" or any other mirrored category. It
      is chosen on Employee › Category, from the panel's "Employees' projects come from" picker or
      with "Use for projects" on any type, and kept in `employeeProjectSettings/default`.
    - **Links:** each value of that category is linked to the app's project(s) in Settings ›
      Projects. One value may cover several, such as a site and its sub-divisions.
    - **Storage:** links are kept per category in `employeeProjectLinks`, tagged with their
      category, so switching the source and back loses nothing. Both collections are server-only,
      because the greytHR sync rewrites the category documents themselves.
    - **Pickers:** Fleet Trip's and the own-vehicle trip's project pickers list the employee's
      projects first, marked "Your project", and pre-select one when there is exactly one.
    - **Restriction:** Settings › Fleet "Trips list only the employee's projects"
      (`employeeProjectsOnly`, off by default) limits the choice to them, and the server refuses
      another. Someone with no linked project still sees every project.
    - **Lookup:** login → `users.employeeId` → `employees/{id}.categories[source]` → links,
      matched by name ignoring case and spacing.
45. **A trip's project is a value of the source category, not a Settings › Projects record**
    (owner's request, 2026-10-27). It replaces the picker of 44.
    - **List:** both start sheets (own and company vehicle), typed trips, the save checks, a
      claim's project name and Workflow's per-project approvers list the source category's values.
      Here that is Project Division: Head Office, Rayagada, Aradi… (35 values).
    - **Why:** most divisions have no Settings › Projects record, so links left most employees with
      nothing to pre-select.
    - **No link needed:** the employee's own value is pre-selected and listed first. A trip's
      `projectId` is the value's category document id (`tripProjectOptions` /
      `employeeTripProjectIdsOf` in `src/lib/employee-projects/server.ts`).
    - **Links still matter:** a value linked to Settings › Projects lends the first linked project's
      site code, which payment reports print.
    - **Unchanged:** Settings › Projects (`fleetProjects`) stays the list for geofences, Vehicle
      Master's assigned project and the reports' project lookup. A report row falls back to the
      name and code stored on the trip.
    - **Old records:** an old draft keeps the project it was saved with when edited; choosing
      another must be a listed value. At the switch, no own-vehicle trip and 1 of 21 fleet trips
      had a project, and no approval stage routed by project.
