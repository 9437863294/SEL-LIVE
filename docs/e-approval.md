# E-Approval / E-Notesheet

The central approval engine for the ERP. Any employee raises a note-sheet; it routes through approval,
verification and clarification steps until it is approved, rejected, returned or cancelled. Other
modules (Purchase, HR, Site Expenses, Travel, LC/BG/FD, recurring payments, vendor onboarding) are
intended to call this engine rather than each building their own approval logic.

## Where the code lives

| File | Responsibility |
| --- | --- |
| `src/lib/e-approval-policy.ts` | **The engine.** Pure, dependency-free, unit-tested. Every rule: the verification stack, return-to-any-step, supersede-on-material-change, the approval matrix, parallel groups, SLA and escalation. |
| `src/lib/e-approval.ts` | Firestore data model + collection names. Re-exports the policy module so consumers import from one place. |
| `src/lib/e-approval-service.ts` | Firestore reads and writes. Loads state, calls the engine, persists the result atomically, delivers notifications. |
| `src/components/e-approval/*` | Screens and shared UI. `admin/*` holds the configuration panels. |
| `src/app/(protected)/e-approval/*` | Routes. |
| `src/app/api/e-approval/escalations/route.ts` | Admin-SDK reminder/escalation sweep, for a scheduler. |
| `tests/e-approval-domain.test.mjs` | 71 engine tests. `npm run test:e-approval`. |
| `tsconfig.e-approval.json` | Module-scoped typecheck. `npm run typecheck:e-approval`. |

## The one idea everything rests on

**Approval, verification and clarification are different task types, and only approval owns the
document.** A verification or clarification is a *child* step, created by an approver who is still
holding the file. When it finishes, control returns to the exact step that asked for it — however deep
the nesting went.

```
Director (APPROVAL, depth 0)          ← originStepId of the step below
  └─ Finance Manager (VERIFICATION, depth 1)
       └─ Accounts Executive (VERIFICATION, depth 2)
```

Accounts completes → Finance resumes → Finance completes → Director resumes.

There is no separate stack structure to keep in sync: **the stack _is_ the `parentStepId` /
`originStepId` chain on the step records**, so it survives a page reload, a different device and a
cron run. `completeAndAdvance` pops it by re-activating `originStepId` once no open children remain.

Forwarding and delegation are deliberately *not* child steps — they change who owns the current step,
so they reassign it in place rather than pushing a level.

## Step model

Steps are documents in `eApprovalSteps`, not an array on the request: "everything pending with me" has
to be one indexed query across every open approval. The request carries denormalised
`currentAssigneeIds` / `currentDepartmentIds` / `currentRoles` / `currentDueAt` pointers so the inbox
and the overdue list stay single queries; the step documents remain the source of truth.

Key fields:

- `sequence` — position in the primary chain. **Fractional values are legitimate**: an inserted
  approver takes the midpoint between its neighbours, so no step with history is ever renumbered.
- `depth` — 0 for the primary chain, 1 for a verification of it, 2 for a verification of that.
- `parentStepId` / `originStepId` — the verification stack.
- `groupId` / `groupMode` / `groupRequiredCount` — parallel approval (All / Any / N-of-M).
- `pausedAt` / `pausedMs` — a paused clock is paused, not stopped. An approver waiting on a
  verification, or a file on hold, accumulates paused time and `dueAt` is recomputed from it.
  Otherwise every approver who asked a question would breach an SLA for the time the answer took.
- `version` / `supersededInVersion` — which version of the content this step's decision relates to.

`isChildEApprovalStep` decides pop-vs-advance by **position (`depth`), not by type**. A template may
legitimately place a verification stage in the primary chain ("Finance Verification" between Purchase
and Director in the seed Purchase template); such a step is a stage, not a child, and treating it as
one would strand the file with nobody holding it.

## The actions

`applyEApprovalAction(request, steps, input)` is a pure reducer returning
`{ request, steps, events, notifications }`. `now` and `nextId` are injected, which is what makes it
testable as a table and lets the same function run on the client, in a service call and in the cron.

| Action | Effect |
| --- | --- |
| Submit | Activates the first group. Only the requester, only from Draft. |
| Approve | Completes the step; advances once its parallel group is satisfied. |
| Approve & Complete | Approves and skips every remaining step. Only where the stage enables `canFinalise`. |
| Send for Verification | Creates child step(s); the parent goes to `Awaiting Verification` with its clock paused. |
| Verify | Verified / Verified With Observation / Not Verified. Pops to the parent. |
| Request Clarification / Provide Clarification | Same mechanism, `CLARIFICATION` type. |
| Return | To the requester, or to any earlier completed step. Reason required. |
| Forward | Reassigns the current step. Ownership transfers; fresh clock. |
| Delegate | Adds an authorised actor; the assignee keeps the step. Recorded as "on behalf of". |
| Add Approver | Inserts a step at the midpoint after the current one. |
| Escalate | Reassigns to a senior authority; fresh clock. |
| Reject | Closes the request; cancels everything open. Reason required. |
| Hold / Resume | Pauses and restarts the clock. Only the holder can release it. |
| Cancel | Requester only, while not terminal. |
| Resubmit | Requester only, from Returned. Runs change detection (below). |
| Take Ownership | Claims a department-queue step. |
| Add Participant | Grants view/comment access. |

Anything the actor is not entitled to do throws `EApprovalRuleError` rather than silently no-oping —
a swallowed transition on an approval workflow is a file nobody can explain.

## Return-to-any-step

Returning to step *T* from step *C*:

- *T* becomes Active again, with `returnedFromStepId = C`.
- Every primary step between them is **re-opened** (`Pending`, `reopened: true`), so the chain runs
  forward in its original order rather than jumping back to the returner.
- *C* waits its turn again.
- Verification hanging off any re-opened step is cancelled.

Returning to the **requester** parks the whole chain instead: earlier approvals stand, the returning
step is recorded as `Returned`, and `returnResumeStepId` remembers where to resume. A `Resubmit` with
no material change goes straight back to whoever returned it — a typo does not cost three signatures.

## Change control (the most important audit rule)

`detectEApprovalMaterialChange` / the service's fingerprint comparison decide whether an edit
invalidates approvals already given. Default material fields: subject, proposal body, amount,
department, project, attachment set. Amount changes above `amountTolerancePct` (default 0 — *any*
change) count.

On a material change at resubmission:

1. Every completed step is marked `Superseded` with the old version number.
2. `version` is bumped and the old content is snapshotted into `eApprovalVersions`, together with the
   approvals that had been given against it.
3. The chain restarts per `restartOnMaterialChange` (default: the first step).
4. Everyone whose **positive** decision was superseded is notified. The approver who *returned* the
   file is not — they asked for the change.

This is what stops ₹5,00,000 becoming ₹9,00,000 under three existing approvals.

## Authority vs. visibility

**Being assigned a step is the authority to act on it.** `availableEApprovalActions` derives the
action list from the step's type and its configured capabilities, never from the actor's role
permissions: the verifier a Director picked is authorised by that assignment, and demanding they also
hold a matching role permission is how a file ends up parked with somebody who cannot move it.

Role permissions (`permissions.ts` → `"E-Approval"`) therefore gate *raising*, *seeing* and
*administering* approvals — there is no "Approve" or "Verify" permission. Visibility is
`canViewEApproval`: participants always see their own file; `View All` / `View Department` open it to
others; a confidential file additionally needs `View Confidential`.

## Department steps

The codebase has no user→department field (department scope is expressed through permission scopes,
and employees are a separate collection keyed by name). So department membership *for approval
purposes* is stated explicitly in `eApprovalDepartmentRouting`, one document per department, with a
mode:

- **Anyone** — any listed member can act; claiming it locks it to them.
- **Head** — routes straight to the head.
- **Queue** — held for the head to assign.

With no routing document configured, a department step can only reach that department's head. That is
the safe failure, not a silent one.

## Firestore collections

```
eApprovalRequests        the note-sheet
eApprovalSteps           one document per workflow step (the "tasks")
eApprovalComments        discussion; edits append to editHistory, never overwrite
eApprovalAttachments     never overwritten; grouped by request version
eApprovalHistory         append-only audit trail
eApprovalVersions        superseded content snapshots
eApprovalTypes           purchase / leave exception / site expense …
eApprovalTemplates       named chains of stages
eApprovalRules           the approval matrix (amount bands etc.)
eApprovalDepartmentRouting
eApprovalDelegations     substitute approvers, dated
eApprovalSettings        one document per organisation
eApprovalCounters        reference-number sequences, per FY and department
```

Three collections the original spec lists are deliberately absent:

- **approvalTasks** — a task *is* a step. Keeping both means keeping them in step.
- **approvalNotifications** — uses the existing central `userNotifications` (`@/lib/notifications`),
  so approvals appear in the same header bell as everything else.
- **approvalPermissions** — uses the existing role system (`@/lib/permissions`), which already
  resolves nested resources.

Dates the engine reads or writes (`startedAt`, `dueAt`, `pausedAt`, `completedAt`) are ISO strings, so
the engine can run under Node with no Firebase installed. The six shared audit stamps stay Firestore
`Timestamp`s written by `withCreateAudit`, so these records sort and render like every other module's.

## Reference numbers

`EA/FIN/2026-27/00125`, or `EA/2026-27/00125` with department codes switched off. Allocated **on
submission** inside a transaction (`eApprovalCounters`), keyed by organisation + financial year +
department code — two people submitting in the same instant is the ordinary case, and duplicate
reference numbers on approved documents are not recoverable after the fact.

## SLA, reminders and escalation

Per-step `slaHours`, scaled by the request's priority (`Urgent` = ¼ of the base, `Low` = 1½). The
ladder (`escalationLadder`, default 0/24/48/72/96 hours) fires reminders, escalations and a
requester notification. `resolveDueEApprovalEscalations` excludes paused time and is idempotent —
each step records the rules already fired — so the sweep is safe to run as often as you like.

Schedule `GET /api/e-approval/escalations` (guard it with `CRON_SECRET`). It can also be run on demand
from Administration → Control & SLA → **Run now**.

## Setting it up

1. **Administration → Approval Types** — add the types your organisation raises note-sheets for.
2. **Workflows** — *Add samples* seeds the three chains from the spec (Purchase, Leave Exception,
   Site Expense) with role-based stages; assign real people or roles to them.
3. **Approval Matrix** — amount bands per type/department, each pointing at a workflow. Use the tester
   at the bottom to confirm a given type and amount routes where you expect.
4. **Department Routing** — for every department that will receive department-addressed steps.
5. **Control & SLA** — change-control fields, restart policy, numbering, reminder ladder.
6. **Module Hub** — add a module titled `E-Approval` with icon `Stamp`; the card links to
   `/e-approval` automatically.
7. **Roles** — grant `E-Approval` permissions. Remember there is no "Approve" permission by design.
8. Deploy the new Firestore indexes (`firebase deploy --only firestore:indexes`).

## Not built

Stated plainly so nobody hunts for them:

- **WhatsApp/push delivery** — notifications go to the in-app bell (and whatever channels the central
  notification system already fans out to). No WhatsApp integration.
- **Voice-note comments** — spec section 7 lists these as "later if required".
- **Drag-and-drop visual workflow canvas** — the builder is a structured list editor with ordering,
  parallel groups and per-stage capabilities, not a node graph.
- **Per-approval-type notification rule editor** — the ladder is organisation-wide with an optional
  `approvalTypeId` on each rule; there is no per-type UI for it yet.
- **Other modules calling the engine** — the engine is ready for it (`submitEApproval` +
  `performEApprovalAction` take everything they need), but no existing module has been migrated onto
  it.
