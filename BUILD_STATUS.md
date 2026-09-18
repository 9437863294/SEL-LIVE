# Office Hub — Build Status

Meetings • Calendar • Teams • Tasks • Decisions • Reminders

Office Hub is a module **inside** the existing SEL Live ERP, not a separate application. It reuses
the app's Firebase project, `AuthProvider`, `users`/`roles`/`employees`/`departments`/`projects`
masters, the central `userNotifications` bell and the `userLogs` audit trail. See
`docs/office-hub.md` for the architecture and setup.

| MODULE | STATUS |
| --- | --- |
| Domain layer (time, model, rules) | DONE |
| Recurrence engine | DONE |
| Reminder + notification engine | DONE |
| Role-based access control | DONE |
| Module registration (permissions, nav, audit) | DONE |
| Firestore service layer | DONE |
| Authentication (reuses app `AuthProvider`) | DONE |
| Employees / Departments (reuses app masters) | DONE |
| Teams | DONE |
| Dashboard | DONE |
| Calendar | DONE |
| Meetings (create / edit / cancel / reschedule) | DONE |
| Participants + invitation responses | DONE |
| Meeting agenda | DONE |
| Live meeting mode | DONE |
| Attendance | DONE |
| Meeting notes | DONE |
| Decisions register | DONE |
| Action items | DONE |
| Action item → task | DONE |
| Tasks (list / kanban / detail / subtasks / dependencies) | DONE |
| Task comments + activity history | DONE |
| Minutes of meeting + approval workflow | DONE |
| Notifications centre + preferences | DONE |
| Browser notifications | DONE |
| Documents / attachments | DONE |
| Global search | DONE |
| Reports | DONE |
| Employee workload | DONE |
| Management overview | DONE |
| Templates (meeting + agenda) | DONE |
| Settings | DONE |
| Employee import | DONE |
| Export (Excel / CSV / print) | DONE |
| Scheduled jobs (cron route) | DONE |
| Integration interfaces (Calendar / Meeting / Email / Notification providers) | DONE |
| **Google Meet integration** (per-user OAuth, Meet link + Google Calendar event) | DONE |
| Firestore rules + indexes | DONE |
| Storage rules | DONE |
| Seed / demo data | DONE |
| Documentation | DONE |

## What was built

| | |
| --- | --- |
| Pure domain modules | 11 (`office-hub-time` … `office-hub-google`) |
| Firestore service / server engine | `office-hub-service.ts`, `office-hub-server.ts` |
| Routes | 29 pages + 5 API routes |
| Components | 21 |
| Domain tests | 175, all passing |
| Firestore composite indexes added | 44 (+1 on `userNotifications`) |
| Firestore rule blocks added | 20 |
| New npm dependencies | **0** — the Google integration uses `fetch` against the OAuth and Calendar REST endpoints and `node:crypto` for token encryption and state signing, rather than pulling in `googleapis` |

## Verification

```bash
npm run test:office-hub        # 175 tests: domain, recurrence, reminders, reports, import, google — all pass
npm run typecheck:office-hub   # scoped tsc over the module — clean
npm run typecheck              # whole repo
npm run build                  # exit 0; all 29 Office Hub pages + 5 API routes compiled
```

The build is the check that catches what `tsc` cannot: a `server-only` module reached from a client
component. That boundary matters here, because `office-hub-google-server.ts` holds the OAuth client
secret and the token-encryption key — only the four `/api/office-hub/google/*` routes and
`office-hub-server.ts` import it, and a mistake would be a build error rather than a leak.

Two things to know about the repo-wide checks:

* **`npm run typecheck` reports 57 errors, none of them in Office Hub.** They are in the in-flight
  E-Approval, Recurring Payments, Bank Guarantee and Insurance work that was already in the tree,
  plus nine stale `.next/types` entries. `npm run typecheck:office-hub` is the scoped check for this
  module, and it is clean — including under `--noUnusedLocals --noUnusedParameters`.
* **`npm run lint` is broken repo-wide** for reasons unrelated to this module; it fails on every file
  in the repository, including files this work never touched. `tsc` plus the node suites are the
  checks that actually run here.

## Deliberately not built

* **A second employee master.** §64's importer writes Office Hub profile fields and reconciles
  against the existing `employees` collection; it does not create a parallel directory (§89).
* **Performance scores or rankings.** §40 and §73 both prohibit them. `buildWorkload` returns plain
  counts and has no composite field.
* **A Teams or Zoom integration.** Conferencing is Google Meet only — Office Hub creates the Meet
  and the Google Calendar event itself rather than collecting a pasted link. The other three
  provider contracts (`CalendarProvider`, `EmailProvider`, `NotificationProvider`) still ship
  working defaults and accept real implementations through configuration, and the meeting registry
  is what a second conferencing platform would plug into. See `docs/office-hub.md` §14.
* **Reading Google Calendar RSVPs back.** Creating the Meet creates a calendar event, so Google
  collects its own Yes/No/Maybe that Office Hub does not read — `officeHubParticipants.response`
  stays authoritative. There is no honest reconciliation (Google has no required/optional
  distinction), so the consequence is stated in the Settings card and the docs rather than hidden.
* **Moving a single occurrence of a series on Google Calendar.** The series shares one Google event
  carrying the RRULE. Rescheduling the whole series works; editing one occurrence updates Office
  Hub correctly but leaves Google showing the original slot. Documented, not half-built.
