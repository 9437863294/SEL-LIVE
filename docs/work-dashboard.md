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

## Collection names that were wrong

Both found while verifying which collection each module actually uses, and both fixed:

1. **`officeHubReminders.status == 'PENDING'`** in `windows-agent-morning.ts`. `ReminderStatus` is
   `'Scheduled' | 'Sent' | 'Failed' | 'Cancelled'` and `office-hub-reminders.ts` only ever writes
   `'Scheduled'`, so the morning dashboard's reminder count was structurally always zero.

2. **Two crossed entries in `api/workflow/check-escalations`.** Its `daily-requisition-workflow`
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
