# SEL Fleet — deployment steps

What has to be done by hand when the fleet build goes live. Rules, indexes and schedules are not
auto-deployed in this project, and the local environment talks to production, so each step below is
a deliberate act by whoever runs the deployment. Nothing here needs a new SEL Driver APK: the app is
a WebView of the live site, and its location, camera and push plugins are already in it.

Order matters: deploy the code first (1), then close the rules (2–3) — the rules refuse browser
writes the old pages used to make, and the new pages make none.

## 1. Code

Deploy the app as usual (seltech.store). No new environment variable is required:

| Variable | Use | Needed |
| --- | --- | --- |
| `CRON_SECRET` | The fleet cron route fails closed without it (as every cron route here). | Already set |
| `SMTP_*` | Payment report and digest emails, escalation emails (`src/lib/mail.ts`). | Already set |
| `GOOGLE_CLOUD_VISION_API_KEY` | Odometer OCR (§6). Without it, OCR uses the Firebase service account. | Optional |

## 2. Firestore rules

The repository's `firestore.rules` is **not the whole live ruleset** (see the project notes:
publishing it whole once locked everyone out). Read the live rules first (Firebase console, or the
Rules API), then merge in exactly these changes:

**`serverOnly(...)` — add** (every read and write goes through `/api/fleet` on the Admin SDK):

- `fleetApprovals`, `fleetDailySummary`, `fleetGeofences`, `fleetPaymentReports`, `fleetPurposes`,
  `fleetSettings`, `fleetUploads`, `vehicleManagementTripGeofenceEvents`
- `fleetJobRuns` — once-only markers the scheduled jobs write (the morning digest and the
  service-due check), so a re-run of the same job on the same day sends nothing twice.

**`match /vehicleManagementTrips/{tripId}` — replace `create` and `update`** (reads unchanged):

```text
allow create: if false;
allow update: if vmTripManager() && resource.data.get('fleet', false) != true
  && vmChanged().hasOnly(['totalDistanceKm', 'totalPoints', 'updatedAt']);
```

**`match /vehicleManagementTripLocations/{pointId}` — replace `create`** (reads unchanged):

```text
allow create: if false;
```

The emulator tests in `tests/firestore-rules` (`stage1`, `stage2-vm`) cover these; run them
serially (`npm test` in that folder, `--test-concurrency=1`) before publishing.

## 3. Storage rules

`storage.rules` is deployed from the repository (`firebase deploy --only storage`). It gains:

- `match /fleet/{allPaths=**} { allow read, write: if false; }` — odometer and bill photos and
  payment reports, written and read only through `/api/fleet`;
- `&& !allPaths.matches('fleet/.*')` in the catch-all, without which any signed-in user could read
  those files by guessing a path.

## 4. Scheduled jobs

`scripts/setup-cloud-scheduler.sh` adds seven jobs, all `GET /api/fleet/cron/<job>` with
`Authorization: Bearer $CRON_SECRET`, in Asia/Kolkata time. Run it with `--dry-run` first; it creates
or updates each job, so re-running is safe.

| Job | Schedule (IST) | What it does |
| --- | --- | --- |
| `fleet-approvals` | every 5 min | Over-limit requests move up a level every 30 min; expire at 2 h. |
| `fleet-idle` | every 15 min | Reminds silent trips; closes those silent too long, or past 12 h, for review. |
| `fleet-midnight` | 23:58 | Open trips' km so far, split by day, for the next day's limit. |
| `fleet-daily-summary` | 00:30 | Yesterday's `fleetDailySummary/{vehicleId}_{date}`. |
| `fleet-service-due` | 07:00 | Vehicles within 300 km of their next service, or past it. |
| `fleet-digest` | 08:00 | Yesterday in numbers to the digest and escalation lists. |
| `fleet-monthly-report` | 06:00 on the 1st | Last month's payment report, emailed (retried on the 2nd and 3rd). |

Never curl these locally without care: with `CRON_SECRET` set they really run against production.

## 5. Indexes

**No composite index is needed.** Every fleet query is a single-field one, which Firestore indexes
automatically (none of these fields is exempted in `firestore.indexes.json`):

- `vehicleManagementTrips`: `dateKey ==` / `in` / `>=`, `driverUserId ==`, `vehicleId ==`,
  `status in`, `managerIds array-contains`, `exceptionStatus ==`, `reportedIn == null`,
  `clientStartId ==` (with `limit(1)`).
- `vehicleManagementTripLocations` and `vehicleManagementTripGeofenceEvents`: `tripId ==`.
- `fleetApprovals`: `vehicleId ==`, `driverUserId ==`, `status ==`, `dateKey ==`,
  `notifiedIds array-contains`.
- `vehicleManagementFuelLogs`: `vehicleId ==`, `enteredByUserId ==`, `clientEntryId ==`,
  `exceptionStatus ==`, `fuelDate ==` / `>=`.
- `fleetUploads`: `attachedId ==`.

`reportedIn == null` matches only documents that have the field; the server writes `reportedIn:
null` on every fleet trip, so this holds. If a query ever fails with "requires an index", create the
index it names by hand — do not let `firebase deploy` sync `firestore.indexes.json`, which would
delete the indexes production has that the file does not.

## 6. Odometer OCR (optional — decision D2)

1. Enable the **Cloud Vision API** on the Firebase project (Google Cloud console › APIs & Services),
   with billing on. Google's list price is about ₹0.13 a photo after the first 1,000 a month.
2. Either set `GOOGLE_CLOUD_VISION_API_KEY` (an API key restricted to the Vision API), or let the
   server use the Firebase service account — if Vision then answers 403, grant that account
   `roles/serviceusage.serviceUsageConsumer`, or use the key.
3. Turn on **Vehicle Management › Settings › Fleet › Read odometer photos automatically (OCR)**.

OCR only ever suggests a reading. With it off, the typed reading and the photo stand on their own.

## 7. Permissions to grant (Access Management)

Driving and approving need **no** permission (see `src/lib/fleet/access.ts`). Grant the wider reach:

| Who | Grant |
| --- | --- |
| Fleet office / transport admin | `Vehicle Management · Fleet Settings · View, Edit`; `Fleet Trips · View, Review, Force Close, Export` |
| Accounts | `Vehicle Management · Fleet Reports · View, Generate, Approve for Payment` |
| Site / project heads who watch running | `Vehicle Management · Fleet Trips · View` |

Holders of `Vehicle Management · Trip Management · View` (the old page, now Fleet Control › Fleet
Trips) see every fleet trip too, and
`Vehicle Management · Settings · Edit` also edits the fleet settings.

## 8. First-day setup (in the app)

1. **Settings › Fleet › Rules & limits** — daily limits per category, the escalation list (someone
   must be on it, or a vehicle with no approver and a driver with no reporting authority can only
   use emergency starts), the payment report emails and the digest list.
2. **Settings › Fleet › Vehicles** — per vehicle: category, standard mileage, tank, cost basis and
   rate, approver and backup approver, last service. A blank field takes the category default.
3. **Geofences** — the office, yards, fuel stations and project sites (each project site linked to
   its project).
4. **Settings › Fleet › Purposes** — the seven defaults are offered until the first save.
5. Tell everyone: the module is now called **Fleet & Travel** (same address, same permissions —
   roles still read "Driver Management · …" in Access Management). Its **Fleet Trip** page is now
   where every trip is recorded, by GPS: **Start a trip** asks which vehicle —
   **Own vehicle** (saved to My Trips and claimed there, at the per-km rate) or **Company vehicle**
   (a fleet trip, billed to the project, not claimable). My Trips no longer records trips; it lists
   and claims them (existing company-vehicle drafts can still be claimed). It replaces the GPS
   Trip Log. Tell approvers: one **Approvals** page
   now holds claims and company-vehicle requests. Tell the transport office: Trip Management is now
   Fleet Control › **Fleet Trips**.
