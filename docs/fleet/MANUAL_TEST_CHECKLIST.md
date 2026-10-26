# SEL Fleet — manual test checklist

Run on the live site after [DEPLOY.md](DEPLOY.md), with test vehicles and a test project — the app
talks to production, so use records you can delete (soft delete) or cancel afterwards. "Phone" means
the SEL Driver Android app (and once in Chrome 109 on a Windows 7 PC for the desktop screens);
"desktop" means a current desktop browser. Check every screen at phone width (no sideways scroll,
no card wider than the screen) and in dark mode.

Set up first: one test vehicle with a low daily limit (say 10 km), an approver who is not the
driver, a backup approver, yourself on the escalation list, one office geofence and one project
site geofence around places you can drive to.

## Phase 0 — recording trips (Fleet Trip › Own vehicle) and My Trips

- [ ] My Trips has no "Type it in" and no "Drive & record"; its "Record a trip" opens Fleet Trip on
      the Own vehicle tab. Fleet Trip is in the menu for every user.
- [ ] Fleet Trip has one **Start a trip** button; it asks "Which vehicle are you using?" — Own
      vehicle (claimable) or Company vehicle (fleet). A choice not open to you says why (company
      vehicles for non-drivers, own vehicles switched off in Trip rules).
- [ ] The module reads **Fleet & Travel** on the Module Hub card, its header, breadcrumbs and
      notifications; its address and every role's permissions are unchanged.
- [ ] Own vehicle offers own vehicles only; the saved trip appears in My Trips,
      unclaimed, priced at the rate card's per-km rate, and "Create claim" claims it.
- [ ] While an own-vehicle trip records, Fleet Trip shows only it (no company start), and while a
      company trip runs, no own-vehicle start.
- [ ] Trip Settings › Rules "Trips may be typed in" off (default): an old `/driver-management/my-trips?new=1`
      link lands on Fleet Trip. Turn it on: "Type it in" comes back on My Trips.
- [ ] Phone: with Trip rules › "Odometer readings required" on, Drive & record an **own-vehicle**
      trip; on stop, the review asks for the closing reading (opening prefilled), shows "GPS
      measured … km — about …", and saves.
- [ ] With the rule off, the review offers the measured distance and saves it.
- [ ] A recording with one wild GPS fix measures the real distance (not short by the legs around
      the bad fix).
- [ ] With Settings › Fleet "Company-vehicle trips are fleet trips" on: Record a trip offers own
      vehicles only; Trip rules shows the note beside "Company vehicles"; a company-vehicle draft
      recorded before can still be edited, claimed and deleted. Turn the setting off: company
      vehicles are offered again.

## Phase 1 — trips, geofences, limits, approvals

Masters (desktop):

- [ ] Geofences: add the office and a project site on the map (drag the circle, change the radius),
      link the site to its project; edit; delete (it disappears from the list, the trip history
      keeps its name).
- [ ] Settings › Fleet › Vehicles: set category, limit, rate, approver and backup; a cleared field
      shows the category default again. The backup cannot be the approver.
- [ ] Settings › Fleet › Purposes: the seven defaults show before any save; add one, rename one,
      mark "reason required"; delete one.
- [ ] Odometer baseline: refused while a trip runs on the vehicle; with no trip, set a lower
      reading with a reason — the next trip may start from it, and is flagged "Odometer reset".

Driver (phone):

- [ ] Fleet Trip shows each vehicle's km today against its limit; your assigned vehicle first.
- [ ] Start: purpose, project (required for Site visit), expected km, odometer photo and reading.
      With OCR on, the photo's reading is offered. A reading below the last one is refused with
      the baseline hint; one well above it starts, flagged "Unlogged running".
- [ ] A second phone (another driver) cannot start the same vehicle while it runs ("… is on a trip
      with …"); you cannot start a second trip on another vehicle.
- [ ] The trip records like My Trips › Drive & record: "Starting from" fills itself from your
      location; while driving the card shows Distance / Moving / Stopped / Fixes and draws the route
      fix by fix; "Stop & review" shows the measured figures and where it ended. It says the trip is
      not claimable, and it never appears in My Trips or on a claim.
- [ ] Drive with the screen locked for 10+ minutes: the live map and km keep up; arriving at the
      project site shows an arrival; leaving shows a departure.
- [ ] Turn mobile data off mid-trip, drive, turn it back on: the queued points sync (the count of
      waiting points falls to zero), nothing is counted twice.
- [ ] Pause and resume; cancel a trip started by mistake within 15 minutes.
- [ ] End: odometer photo and reading; with GPS and odometer agreeing the trip is Completed; the
      vehicle's reading moves to the closing one.
- [ ] End offline: it waits in the queue, then completes when the connection returns, timed when
      you ended it.
- [ ] Type a closing reading 10 km off the GPS figure: the trip is "Pending review", and the
      vehicle's managers are told (push and email).

Limits and approvals:

- [ ] Starting a trip that would pass the limit offers "Ask for approval"; the approver gets push
      and email; the request shows the vehicle's trips today.
- [ ] Approve: the driver is told and can start. Approve with a cap: a trip running past the cap is
      held for review ("Beyond approved km"). Approve and raise: the vehicle's limit changes.
      Reject needs a reason.
- [ ] Leave a request undecided: after 30 minutes it reaches the backup, after 60 the escalation
      list; at 2 hours it expires and the driver is told.
- [ ] The approver cannot decide a request for a trip they drive themselves.
- [ ] Emergency start: allowed twice a month by default, managers told; the third is refused.

Manager and admin:

- [ ] Approvals has one entry in the menu, with tabs for trip claims, company-vehicle requests and
      trips to review (each only for those it applies to); an old `/driver-management/fleet/approvals`
      link lands on it.
- [ ] Approvals › Trips to review: pick odometer, GPS or your own km (note required); the driver is
      told; the trip becomes Completed with that figure.
- [ ] Force-close a running trip with a closing reading (settles normally) and one without (held for
      review, "Not ended by the driver").
- [ ] Leave a test trip silent: the driver is reminded after 45 minutes; it closes for review after
      3 hours (12 hours running closes it too).
- [ ] A trip over midnight counts its km on both days (the trip shows "Crossed midnight").
- [ ] Vehicle Management › Fleet Control › Fleet Trips lists the fleet trip with its places,
      project, status and billable km, and trips from before SEL Fleet tagged read-only; Excel
      export; `/vehicle-management/trips` and `/driver-management/trip-log` redirect to the new pages.

## Phase 2 — fuel and mileage

- [ ] Phone: Fuel Entries needs both photos (bill may be a PDF) and refuses a date in the future or
      more than 7 days back; the rate per litre is shown as you type.
- [ ] Two full-tank fills with trips between them give a mileage; a partial fill in between is
      added to the second full one.
- [ ] Flags: more litres than the tank holds, a price far from the vehicle's recent fills, a fill
      with no trip since the last one, a reading below the last — each shows on the entry, managers
      are told, and it appears on Exceptions.
- [ ] Save twice quickly (or retry after a dropped connection): one entry.
- [ ] Desktop: Exceptions lists flagged trips and fuel; resolving needs a note; nobody resolves
      their own.
- [ ] The next morning: the digest email arrives (once, even if the job runs twice); a vehicle
      within 300 km of service is listed by the service-due job.

## Phase 3 — payment report

- [ ] Generate last month: Reports A–D show; per-km costs by project match the trips; a
      fixed-plus-fuel vehicle's charge and fuel are shared by project km; held trips appear in C as
      Held and are not paid; driver-paid fuel appears in D.
- [ ] Download Excel, PDF and JSON; the PDF is readable when printed (A4 landscape).
- [ ] Email: the recipients in Settings › Fleet receive the report with both files.
- [ ] Approve for payment: the report locks (regenerating it is refused); its trips are not counted
      again in the next month's report.
- [ ] Review a held trip after approval: it appears in the next month's report, counted as carried.
- [ ] A custom period generates a preview that cannot be approved.
- [ ] On the 1st at 06:00 the report is generated and emailed by itself.

## Security spot checks

- [ ] Signed in as a driver with no grants, open `/vehicle-management/fleet` and the report pages:
      refused. Open another driver's trip by URL: refused.
- [ ] A photo URL (`/api/fleet/uploads/<id>`) opened by someone who is neither the driver nor a
      manager: refused. The Storage path `fleet/…` fetched directly from the browser: refused.
- [ ] From the browser console, writing to `vehicleManagementTrips` or `fleetApprovals`: refused.
