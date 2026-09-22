# The central work dashboard

One screen that answers "is anything waiting on me?" across every module. It is the first tab of the
home page (`/`), beside the module launcher, and has its own route at `/my-work`.

The home page's two tabs are both `forceMount`ed. That is not decoration: Radix unmounts an inactive
panel by default, which would re-run the whole thirty-one-query fan-out on every switch back to
"Your work". Note that `forceMount` also stops Radix applying its own `hidden` attribute — it sets
`hidden: !present`, and `present` is always true when force-mounted — so the hiding is done by
`data-[state=inactive]:hidden` on the panel. Remove that class and both panels render at once.

The chosen tab is remembered in `localStorage` under `home_tab`, restored in an effect rather than
during the first render so the server and client markup cannot disagree.

Code:

| File | Role |
| --- | --- |
| `src/lib/work-dashboard.ts` | `WorkItem`, urgency, ordering, grouping, summary. No Firestore, no React — unit-tested under plain node. |
| `src/lib/work-dashboard-sources.ts` | The source registry and the fan-out (`loadWorkItems`). |
| `src/lib/work-dashboard-project-sources.ts` | Project Management's seven workflows, which need collection-group queries. |
| `src/components/work-dashboard/hooks.ts` | Identity resolution, then the fan-out. |
| `src/components/work-dashboard/work-dashboard.tsx` | The screen. |
| `src/components/work-dashboard/work-calendar.tsx` | The unified month calendar. |
| `src/components/shared/kpi-card.tsx` | `KpiCard` / `PageHeader`, moved out of `hr-ui.tsx`. |
| `src/components/shared/data-list.tsx` | `DataList` / `CellLink`, moved out of `hr-ui.tsx`. |
| `tests/work-dashboard.test.mjs` | Ordering, urgency and de-duplication rules. |
| `tests/work-dashboard-links.test.mjs` | Every link the dashboard emits resolves to a real route. |

`npm run test:work-dashboard` · `npm run typecheck:work-dashboard`

## Why it reads the modules instead of keeping its own table

The obvious design is one `workItems` collection that every module writes a row into. That was
rejected for the reason `windows-agent-morning.ts` gives: a parallel copy of the truth has to be kept
in step with it, and the failure mode is a dashboard telling somebody to approve a file that was
approved an hour ago. Every module already records who its open work is pending with — it just
records it under eleven different field names. So the dashboard reads those fields directly. Clear
your E-Approval inbox in another tab and a refresh here is correct, with nothing to reconcile.

The cost is one query per source instead of one query total. That is paid for three ways:

1. **Permission gating.** A source whose module the viewer cannot see is never queried. This is the
   main lever — a typical user sees four or five modules, so a typical dashboard issues well under a
   dozen reads even though the registry holds thirty-one sources.
2. **Caps.** `CAP` rows per source.
3. **Per-source isolation.** `loadWorkItems` catches each source independently. A module whose
   collection does not exist yet contributes an empty list and a named entry in `failures`, which
   the UI shows. "Nothing is waiting on you" and "we could not find out" must not look the same.

## Adding a source

Append a `WorkSource` to `WORK_SOURCES`. Keep to **one `where` clause and no `orderBy`** — that
shape is served by the automatic single-field index Firestore maintains for every field, so a new
source needs no `firestore.indexes.json` change and cannot fail on a missing composite index in
production. Filter status in memory; the dashboard sorts everything itself anyway.

Subcollections are the exception: collection-group queries need an explicit `fieldOverrides` entry
with `COLLECTION_GROUP` / `CONTAINS` scope. The seven Project Management ones are already declared.

> **Declaring an index is not deploying it.** Until `firebase deploy --only firestore:indexes` runs,
> a collection-group source throws `FAILED_PRECONDITION: The query requires an index` — which the
> dashboard catches and reports in its "queues could not be read" notice. Six such failures with
> `jmcEntries` working is the signature of exactly this: that one override predates the feature and
> is already live, the other six are not. Click **Details** on the notice to confirm.

## One calendar: year, month, day

The work tab has two sub-tabs, **List** and **Calendar**, and the calendar has three views —
**Year**, **Month**, **Day** (`CalendarView`). Clicking a day in the year or month view opens it in
the day view; clicking a month name in the year view opens that month.

It is "all the calendars in one": anything with a `dueAt`, from all four lanes, lands on a day —
Office Hub meetings with start times, E-Approval deadlines, task and action-item dues, insurance
premium and maturity dates, tour departures, recurring payment dues, vehicle insurance expiries, HR
interview slots, reminders. Previously each lived on its own module's screen, and several modules
have a `/calendar` route that only ever knew its own records.

### Where its rows come from

Two places, merged on id:

- **Deadlines and everything non-meeting** come free from the `lanes` the list tab already loaded.
- **Meetings are fetched per visible range** by `fetchMeetings` → `loadMeetingsInRange`, because the
  `office-hub-meetings` source only holds the next seven days of *upcoming* meetings. That window is
  right for the lane and the "Meetings today" figure, which are about commitments still to keep — a
  meeting held last March is not pending work and must not count towards either. But it belongs on
  the calendar, so the calendar asks for the span it is displaying. Cancelled meetings are excluded;
  Completed ones are kept and rendered faded, because that is what history looks like.

Both paths mint the same `office-hub-meetings:{id}` key, so the merge de-duplicates and the fetched
copy wins.

`loadMeetingsInRange` is the **one** loader allowed to break the one-`where`-no-`orderBy` rule. It
earns it: `officeHubMeetings` already carries a `participantUserIds CONTAINS, date ASC` composite
index that predates this feature, so the range query needs nothing added. The alternative — a capped
hundred rows filtered client-side — would silently drop months at one end of a year view.

`viewRange` returns the month view's *grid* span, not the calendar month, so a meeting on a visible
leading or trailing day is fetched rather than leaving a populated-looking cell empty.

Undated rows — the aggregate shared-queue rows especially — are counted and reported at the foot
rather than parked on today.

### Colour carries information

Two scales, deliberately, because they answer different questions:

- **`moduleBadgeClass`** (twenty-odd values, from `activity-modules.ts`) tells you whose screen you
  are about to land on. It stays on the chip.
- **`WORK_KIND_ACCENT` / `WORK_KIND_BADGE`** (four values) tells you what sort of thing it is —
  amber for a decision waiting, emerald for work to carry out, sky for a timed commitment, violet for
  a nudge. On the calendar that is the one worth reading at a glance, so it gets the strong accent:
  a 4px coloured edge on every chip, plus an icon, so colour is never the only channel.

The year view is a proper heatmap: `densityStep` bands a day's count into four steps of **one hue**,
because a ranking has to read as an ordering and multiple hues cannot. Rose overrides the ramp where
something is overdue — that is a different statement, not a busier one. The ramp is labelled
("Quieter → Busier"), since an unlabelled ramp is decoration.

Weekends are tinted (`isWeekend`) so the eye finds the week boundaries without counting columns, and
there is a test pinning `isWeekend` against `monthGrid`'s column order — if those two ever disagreed
the tint would land on the wrong days.

All of these are literal Tailwind classes, never `--chart-*` tokens: those are defined only for the
dark theme in `globals.css` and render invisible against the light default this application uses.

### The date arithmetic is tested, not trusted

All of it is in `work-dashboard.ts` and covered by `tests/work-dashboard.test.mjs`: leap years (2028
yes, 2100 no), year rollover, months that start on a Monday, every day appearing exactly once with no
gaps, month ranges always being whole weeks, and `shiftAnchor` snapping to the 1st so paging forward
from 31 January lands on February rather than skipping to March.

`@/components/office-hub/meeting-calendar` is deliberately untouched and unshared. It is 700 lines
built around Office Hub's own entry shape with four views and drag-to-reschedule through
`updateMeeting` — the right screen for working *on* meetings, and structurally unable to show an
approval deadline. This one is read-only and cross-module. Two different jobs.

## One table, one header

The list is a single `DataList` holding every lane, not one table per lane. It was four, each with
its own header row — which repeated ITEM / MODULE / STAGE / … down the page and, worse, let each
table size its own columns to its own content, so the four headers did not line up with each other.

The lane survives as the **Type** column (`Needs you` / `Meeting` / `Team queue` / `Waiting`), because
the distinction between work that names you and work merely open to your role is the most useful
thing this screen knows and was not worth losing to merge the tables. Ordering is
`compareMergedWorkItems` — lane first, urgency within — so rows naming you stay on top and a deep
shared queue can never bury them. The per-lane counts moved to a one-line `LaneSummary` above.

## Motion

Defined in `globals.css` alongside the existing module animation sets, and following a constraint
already recorded there for `am-card-in` and `vm-reveal-up`: **fade and rise, never scale.** The KPI
cards are `bg-white/80 backdrop-blur-sm`, and scaling a blurred surface resamples the blur every
frame, which reads as a flash rather than a movement.

- `animate-wd-card-in` — the four figures rise in, staggered 70ms apart, so the row assembles as four
  objects rather than one painted band.
- `animate-wd-accent` — the gradient bar across each card's top draws on from the left, 170ms after
  its own card lands.
- `useCountUp` — the figures animate from their **previous** value, not from zero. Counting up from
  zero on every refresh would make a number that did not change look like news. It runs on
  `requestAnimationFrame`, so a dashboard left open on another monitor is not burning cycles.

The stagger is one `--wd-delay` custom property per card, not two inline `animationDelay` values:
the accent bar is a child, so it inherits the number and offsets from it.

All of it has a `prefers-reduced-motion` branch — `animation: none` for the entrances, and
`useCountUp` returns the value untouched without ever scheduling a frame. That media listener is
live, so toggling the OS setting takes effect without a reload. The rule is scoped to these classes
rather than applied globally: the rest of the application's animations predate it, and silencing
them from here would change screens this work never touched.

## Filters

The calendar filters on two dimensions, both multi-select:

- **Kind** — `WorkKind`: `approval`, `task`, `meeting`, `reminder`.
- **Module** — whatever modules the data actually holds.

They compose as AND, so "approvals in Project Management" is two clicks. An empty selection means
*everything*, not nothing — a chip row that blanks the screen when you deselect the last chip reads
as broken. `filterWorkItems` encodes that and `tests/work-dashboard.test.mjs` asserts it.

The whole toolbar — navigation, month label, count, both filter groups, Clear, and the Year/Month/Day
switcher — is one row. It is `flex-nowrap` with `overflow-x-auto` and every group `shrink-0`, so a
narrow screen pans the toolbar sideways rather than reflowing it into two or three lines. Do not swap
that back to `flex-wrap`: with this many controls it wraps immediately, which is what it looked like
before. Allowing the groups to shrink instead of scroll is the other trap — the chips compress to
unreadable slivers long before anything overflows.

`kind` is declared by each source, never inferred from the module. Only the source knows: an
`insuranceTasks` row and an `officeHubTasks` row are both tasks despite sharing no fields, and a
`poIssueApprovals` row is a decision despite living in Project Management. Inferring from the module
name would collapse all seven Project Management workflows into one bucket — which is what the module
badge already gives you. Two judgement calls worth knowing:

- **HR interviews are `task`, not `meeting`.** An interview has a time, but it is not an Office Hub
  meeting, and it must not surface under a Meetings filter people use to find their calendar.
- **Insurance and vehicle-insurance renewals are `task`, not `approval`.** They are workflows with a
  step and an assignee, but what they ask is that you *do* the renewal, not approve someone else's.

## Rows are one line, and the table scrolls itself

Each row is a single line. The `Item` column carries `w-full max-w-0` — the CSS-table truncation
idiom, which looks like a mistake and is not: a table cell ignores `text-overflow: ellipsis` while
its intrinsic width can still grow, so a long subject either wraps or pushes the other columns off.
`max-width: 0` with `width: 100%` makes it the column that absorbs the leftover width and clips
inside it. Every other column is `whitespace-nowrap`.

The rows scroll inside the table with the header pinned (`maxHeightClassName="sm:max-h-[28rem]"`),
rather than lengthening the page — seventeen overdue approvals should not push the figures and the
other lanes off screen. Do **not** wrap it in a `ScrollArea` to achieve this: `DataList`'s wrapper is
already a scroll container, so a sticky header pins to the wrong element and rides away with the
rows. `maxHeightClassName` is the mechanism that handles it correctly.

## The table, and why the only action is "Open"

Each lane is a `DataList` — a real table on a desktop, one card per row on a phone, from a single
column spec. The action column holds **Open** (or **Details** for a meeting), plus **Join** when the
row carries an `actionUrl`, which only meetings set, from `OfficeHubMeeting.meetingUrl`.

There is deliberately no inline Approve or Reject. Each of the nineteen assigned sources has its own
decision rules — E-Approval alone has a policy engine covering the verification stack,
return-to-any-step, supersede-on-material-change and the approval matrix, and most modules require a
comment or an attachment with a decision. A one-click Approve here would either reimplement all of
that and drift from it, or bypass it. Neither is an acceptable thing to do to an approval trail, so
the dashboard's job ends one click from the screen that owns the decision.

If inline decisions are ever wanted, do it per module against that module's own service function —
not generically across the registry.

## The `shared/` components

`KpiCard`, `PageHeader`, `DataList` and `CellLink` were all in `@/components/hr/hr-ui` and are used
far beyond HR — fifty files. They now live in `@/components/shared/`, and `hr-ui.tsx` re-exports them
under their original `Hr`-prefixed names, so no existing call site changed.

They moved because `hr-ui.tsx` imports `@/lib/hr-requirement` for its status and currency helpers,
and through it `hr-policy.ts` — roughly 3,600 lines of HR business rules. Fine on an HR screen;
not fine on the home page, which wanted a KPI card and a table and would otherwise have shipped the
entire HR rulebook to draw them. New code should import from `@/components/shared/`.

## A shared queue is gated on permission to *act*

Not on permission to look. This was wrong on first release and is worth recording, because the
distinction is easy to lose: both permission-routed queues were gated on `can('View Module', …)`.
That put a row reading "4 entries awaiting action", with an Open button, in front of anybody who
could merely *see* the module — including people with no power to move a single one of those
entries. A dashboard that says something needs your action when it does not is worse than one that
omits it, because the only way to find out is to open it and discover there are no buttons.

`shared` still means "nobody is named" — that part was right. It now *also* means "and you are one
of the people who could take it".

- **Daily Requisition** goes further than gating: `actionableRequisitionStatuses` maps each pipeline
  stage to the permissions that move an entry out of it, and the count covers **only the stages this
  viewer can move**. A verifier sees the entries awaiting verification, not the whole pipeline
  including the ones sitting with Finance. The row's `stage` names which stages were counted, so it
  cannot imply more than it means. No actionable stage → the source is skipped entirely.
- **Store & Stock** requires one of `STOCK_POSTING_ACTIONS` (Post Receipt, Post Issue, Approve
  Transfer, …) on `Store & Stock Management.Inventory`.

The two E-Approval queues and the FD/BG/LC one are untouched, and correctly so: those are routed by
the workflow itself — `currentDepartmentIds`, `currentRoles`, `requiredRole` — so the record really
is addressed to that department or role. That is different from "you happen to be able to see this
module".

This logic lives in `work-dashboard.ts`, not in the sources file, specifically so it can be tested
without Firestore. `tests/work-dashboard.test.mjs` asserts that a view-only permission set yields no
actionable stages, that a verifier gets exactly `['Received']`, and that no member of
`STOCK_POSTING_ACTIONS` is a `View*` permission.

## The lanes

- `action` — a field on the record names this user. They are accountable.
- `shared` — their role or permission admits them to a queue that names nobody.
- `meeting` — a calendar commitment, or an invitation awaiting a response.
- `watching` — requester, watcher, or reminder subject. No action implied.

`action` and `shared` stay separate on purpose. Merging them would be the one genuinely misleading
thing this screen could do: you could not tell what you are accountable for from what anybody in
your role could pick up. `dropLowerLaneDuplicates` ensures a record that qualifies for both appears
once, in `action`.

## The field-name inventory

The reason no central view existed before: eleven names for one concept.

| Module | Collection | "pending with me" | Lane |
| --- | --- | --- | --- |
| E-Approval | `eApprovalRequests` | `currentAssigneeIds`, `currentDepartmentIds`, `currentRoles`, `requesterId` | action / shared / watching |
| Office Hub | `officeHubTasks` | `assigneeId`, `watcherUserIds` | action / watching |
| Office Hub | `officeHubActionItems` | `responsibleUserId` | action |
| Office Hub | `officeHubDecisions` | `ownerId` | action |
| Office Hub | `officeHubMeetings` | `participantUserIds` | meeting |
| Office Hub | `officeHubParticipants` | `userId` + `response` | meeting |
| Office Hub | `officeHubReminders` | `userId` | watching |
| Site Fund Request | `siteFundRequests` | `assignees` | action |
| Site Fund Requisition 2 | `requisitions` | `assignees` | action |
| Insurance | `insuranceTasks` | `assignees` | action |
| Tour, Travel & Expense | `travelRequests` | `currentApprovers` | action |
| Recurring Payments | `paymentObligations` | `assignedTo`, `verifierId`, `approverId`, `accountsProcessorId` | action |
| Vehicle Management | `vehicleManagementInsuranceWorkflowCases` | `assigneeIds` | action |
| HR & Recruitment | `hrRequirements`, `compensationApprovals`, `offers` | `pendingApproverIds` | action |
| HR & Recruitment | `interviews` | `interviewerIds` | action |
| Project Management | `projects/*/indents` and six siblings | `assignees` (collection group) | action |
| FD / BG / LC | `approvals` | `requiredRole` — **no user field at all** | shared |
| Store & Stock | `inventoryDocuments` | none; `Submitted` is open to whoever holds Approve | shared |
| Daily Requisition | `dailyRequisitions` | none; routes by status and per-tab permission | shared |

## Deliberate omissions

- **Employee → Leave.** Read-only from greytHR; applying and approving happen there, not here
  (`docs/greythr-integration.md` §12). Nothing to action.
- **Chat.** The header already carries a live unread count from a single indexed query.
- **Charts and per-person productivity figures.** A count of somebody's open items is not a measure
  of their output. Same rule as Office Hub's management overview (§73).
- **A count badge in the header.** It would run the whole fan-out on every page in the application
  rather than on the one screen that displays it.

## Never hand-write a status list

Filters are derived from each module's own union — `OPEN_E_APPROVAL_STATUSES`,
`TASK_STATUSES` minus `CLOSED_TASK_STATUSES`, `DECISION_STATUSES` minus its closed pair — never
typed out at the call site.

This is the one rule in this document written in blood. The E-Approval source shipped filtering on
`['PENDING', 'IN_PROGRESS', 'RETURNED', 'DRAFT_RETURNED', 'CLARIFICATION']`. Every one of those is
invented; the real statuses are Title Case with spaces (`'Pending Approval'`,
`'Pending Verification'`, `'Pending Clarification'`). **Nothing failed.** No type error — the values
were compared as strings. No exception, no empty state, no entry in the failure notice. The filter
simply matched none of the fourteen real statuses, so the source returned zero rows and the board
told people with approvals waiting that their inbox was clear. The same mistake was live in
`windows-agent-morning.ts` at the same time, zeroing the morning screen's approval count.

A status filter cannot be wrong loudly, so it has to be wrong provably:
`tests/work-dashboard-statuses.test.mjs` asserts every filter list is a non-empty subset of the
union it selects from, and that the five invented constants above still do not exist.

## Collection names and statuses that were wrong

All found while verifying what each module actually stores, and all fixed:

1. **`officeHubReminders.status == 'PENDING'`** in `windows-agent-morning.ts`. `ReminderStatus` is
   `'Scheduled' | 'Sent' | 'Failed' | 'Cancelled'` and `office-hub-reminders.ts` only ever writes
   `'Scheduled'`, so the morning dashboard's reminder count was structurally always zero.

2. **`eApprovalRequests.status in ['PENDING', 'IN_PROGRESS', 'RETURNED']`**, also in
   `windows-agent-morning.ts` — the same non-existent constants described above, so its
   `pendingApprovals` figure was always zero too. Both now use `OPEN_E_APPROVAL_STATUSES`.

   That constant moved from `e-approval-service.ts` to `e-approval-policy.ts` to make this possible:
   the service module is `'use client'` and the morning summary is an Admin-SDK `server-only` path.
   The policy module is the dependency-free one by design. It is re-exported through `e-approval.ts`
   as before, and is now derived from `E_APPROVAL_STATUSES` rather than restated.

3. **Two crossed entries in `api/workflow/check-escalations`.** Its `daily-requisition-workflow`
   entry pointed at `requisitions`, which is *Site Fund Requisition 2's* collection — so it measured
   SFR2 records against Daily Requisition's step config. Its `site-fund-requisition-2-workflow` entry
   pointed at `siteFundRequisitions2`, a name nothing in the repository writes, so SFR2's configured
   TAT escalations had never fired.

   **Deploying the fix will make SFR2 escalations fire for the first time.** Each item escalates once
   (`dispatchNotificationOnce` dedupes, and `escalationNotifiedStepId` is stamped), but a backlog
   accumulated while it was broken will produce one burst on the first cron run after deploy.

Still absent from that registry, and left alone on purpose:

- **Site Fund Request** has the same `currentStepId` / `assignees` shape and has never had
  escalation. Adding it would start alerts for a module that has never sent them — a decision to
  take knowingly, not a drive-by.
- **Daily Requisition** cannot be escalated as the route is written: `DailyRequisitionEntry` has no
  `currentStepId`, so `if (!stepId) continue` skips every row. Giving it TAT escalation means giving
  the module a step pointer first.
