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
| Firestore rules + indexes | DONE |
| Storage rules | DONE |
| Seed / demo data | DONE |
| Documentation | DONE |

## What was built

| | |
| --- | --- |
| Pure domain modules | 10 (`office-hub-time` … `office-hub-integrations`) |
| Firestore service / server engine | `office-hub-service.ts`, `office-hub-server.ts` |
| Routes | 29 pages + 1 API route |
| Components | 20 |
| Domain tests | 129, all passing |
| Firestore composite indexes added | 43 (+1 on `userNotifications`) |
| Firestore rule blocks added | 19 |
| New npm dependencies | **0** |

## Verification

```bash
npm run test:office-hub        # 129 tests: domain, recurrence, reminders, reports, import
npm run typecheck:office-hub   # scoped tsc over the module — clean
npm run typecheck              # whole repo
npm run build
```

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
* **Mandatory external calendar integrations.** §63 asks for the interfaces, not the integrations.
  `office-hub-integrations.ts` defines `CalendarProvider`, `MeetingProvider`, `EmailProvider` and
  `NotificationProvider`, ships working no-op/ICS implementations, and registers real ones through
  configuration.
