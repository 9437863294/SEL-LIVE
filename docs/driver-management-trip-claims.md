# Driver Management — trip claims

Every employee records their official trips here and is paid per kilometre. Approvers and payers
are named in settings. The driver app pages (GPS trips, fuel, daily status) sit in the same module,
unchanged.

## How it works

1. **Record.** *My Trips › Record trip.* Each trip has a date, own or company vehicle, from/to,
   purpose, odometer readings (or a typed distance, if the rules allow), an optional project or
   department, and toll/parking. Company vehicles come from Vehicle Master. The server prices each
   trip from the rate card in force on the trip date and adds flags for the approver: no rate set,
   long trip, daily limit exceeded, odometer overlap, possible duplicate.
2. **Create a claim.** A trip is one journey; a claim is what gets approved and paid, and holds one
   or more trips. *Create claim* (on My Trips, My Claims and the dashboard) lists the unclaimed trips
   to tick — one, several or all; a trip's own *Claim* button claims just that trip. The trips are
   re-priced from the current rate card and frozen on a numbered claim (`TC-2026-27-0001`). If the
   workflow routes by project or department, the trips become one claim per project or department.
3. **Approve.** The claim goes first to the employee's **reporting authority**: an exception set for
   that employee in Settings › Workflow, else the reporting manager on their login (Access
   Management), else their manager in greytHR's org tree — and the stage's fallback people when none
   of those names anyone. Further levels (e.g. a director above an amount) follow. Whoever a claim
   waits for is notified. On the claim they approve,
   cut the distance of, reject, or send back each trip, or send back or reject the whole claim. Sent-back trips
   return to *My Trips* as unclaimed, with the reason, to be fixed and submitted on a new claim.
   The claimed figures are never overwritten; approved figures sit beside them.
4. **Pay.** After the last approval stage the claim waits at the payment stage. The payer records
   the date, mode and reference (UTR or cheque number, unless cash or payroll) for one claim, or for
   several at once from *Payments*.

Nobody acts on their own claim. The claimant can withdraw a claim until someone acts on it.

## Who can do what

| Action | Needs |
| --- | --- |
| Record trips, submit, see own claims | Signed in (no permission) |
| Approve | Being the claimant's reporting authority, or named on the stage in *Settings › Workflow* (no permission) |
| Pay | Being named on the payment stage (no permission) |
| See every claim, organisation dashboard | `Driver Management · Trip Claims · View All` (the old *Employee Trip Log* View/Approve grants count) |
| CSV export | `Trip Claims · Export` with View All |
| Act for an absent assignee | `Trip Claims · Override Workflow` (recorded as an override) |
| Settings | `Driver Management · Trip Settings · View / Edit`, or `Vehicle Management · Settings · Edit` |

## Settings

- **Rates per km.** Rate cards, each in force from a date: one row per vehicle type, with an own-vehicle
  and a company-vehicle rate. A blank rate is not paid per km. To change a rate, add a card from
  the day it starts. A card that has priced a submitted claim can't be edited or deleted. Saving
  re-prices unclaimed trips.
- **Workflow & approvers.** Approval levels in order, then the payment stage. The first level goes
  to the employee's reporting authority by default (with per-employee exceptions); any level can
  instead go to the same named people for every claim, or be routed by project or department. Every
  level names fallback people for claims its routing cannot place. Levels
  after the first can apply only from a claim amount up, and each stage has a time allowance after
  which a claim shows as overdue. Saving re-routes claims already in process and notifies the people
  newly named.
- **Trip rules.** Own and company vehicles allowed or not, odometer required, toll and parking,
  project required, the claim window (days) and the flag limits.

## Code

- Pure rules, tested: `src/lib/employee-trips/` — `rates.ts`, `trips.ts` (validation, flags),
  `workflow.ts` (stages, routing, who may act, decisions), `access.ts`, `schemas.ts`.
- Server (Admin SDK; the browser never touches these collections): `src/lib/employee-trips/server/`
  and `src/app/api/driver-management/*`.
- Screens: `src/components/driver-management/trips/`; pages under
  `src/app/(protected)/driver-management/`. The driver app's screens (My Vehicle, Live GPS Trip, GPS
  Trip Log, Fuel Entries — company vehicles only) are in `src/components/driver-management/driver-app/` and
  exist only here: their old `/vehicle-management/driver-mobile/*` copies, the Driver Mobile hub
  (now the Overview's driver panel), Driver Management's copy of Trip Management, the old
  Employee Trips page and the retired Daily Status page are redirects in `next.config.ts` (Daily
  Status's old logs stay in `vehicleManagementDriverDailyStatus`; Driver Master still counts them as
  history when a driver is deleted). Driver APKs now start at `/driver-management`.
- The reporting line is read by `reportingAuthorityOf` in `server/lookups.ts` (Access Management's
  `accessGrants.reportingManagerId`, then greytHR's `employees/{employeeId}.reportingManagerEmployeeId`)
  and frozen on each claim as `reportingAuthorityIds`, which re-routing reuses.
- Collections: `employeeTripRecords`, `employeeTripClaims`, `employeeTripSettings` (one document per
  organisation), `employeeTripCounters`. Every query uses a single field, so no composite index is needed.
- Tests: `npm run test:driver-management` runs the domain tests, plus an end-to-end flow over the real
  server modules against an in-memory Firestore (`tests/helpers/fake-firestore.mjs`, loaded through
  `tests/helpers/server-module-hooks.mjs`). Typecheck: `npm run typecheck:driver-management`.

## Going live

1. Deploy the code.
2. Publish `firestore.rules`. It lists the four collections under `serverOnly`; until it is
   published, the catch-all still lets any signed-in browser read and write them directly.
3. In *Settings › Rates per km*, add the first rate card. Until then trips are recorded at ₹0 per km.
4. In *Settings › Workflow & approvers*, name the fallback approvers (for employees with no reporting
   manager on record) and the payers. Until then such claims wait for nobody; saving the workflow
   routes them. Check that greytHR's org tree is synced (Employee module) or that reporting
   managers are set in Access Management — that is who approves.
5. Grant *Trip Claims · View All* (and Export, and Override for one administrator) where needed.
