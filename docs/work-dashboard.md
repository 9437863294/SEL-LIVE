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

## One calendar, no extra queries

The work tab has two sub-tabs: **List** and **Calendar**. They are two arrangements of one dataset —
the calendar takes the same `lanes` the list already has and groups them by date via `itemsByDate`.
It issues **no queries of its own**, so switching is free and the two views cannot disagree.

That is also what makes it "all the calendars in one". Anything with a `dueAt`, from all four lanes,
lands on a day: Office Hub meetings with their start times, E-Approval deadlines, task and action-item
due dates, insurance premium and maturity dates, tour departures, recurring payment dues, vehicle
insurance expiries, HR interview slots, reminders. Previously each of those was on its own module's
screen, and several modules have a `/calendar` route that only ever knew about its own records.

Undated rows — the aggregate shared-queue rows especially — are counted and reported at the foot
rather than parked on today. A task with no deadline is not due now, and placing it there would make
the day look busier than it is.

`@/components/office-hub/meeting-calendar` is deliberately untouched and unshared. It is 700 lines
built around Office Hub's own entry shape with four views and drag-to-reschedule through
`updateMeeting` — the right screen for working *on* meetings, and structurally unable to show an
approval deadline. This one is read-only and cross-module. Two different jobs.

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
