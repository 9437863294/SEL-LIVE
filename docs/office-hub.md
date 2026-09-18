# Office Hub

Meetings • Calendar • Teams • Tasks • Decisions • Reminders

Office Hub is a module **inside** this application, not a separate product. It adds the meeting and
task side of office life to the existing ERP and reuses everything the ERP already has: the Firebase
project, the sign-in, the role and access system, the employee and department masters, the header
notification bell, the audit trail, the UI kit.

That decision is the most important thing in this document, because almost every design choice
below follows from it.

---

## 1. What it does

| Area | What is there |
| --- | --- |
| **Meetings** | Create, edit, cancel, reschedule. Online / offline / hybrid. Recurring series. Configurable reminders. Invitation responses with a message. Join button gated to participants. |
| **Meeting workflow** | Agenda with reordering and templates, live "meeting mode" with a timer, attendance sheet, auto-saving rich notes, decisions, action items, minutes with an optional approval ladder. |
| **The chain** | `Meeting → Decision → Action Item → Task`, with a one-click conversion that carries everything across, and links back at every step. |
| **Tasks** | List and Kanban views, subtasks that drive progress, dependencies that block completion, comments with @mentions, a full activity trail, attachments. |
| **Teams** | Cross-department groups that can be invited or assigned as one. Team dashboard. Archive, never delete. |
| **Calendar** | Day / week / month / agenda, meetings plus task deadlines plus holidays, drag-to-reschedule in the month view. |
| **Registers** | Decisions, action items (including an "untracked" view), employees, workload. |
| **Insight** | Meeting / task / action-item / decision reports with charts and Excel export. A management overview. |
| **Plumbing** | Global search with `Ctrl+K`, notification centre, per-user preferences, office settings, meeting and agenda templates, employee import, a server-side reminder engine. |

---

## 2. How it fits the existing application

### What is reused, not rebuilt

| Concern | Reused from | Why it matters |
| --- | --- | --- |
| Sign-in, session, live permissions | `src/components/auth/AuthProvider.tsx` | A user's Office Hub access comes from the same role documents and additive grants as everything else. An administrator granting a role does not have to know this module exists. |
| Permissions | `src/lib/access-control.ts`, `src/lib/permissions.ts` | `Office Hub` is a normal entry in `permissionModules`, editable in Role Management. |
| Employees | `employees` collection (greytHR-synced) | Office Hub **never becomes a second employee master**. |
| Logins | `users` collection | The participant directory is driven by `users` joined to `employees` — see §4 below. |
| Departments, projects | `departments`, `projects` | Read by id; names denormalised for display only. |
| Notifications | `userNotifications` + `src/lib/notifications.ts` | Office Hub alerts appear in the **same header bell** as every other module's, and go through the same push pipeline. |
| Audit trail | `userLogs` + `src/lib/activity-logger.ts` | "What did this person do" shows meetings alongside approvals and payments. |
| Email | `src/lib/mail.ts` | Wired in as an `EmailProvider`; the templates know nothing about the transport. |
| UI kit | `src/components/ui/*`, `src/components/hr/hr-ui.tsx` | Especially `HrDataList` — the register that renders as cards on a phone and a table on a desktop from one column spec. |
| Excel export | `src/lib/report-excel.ts` | An Office Hub export opens looking like every other module's. |
| Audit stamps | `src/lib/audit-fields.ts` | The same six `createdBy`/`updatedAt` fields, so records sort and render consistently. |

### What is new

Three new **collection families** (`officeHub*`), a set of pure domain modules, a Firestore service,
the `/office-hub` routes, and one API route for the scheduled job.

---

## 3. Architecture

```
src/lib/office-hub-time.ts          zone arithmetic, formatting        no imports at all
src/lib/office-hub-model.ts         types, enums, defaults             imports time
src/lib/office-hub-rules.ts         business rules                     imports time + model
src/lib/office-hub-recurrence.ts    series expansion                   imports time + model
src/lib/office-hub-reminders.ts     reminder scheduling + copy         imports the above
src/lib/office-hub-permissions.ts   authorization                      imports access-control
src/lib/office-hub-reports.ts       report aggregation                 imports the above
src/lib/office-hub-search.ts        search ranking, list filters       imports the above
src/lib/office-hub-import.ts        employee CSV parsing               imports time
src/lib/office-hub-integrations.ts  provider interfaces, ICS, emails   imports time + model
─────────────────────────────────── the line ───────────────────────────────────────────────
src/lib/office-hub.ts               collections + re-exports           imports firebase types
src/lib/office-hub-service.ts       every client Firestore read/write  browser SDK
src/lib/office-hub-server.ts        the scheduled sweeps               Admin SDK, server-only
```

**Everything above the line is pure**: no network, no Firebase, no React. That is what lets
`tests/office-hub-*.test.mjs` exercise the rules directly under `node --test`, and what lets the
cron route reach exactly the same conclusions about an Admin-SDK document that the browser reaches
about a client one. A rule that matters lives above the line.

Components are in `src/components/office-hub/`, routes in `src/app/(protected)/office-hub/`.

---

## 4. The participant directory — why `users` joined to `employees`

A meeting participant needs a **login**: they must be able to open the app, see the invitation and
respond. So `loadOfficeHubDirectory()` is driven by `users` (active only) and joins `employees` onto
it for the HR facts — department, designation, employee ID — that `users` does not carry.

The join key is `users.employeeId`, maintained by the greytHR linking screen
(`docs/greythr-integration.md`), falling back to a case-insensitive email match for accounts linked
before that existed. An unlinked user still appears and can still be invited; they simply have no
department until somebody links them.

Driving it the other way — from `employees` — would offer an organizer 400 people of whom only the
ones with an account could ever answer.

`employees.department` holds a department **name**; the directory resolves it to a department id so
that nothing downstream has to string-match a department again.

---

## 5. Firestore data model

### Collections Office Hub owns

| Collection | Holds | Notes |
| --- | --- | --- |
| `officeHubMeetings` | One document per meeting, including each materialised instance of a series | Carries denormalised `participantUserIds`, `requiredUserIds`, `departmentIds`, `teamIds`, `responseSummary`, `participantCount` |
| `officeHubParticipants` | One per person per meeting | Doc id is `{meetingId}_{userId}` |
| `officeHubAgenda` | Agenda items | `order` is renumbered wholesale on every move |
| `officeHubNotes` | Meeting notes | Doc id **is** the meeting id — exactly one per meeting |
| `officeHubMom` | Minutes and their approval trail | Doc id is the meeting id |
| `officeHubDecisions` | The decision register | `DEC-2627-0041`-style references |
| `officeHubActionItems` | Action items | `taskId` set once converted |
| `officeHubTasks` | Tasks | Subtasks and dependencies are **embedded arrays** |
| `officeHubTaskComments` | Comment threads | Append-only |
| `officeHubTaskActivity` | Activity trail | Append-only |
| `officeHubTeams` | Teams | Members are an **embedded array** |
| `officeHubDocuments` | Attachment metadata | Storage path, never a download URL |
| `officeHubReminders` | Scheduled reminders | Deterministic doc ids; see §8 |
| `officeHubMeetingTemplates`, `officeHubAgendaTemplates` | Templates | Store *selections*, not rosters |
| `officeHubSettings` | One doc, `global` | Office-wide configuration |
| `officeHubUserSettings` | One doc per user | Time zone, reminders, notification switches |
| `officeHubCounters` | Reference sequences | One per prefix per financial year |
| `officeHubAttendanceLog` | Reserved for server-written attendance history | Server-only |

### Collections deliberately **not** created

* **`notifications`** → the existing `userNotifications`, so alerts land in the header bell.
* **`auditLogs`** → the existing `userLogs`.
* **`employees` / `departments` / `projects` / `users` / `roles`** → the app's existing masters.
* **`teamMembers` / `taskSubtasks`** → embedded arrays. Both are small, bounded, and read whenever
  their parent is read.

### Five structural decisions worth knowing

1. **Participants are a collection, not an array on the meeting.** "My meetings" and "meetings I
   have not answered" must be indexed queries across every meeting, and an array of objects cannot
   be indexed that way. The meeting carries a denormalised `participantUserIds` array
   (`array-contains`-queryable) plus a `responseSummary` counter so the register and the calendar
   are single reads; the participant documents stay authoritative for response and attendance.
2. **Subtasks and dependencies are embedded; comments and activity are not.** A checklist is read
   whenever the task is and is bounded by what a person will tolerate ticking. Comments grow without
   limit and are paged.
3. **A series is one parent document plus materialised instances.** `seriesId` points every instance
   at its parent; `occurrenceKey` is the instance's date and is what makes generation idempotent.
4. **Wall clock is the source of truth; instants are a cache.** `date` + `startTime` + `timeZone` are
   authoritative; `startAt`/`endAt` are derived by `meetingInstants()` and exist only because
   Firestore can sort and range-query on them. See §6.
5. **Nothing is hard-deleted.** Meetings, tasks, decisions, action items and teams carry
   `isDeleted`/`archivedAt`, and every list query filters on it.

### Relationships

```
users ──┬── employees            (users.employeeId, or email)
        └── departments          (employees.department → departments.name)

officeHubMeetings ──┬── officeHubParticipants     (meetingId)
                    ├── officeHubAgenda           (meetingId)
                    ├── officeHubNotes            (id == meetingId)
                    ├── officeHubMom              (id == meetingId)
                    ├── officeHubDecisions        (meetingId)
                    ├── officeHubActionItems      (meetingId, seriesId)
                    ├── officeHubDocuments        (meetingId)
                    └── officeHubMeetings         (seriesId → the series parent)

officeHubActionItems ── officeHubTasks            (actionItemId ⇄ taskId)
officeHubDecisions   ── officeHubTasks            (decisionId)
officeHubTeams       ── officeHubTasks            (teamId)
officeHubTasks       ──┬── officeHubTaskComments  (taskId)
                       └── officeHubTaskActivity  (taskId)
```

---

## 6. Time zones

Office Hub stores a meeting as **wall clock plus zone**, not as an instant, and derives the instants.

A recurring meeting is "every Monday at 10:00 in Asia/Kolkata", not "every 604800 seconds from this
instant". Those readings agree until a zone crosses a DST boundary, at which point the instant-based
one silently moves the meeting by an hour. So:

* `date`, `startTime`, `endTime`, `timeZone` are authoritative.
* `startAt`, `endAt` are ISO instants produced **only** by `meetingInstants()`, recomputed whenever
  any of the four change.
* Recurrence expansion walks calendar dates and converts to instants per instance, each with its own
  UTC offset.
* `office-hub-time.ts` does the zone conversion with `Intl.DateTimeFormat`, so it needs no date
  library and works in the browser, in `node --test`, and in the Admin-SDK route.

`tests/office-hub-recurrence.test.mjs` has a test that a weekly Europe/London 09:00 series keeps
reading 09:00 across the October fall-back while its UTC instants shift by an hour. That is the
behaviour this design exists for.

The office default is `Asia/Kolkata`. A user can set their own zone in Settings; a meeting scheduled
in a different zone shows a note with the viewer's local time.

---

## 7. Permissions

`Office Hub` is a normal `permissionModules` entry, so it is granted through Role Management and the
access-management layer like anything else.

```
Office Hub
├── View Module
├── Dashboard           View
├── Calendar            View · Reschedule
├── Meetings            View · View Team · View Department · View All · Create · Edit ·
│                       Cancel · Reschedule · Manage Participants · Change Organizer · Export
├── Agenda              View · Add · Edit · Delete
├── Attendance          View · Record · Export
├── Minutes             View · Prepare · Review · Approve · Publish · Export
├── Decisions           View · View All · Create · Edit · Close · Export
├── Action Items        View · Create · Edit · Complete · Convert to Task
├── Tasks               View · View Team · View Department · View All · Create · Edit ·
│                       Assign · Complete · Delete · Comment · Export
├── Teams               View · Create · Edit · Manage Members · Change Leader · Archive
├── Employees           View · Import · Export
├── Documents           View · Upload · Download · Delete
├── Reports             View · Export
├── Workload            View
├── Management Overview View
├── Templates           View · Add · Edit · Delete
└── Settings            View · Edit
```

The specification's shorthand maps one-to-one: `meeting.create` is
`can('Create', 'Office Hub.Meetings')`, `task.assign` is `can('Assign', 'Office Hub.Tasks')`.

### The rule that is not a permission

**Being the organizer of a meeting is authority over that meeting.** An organizer does not need
`Meetings.Edit` to change their own meeting's agenda, mark its attendance or write its minutes — they
need it to edit *other people's*. The same reading applies to a task's assignee, a decision's owner
and a team's leader. Requiring a matching role permission on top is how a meeting ends up parked with
somebody who cannot act on it, and it is the same conclusion E-Approval reached about assigned
workflow steps.

Leading a team or heading a department also confers a baseline no role has to grant, because in this
organisation those are facts about the `teams` and `departments` records rather than roles anybody is
assigned.

Two refusals the UI cannot be talked out of:

* Minutes cannot be **published** before the meeting is marked completed.
* With approval switched on, the person who **prepared** the minutes may not also **approve** them.

### Suggested starting roles

| Role | Grant |
| --- | --- |
| **Employee** | `View Module`, `Dashboard.View`, `Calendar.View`, `Meetings.View`, `Meetings.Create`, `Tasks.View`, `Tasks.Create`, `Tasks.Comment`, `Action Items.View`, `Decisions.View`, `Teams.View`, `Documents.Upload` |
| **Team Leader** | Employee, plus `Meetings.View Team`, `Tasks.View Team`, `Tasks.Assign`, `Teams.Manage Members` |
| **Department Head** | Team Leader, plus `Meetings.View Department`, `Tasks.View Department`, `Decisions.Create`, `Minutes.Prepare`, `Reports.View` |
| **Management** | `Meetings.View All`, `Tasks.View All`, `Decisions.View All`, `Reports.View`, `Reports.Export`, `Workload.View`, `Management Overview.View`, `Minutes.Review`, `Minutes.Approve` |
| **Super Admin** | Everything, plus `Settings.Edit`, `Templates.*`, `Employees.Import` |

---

## 8. Reminders and the scheduled job

§62 and §86 of the specification say the same thing from different angles: **a reminder must not
depend on a browser tab being open.** So:

1. The client writes **reminder rows** to `officeHubReminders` when a meeting or task is saved.
2. `GET /api/office-hub/cron` sweeps due rows on the server and delivers them.

Reminder documents use a **deterministic id** — `{entityType}_{entityId}_{userId}_{kind}_{offset}` —
which is what makes re-saving a meeting *move* its reminders rather than accumulate a set for every
time it was ever rescheduled.

### What the sweep does

| Step | What | Safety property |
| --- | --- | --- |
| `reminders` | Delivers due rows | Idempotent: a delivered row flips to `Sent` in the same pass |
| `statuses` | Advances meeting statuses on the clock | Writes only on a real transition; never touches a cancelled or manually-completed meeting |
| `overdue-tasks` | Notifies about late tasks | `lastOverdueNoticeAt` holds it to one notice per task per day |
| `due-items` | Chases decisions and action items | Bounded to a two-day horizon |
| `series` | Tops up open-ended recurring series | Idempotent by `occurrenceKey` |

Each step is wrapped so one failing does not abandon the rest — a broken series rule must not stop
today's meeting reminders. Failures are collected and returned in the response.

A reminder whose moment passed more than three hours ago is **closed out, not delivered**: a sweep
recovering from an outage should not tell everybody about meetings that have already happened. One
whose meeting was cancelled, or whose task was completed, is dropped for the same reason.

### Scheduling it

**Every 30 minutes.** Reminder offsets go down to ten minutes, so an hourly sweep would deliver a
"10 minutes before" reminder up to an hour late — and the three-hour grace window would rather drop
it than send it after the meeting started.

**Vercel** — add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/office-hub/cron", "schedule": "0,30 * * * *" }] }
```

**Google Cloud Scheduler** (Firebase App Hosting):

```bash
gcloud scheduler jobs create http office-hub-sweep \
  --schedule="0,30 * * * *" \
  --uri="https://YOUR-HOST/api/office-hub/cron" \
  --http-method=GET \
  --headers="Authorization=Bearer YOUR_CRON_SECRET" \
  --attempt-deadline=300s \
  --time-zone="Asia/Kolkata"
```

**Manual, while testing:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/office-hub/cron
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/office-hub/cron?only=reminders"
```

`?only=reminders,series` runs a subset — useful for investigating one sweep, and for an installation
that wants the reminder pass every 30 minutes but the series top-up only nightly.

> **The route refuses to run without `CRON_SECRET`.** The application's other scheduled routes treat
> an unset secret as "no guard"; this one does not, because an unauthenticated endpoint that can
> notify every user in the organisation is worth being strict about.

---

## 9. Environment variables

`.env*` is gitignored in this repository, so an example file would not be committed — hence this
table. Only the first two are new.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `CRON_SECRET` | **The scheduled job** | Required. Without it `/api/office-hub/cron` returns 503. Any long random string. |
| `NEXT_PUBLIC_APP_URL` | Links inside notification emails | e.g. `https://erp.example.com`. Without it, email links are omitted rather than pointing at a guessed host. `APP_BASE_URL` is also read. |
| `FIREBASE_PROJECT_ID` | Admin SDK — cron, seed | Already present |
| `FIREBASE_CLIENT_EMAIL` | Admin SDK | Already present |
| `FIREBASE_PRIVATE_KEY` | Admin SDK | Already present |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Email notifications | Already present. With none set, Office Hub logs that email is off and sends in-app notifications only. |
| `NEXT_PUBLIC_FIREBASE_*` | The browser SDK | Already present |

No Office Hub code reads a secret in the browser. The one client-visible variable is
`NEXT_PUBLIC_APP_URL`, which is a public hostname.

---

## 10. Setup

### 1. Nothing to install

Office Hub adds **no new dependencies**. It uses what is already in `package.json`: `firebase`,
`firebase-admin`, `recharts`, `@hello-pangea/dnd`, `exceljs`, `dompurify`, `nodemailer`,
`lucide-react` and the Radix primitives.

```bash
npm install     # only if you have not already
```

### 2. Deploy the Firestore indexes

Office Hub adds 43 composite indexes. **Without them its registers return an error rather than an
empty list**, which reads as "the module is broken".

```bash
firebase deploy --only firestore:indexes
```

### 3. Adopt the Firestore rules

`firestore.rules` in this repository is **not wired into `firebase.json`** — the project's live rules
are maintained in the Firebase console, and deploying this file as-is would replace them. Read the
header of `firestore.rules` before doing anything.

The safe route: copy the `officeHub*` blocks at the bottom of that file, together with the
`canOpenOfficeHub()`, `officeHubHolds()` and `isOfficeHubMeetingMember()` helpers, into the existing
console ruleset. Then verify in the rules simulator that a user who is not a participant of a meeting
cannot read that meeting's document.

**Until this is done, Office Hub has no server-side authorization** — its screens enforce
permissions in the browser, which anyone can bypass.

### 4. Deploy the Storage rules

```bash
firebase deploy --only storage
```

The `office-hub/**` block enforces the 25 MB cap and the allowed extensions, and denies `update` and
`delete` outright — the application soft-deletes attachment *metadata* and deliberately leaves the
object, so a file referenced by published minutes cannot vanish from them.

### 5. Grant somebody access

Settings → Role Management → pick a role → tick the `Office Hub` permissions. Start with the
Super Admin row from §7 so there is somebody who can configure the module.

### 6. Configure the office

`/office-hub/settings` → **Office settings**: working days and hours, default meeting duration, the
meeting-type list, default reminders, upload limits, holidays, and whether minutes need approval.

### 7. Schedule the cron job

§8 above. Set `CRON_SECRET` first.

### 8. Optional: seed demo data

```bash
npm run seed:office-hub             # create
npm run seed:office-hub -- --clear  # remove
```

Every document it writes carries `isDemoData: true`, which is what makes `--clear` safe to run
against an installation that has since had real meetings in it.

If the installation already has departments and logins, the script **uses them** and builds the demo
meetings around the real people. Only when it finds none does it create placeholders, and it says so
loudly. The demo users it creates in that case are Firestore documents with no Firebase Auth account,
so nobody can sign in as them.

---

## 11. Local development

```bash
npm run dev                     # the app, including /office-hub
npm run test:office-hub         # 129 domain tests, no Firebase needed
npm run typecheck:office-hub    # scoped tsc over the module
npm run typecheck               # the whole repository
npm run build
```

The domain tests run against the pure layer with `node --experimental-strip-types --test`, so they
need no emulator, no credentials and no network. They are the fast feedback loop: if you change a
rule, they will tell you in under a second.

For the Admin-SDK pieces (cron, seed) you need credentials — either the service-account variables or
`gcloud auth application-default login`. See `docs/firebase-admin-local.md`.

> `npm run lint` is broken repository-wide for reasons unrelated to this module; it fails on every
> file in the repo, including ones this work never touched. `tsc` plus the node suites are the checks
> that actually run.

---

## 12. Production deployment

Office Hub deploys with the application — it is not separately deployable.

**Vercel**

1. Set `CRON_SECRET` and `NEXT_PUBLIC_APP_URL` in the project's environment variables.
2. Add the cron entry from §8 to `vercel.json`.
3. Deploy. The cron route needs the Node runtime and up to 300 s, which it declares itself.

**Firebase App Hosting**

1. Add `CRON_SECRET` and `NEXT_PUBLIC_APP_URL` to `apphosting.yaml` (as a secret and a variable
   respectively).
2. Create the Cloud Scheduler job from §8.

**Either way**, before the first real use: deploy the indexes, adopt the Firestore rules, deploy the
Storage rules.

---

## 13. Integration interfaces

§63 asks for the interfaces, not the integrations, and is explicit that no external integration is
mandatory. `office-hub-integrations.ts` defines four provider contracts and ships a working default
for each that needs no third-party account:

| Provider | Default | To add a real one |
| --- | --- | --- |
| `CalendarProvider` | **ICS** — a standards-compliant `.ics` that Outlook, Google Calendar and Apple Calendar all import. Not a stub. | `registerCalendarProvider()` with a Graph or Google Calendar implementation. The payload (`calendarEventFromMeeting`) does not change; only the transport. |
| `MeetingProvider` | **Manual link** — the organizer pastes a Teams/Meet/Zoom URL, which is what people do. Validates the link against the chosen platform. | `registerMeetingProvider()` with `supportsCreation: true` and a `create()` that calls the platform's API. Screens read `supportsCreation` to decide whether to offer the button. |
| `EmailProvider` | The app's `nodemailer` transport, registered by `office-hub-server.ts` when SMTP is configured. | `registerEmailProvider()` with anything that can send a subject + HTML + text. |
| `NotificationProvider` | The app's header bell and push pipeline, registered by `office-hub-service.ts`. | `registerNotificationProvider()`. |

`recurrenceRuleFor()` maps Office Hub's recurrence to an RFC 5545 `RRULE`, but only the rules that
map cleanly — a rule an external calendar would read differently is better sent as one event per
instance than as an RRULE that means something subtly different in Outlook.

---

## 14. Charts

Both palettes in `src/components/office-hub/charts.tsx` were **validated, not eyeballed**, against
the light surface `#f9fafb` and the dark surface `#09090b`: lightness band, chroma floor, CVD
separation, normal-vision floor and contrast.

Two results worth recording:

* The light categorical palette **warns** on contrast for two slots (teal 2.41:1, amber 2.44:1),
  which obliges visible value labels. Every chart carries them, so the relief is real.
* The ordinal ramp is capped at **five** steps. A sixth cannot hold both the ≥0.06 step gap and the
  light-end contrast inside one hue's usable range, so an ordinal chart needing six bands drops its
  off-scale band (`No date`) to neutral rather than stretching the ramp.

The application defines `--chart-1` … `--chart-5` in `globals.css` but **only inside the `.dark`
block**, so in the light default they resolve to nothing and bars render invisible. The module writes
the same hues explicitly rather than depending on that, or "fixing" a global token other modules may
rely on.

Nominal categories (department, type, organizer, assignee) get **one hue for every bar**. Only
genuinely ordered scales — priority, age bands — use the ramp.

---

## 15. Testing checklist

`npm run test:office-hub` covers the domain layer automatically (129 tests). The following are the
paths worth walking by hand after deploying.

### Authentication and access

- [ ] A signed-out user hitting `/office-hub` is redirected to sign in.
- [ ] A user with no `Office Hub` permission sees "Access Denied", not a blank page.
- [ ] Removing a permission in Role Management takes effect **without a re-login** (the role listener is live).
- [ ] The nav hides sections the user cannot open; the Guide stays visible.

### Meetings

- [ ] Create an offline meeting; participants receive an invitation in the header bell.
- [ ] Create an online meeting; a link from the wrong platform is refused with a useful message.
- [ ] Invite a whole department and a whole team at once; somebody in both appears **once**.
- [ ] Mark one invitee optional; they are still invited, and required wins if they are also reached as required.
- [ ] Save a draft: no invitations are sent. Send it later; they are.
- [ ] Reschedule: participants are notified, and the reminder rows move with it.
- [ ] Cancel with a reason: participants are notified and reminders are cancelled.
- [ ] A completed meeting cannot be edited, but its attendance still can.
- [ ] The join link is hidden from a signed-in user who is not a participant.

### Recurrence

- [ ] Create a weekly Mon/Wed series ending after 6 occurrences; the preview shows the six dates.
- [ ] "Last Friday of the month" lands on the real last Friday in a 5-Friday month.
- [ ] Cancel one occurrence; it becomes an exception and the cron does **not** recreate it.
- [ ] Editing a single occurrence does not move the series; changing the rule from one occurrence is refused.
- [ ] Run the cron twice; no duplicate instances appear.

### Meeting workflow

- [ ] Add agenda items, reorder them, apply an agenda template.
- [ ] Start the meeting; the timer counts from when it actually started.
- [ ] Mark attendance; the sheet is pre-filled and declines start as Absent.
- [ ] Type notes; they save themselves and survive navigating away.
- [ ] Record a decision and an action item from meeting mode.
- [ ] End the meeting; the receipt lists what was and was not recorded.

### The chain

- [ ] "Create task" from an action item arrives pre-filled with the person, date, priority, meeting and decision.
- [ ] The task's header links back to the source meeting.
- [ ] Completing the task closes the action item.
- [ ] The action-item register's "Untracked" view lists open items with no task.

### Tasks

- [ ] Assign to a person, to a team, and to a person **within** a team.
- [ ] Tick a subtask; progress moves and the hand-set value is ignored.
- [ ] Link a blocking task; completion is refused until it is done.
- [ ] Try to create a dependency cycle; it is refused with an explanation.
- [ ] Comment with an @mention; the mentioned person is notified.
- [ ] Drag a card on the board; on a forced failure it moves back.
- [ ] Check the activity trail names each change, and that a no-op edit adds nothing.

### Minutes

- [ ] With approval **off**: prepare → publish.
- [ ] With approval **on**: prepare → review → approve → publish, and the preparer cannot approve.
- [ ] Publishing before the meeting is completed is refused.
- [ ] Print the minutes; the page carries no nav or sidebar.
- [ ] Publishing notifies every participant.

### Teams, calendar, search

- [ ] Create a team, change its leader, remove a member, archive and restore it.
- [ ] Archiving does not break a past meeting that invited the team.
- [ ] Calendar day / week / month / agenda all render; holidays and task deadlines appear.
- [ ] Drag a meeting to another day in the month view; it is rescheduled and participants notified.
- [ ] `Ctrl+K`, then paste a task reference; it goes straight there.

### Reminders and notifications

- [ ] A meeting with a 15-minute reminder produces rows in `officeHubReminders`.
- [ ] Run the cron; the notification arrives and the row flips to `Sent`.
- [ ] Turn a switch off in Settings; the corresponding notification stops.
- [ ] Turn off "Overdue alerts"; the task's `lastOverdueNoticeAt` is still stamped (no re-evaluation loop).
- [ ] A cancellation notification arrives even with every optional switch off.

### Files, import, export

- [ ] Attach a PDF; attach a `.exe` and see it refused; attach a 40 MB file and see it refused.
- [ ] Download an attachment; the URL is minted per request, not stored.
- [ ] Paste an employee sheet: the preview classifies create / update / match / error before anything is written.
- [ ] A duplicate ID inside the sheet is refused, naming the earlier row.
- [ ] A blank cell does **not** clear an existing value.
- [ ] Download the error report; it carries the original row numbers.
- [ ] Export meetings, tasks, decisions and the reports workbook.

### Mobile

- [ ] Every register reads as cards on a phone.
- [ ] The nav opens as a sheet; the command palette is reachable.
- [ ] The meeting page puts the Join button above the detail.
- [ ] Dialogs are full-screen and the body is what scrolls.

### Accessibility

- [ ] Tab through the Kanban board; space lifts a card, arrows move it, space drops it.
- [ ] Every chart has a "view as a table" toggle.
- [ ] Form errors are announced and attached to their field.

---

## 16. Deliberately not built

| Not built | Why |
| --- | --- |
| A second employee master | §89. The importer reconciles against `employees`; it does not create a parallel directory. |
| Performance scores, ratings or rankings | §40 and §73 both prohibit them. `buildWorkload` returns plain counts with no composite field, and the workload table sorts alphabetically until the reader picks a column. |
| Mandatory external calendar integrations | §63 asks for interfaces. See §13. |
| Comment editing | A comment is amended by adding another, never by changing the one people have read. |
| Hard deletes | §83. Everything important is archived or soft-deleted. |
| A dual-axis chart | Two measures of different scale are two charts. |

---

## 17. Where to look

| I want to change… | File |
| --- | --- |
| When something counts as overdue | `src/lib/office-hub-rules.ts` |
| How participants expand from a selection | `src/lib/office-hub-rules.ts` → `expandParticipantSelection` |
| Recurrence behaviour | `src/lib/office-hub-recurrence.ts` |
| What a notification says | `src/lib/office-hub-reminders.ts` |
| Who may do what | `src/lib/office-hub-permissions.ts` + `src/lib/permissions.ts` |
| A Firestore read or write | `src/lib/office-hub-service.ts` |
| The scheduled sweeps | `src/lib/office-hub-server.ts` |
| Chart colours or forms | `src/components/office-hub/charts.tsx` |
| The nav | `src/components/office-hub/module-layout-shell.tsx` |
| Module status at a glance | `BUILD_STATUS.md` |
