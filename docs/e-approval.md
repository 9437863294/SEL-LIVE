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
| `tests/e-approval-domain.test.mjs` | 89 engine tests. `npm run test:e-approval`. |
| `tsconfig.e-approval.json` | Module-scoped typecheck. `npm run typecheck:e-approval`. |
| `src/lib/e-approval-manual.ts` | **The handbook, as data.** The single source for both the in-app Guide and the Word manual. |
| `src/app/(protected)/e-approval/help/page.tsx` | The Guide screen — renders the handbook with an audience filter and full-text search. |
| `scripts/build-e-approval-manual.mjs` | Renders the same handbook into `.docx`. `npm run manual:e-approval`. |
| `src/lib/e-approval-pdf-signing.ts` | Pure signature-placement geometry + the `pdf-lib` embedding call. Unit-tested (`tests/e-approval-pdf-signing.test.mjs`). |
| `src/components/e-approval/signature-pad.tsx`, `sign-attachment-dialog.tsx` | Capturing a signature and burning it into a PDF attachment. |

## The handbook

`src/lib/e-approval-manual.ts` holds the user and administrator manual as a structured array. Two
things render it: the in-app Guide at `/e-approval/help`, and `npm run manual:e-approval`, which emits
`docs/E-Approval-Manual.docx` and `public/docs/E-Approval-Manual.docx` (the second is what the Guide's
download button serves).

Editing that one file corrects both. A tutorial page maintained separately from the distributed manual
is two documents that disagree by the next release, and the reader has no way to know which is stale.

The docx is generated as raw WordprocessingML through `jszip` rather than a docx library, because
`jszip` is already in the tree. Two things to know if you touch that script: every OOXML property
element (`w:pPr`, `w:rPr`, `w:tblPr`, `docProps/core.xml`, `docProps/app.xml`) is a **strict sequence**,
and Word's only complaint about a mis-ordered one is "the file appears to be corrupted" with no
indication of which part. Well-formed XML is not enough — open the output in Word after changing it.

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
| Take Ownership | Claims a department step. Any member in 'Anyone' mode; only the head in 'Queue' mode. |
| Assign | Department head hands a department step to a named member (or moves it between members). Sets `ownedByUserId`; the assignment stays departmental. Recallable. |
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
eApprovalSignatures      one per user — their saved signature image, overwritten on replace
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

## My Activity — one person's own log

`/e-approval/my-activity` answers "what have I actually done" — every approve, verify, return,
reject, forward, delegate, escalate, hold, recall and reverse a person has personally carried out,
across every approval, newest first. Nothing new is recorded for it: `eApprovalHistory` was already
the complete, append-only record of every action; this screen is the first thing that reads it back
filtered to one `actorId` instead of one `approvalId`.

Two things make that one query instead of an N+1:

- **`referenceNo`, `subject`, `requesterId`, `requesterName` and `departmentName` are denormalised
  onto every history entry at write time** (`commitEApprovalTransition`), the same way steps already
  denormalise them. Reading the request `subject` back per matching history entry — after the fact,
  across however many approvals a person has ever touched — is exactly the pattern this module avoids
  everywhere else. Entries written before this field existed have none of the five; the screen falls
  back to a bare "View approval" link rather than a blank title.
- A new composite index, `eApprovalHistory: organizationId ASC, actorId ASC, recordedAt DESC`
  (`firestore.indexes.json`), makes `where('actorId', '==', userId) orderBy('recordedAt', 'desc')` a
  single indexed query. Deploy it with the others (`firebase deploy --only firestore:indexes`).

`listEApprovalMyActivity` bounds the result at 500 and reports `truncated` rather than paginating —
the same choice `loadEApprovalAnalyticsData` makes, for the same reason: a bound the screen admits to
is honest, a page number is scaffolding nobody asked for yet.

Deliberately excludes two things that would otherwise leak in: the cron's own `Escalation Fired`
entries (`actorId: 'system'`, never matches a real user) and actions a delegate took on *this*
person's steps (`onBehalfOfUserId === them`, `actorId` is the delegate) — that is what the delegate
did, correctly attributed to the delegate's own log, not to the person they were covering for.

## Signing an attachment

Any PDF attachment can be signed from the Attachments tab. This is a **visual mark, not a
cryptographic signature** — the same trust model as signing a paper note-sheet by hand: the record
shows who placed it, when, and on which page, not a certificate chain. A legally-binding digital
signature (a DSC — eMudhra, (n)Code, a USB token, the kind GST/MCA filings use) is a materially
different feature: it needs a licensed certificate provider, is issued to a person rather than drawn
by them, and cannot be added by a web app on its own. If that is ever needed, it is a separate
integration, not an extension of this one.

How it works:

1. **`eApprovalSignatures/{userId}`** holds one saved signature per person — drawn on a canvas or
   uploaded as an image, converted to PNG and (for a drawn one) cropped to its own ink's bounding box
   so a small signature is not stretched to a fixed pad's aspect ratio (`signature-pad.tsx`). Saved
   once, reused every time; replacing it overwrites the old one, because a signature is a personal
   setting rather than part of any approval's record. `EApprovalSignaturePad` is mounted in two
   places — proactively on `/e-approval/my-activity` ("My Signature"), and inline inside the sign
   dialog for whoever has not set one up yet — so setting it up is never gated behind first finding a
   document to sign.
2. **`computeEApprovalSignaturePlacement`** (`e-approval-pdf-signing.ts`, pure, unit-tested) turns a
   page size, one of nine anchors (corners, edges, centre), a width-as-percentage-of-page-width, and
   an optional fine offset into an `{x, y, width, height}` in PDF point-space, clamped fully on the
   page. There is deliberately no live page preview — that would need a PDF-rendering dependency
   (e.g. `pdfjs-dist`) to draw the actual page for drag-and-drop placement. The nine-anchor picker is
   the cheaper, still-real v1; a WYSIWYG placement is the natural upgrade if this proves imprecise.
3. **`signEApprovalAttachment`** fetches the original PDF and the saved signature (both already
   reachable client-side via their Storage download URLs — no server round trip), embeds the PNG with
   `pdf-lib`, and uploads the result as a **new** attachment with `signedFromAttachmentId` pointing at
   the original. The source PDF is never touched, the same rule every attachment in this module
   already follows for a revised quotation. A document can be signed more than once — signing an
   already-signed copy adds a second mark, which is what a note-sheet needing two signatories on one
   document actually wants.

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
from Settings → Policies → **Run now**.

## Setting it up

1. **Settings → Approval Types** — add the types your organisation raises note-sheets for.
2. **Workflows** — *Add samples* seeds the three chains from the spec (Purchase, Leave Exception,
   Site Expense) with role-based stages; assign real people or roles to them.
3. **Approval Matrix** — amount bands per type/department, each pointing at a workflow. Use the tester
   at the bottom to confirm a given type and amount routes where you expect.
4. **Department Routing** — for every department that will receive department-addressed steps.
5. **Policies** — change-control fields, approver powers, recall/reverse windows, reminder ladder, numbering.
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
- **A cryptographic digital signature (DSC)** — signing an attachment burns a visual signature image
  into the PDF (see "Signing an attachment" above); it is not a certificate-backed, legally-binding
  signature and does not attempt to be. That is a separate integration with a licensed provider.
- **Live PDF placement preview** — the sign dialog offers nine fixed anchors and a fine offset rather
  than a draggable preview of the actual page, to avoid a PDF-rendering dependency for v1.

## Recall and reverse (taking an action back)

Two distinct powers, deliberately kept apart the way approval and verification are:

| | **Recall** | **Reverse** |
| --- | --- | --- |
| Who | the person who performed it | somebody holding `Reversals → Reverse Any` |
| What | a *dispatch* — verification, clarification, forward, delegate, add approver, escalate | a *decision* — approve, verify, return, reject, hold, take ownership (and dispatches) |
| Window | `recallWindowMinutes`, default **15** | `reverseWindowHours`, default **24** |
| Permission | none — it is your own dispatch, the window is the control | yes, explicitly |

Both additionally require that the action is **the most recent structural action on the file** and has
not already been undone. That guard is what keeps recall honest: once the verifier has replied, taking
the request back would erase their work rather than your mistake, so it becomes a reversal instead.
Comments and reminders in between do not block anything — neither moved the file.

Neither power deletes. The original action stays in `eApprovalHistory` and the undo is appended after
it, carrying `undidEventId`, who did it and why.

### How it works

Every action stores a snapshot of what it changed, on its own history entry, in `EApprovalEvent.undo`:
the pre-action state of each step it touched, the ids of steps it created, and the whole pre-action
request. That record is produced by **diffing the step list before and after the transition**, not by
hand-written inverse logic per action — so a new action is undoable for free and there is no second
definition of "the inverse of a forward" to drift out of step.

Undoing therefore replays a snapshot rather than computing an inverse. Two consequences worth knowing:

- The request is **replaced** from the snapshot, not merged into it. `Object.assign` alone would leave
  a field the action *introduced* — `holdReason` on a hold, `rejectionReason` on a rejection — still
  sitting there explaining a state the file is no longer in.
- Steps a recall removes are **deleted**, not cancelled. Within a fifteen-minute window nothing
  happened worth recording beyond the recall itself; a cancelled step in somebody's history for a
  dispatch that was taken back in two minutes is noise.

`tests/e-approval-domain.test.mjs` pins this down by round-tripping: dispatch, recall, and assert the
request and step list are byte-for-byte what they were before.

### Where it appears

On the **Activity** tab of an approval, against the entry itself. The author sees *Recall* with the
time remaining; once that window closes, a user with the permission sees *Reverse*. Both open a dialog
that names what is being undone and takes a reason (required for a reversal). Whoever the work was
taken back from is notified that it has been withdrawn and no action is needed.

Windows and on/off switches live in **Settings → Policies → Recall & Reverse**.

## Settings

A hub at `/e-approval/settings` with one card per section, each opening its own page — the same shape as
`site-account-statement/settings-hub.tsx`. One name, one place: this is what other modules in the app call
Settings, so it is called that here too.

| Section | Route | Answers |
| --- | --- | --- |
| **Approval Types** | `settings/types` | what can people raise? |
| **Workflows** | `settings/workflows` | what chains exist? |
| **Approval Matrix** | `settings/matrix` | which chain does a request take? |
| **Department Routing** | `settings/departments` | who does a department step actually reach? |
| **Policies** | `settings/policies` | change control · approver powers · recall & reverse · reminders · numbering |
| **Delegations** | `/e-approval/delegations` | substitute approvers (surfaced here, lives outside settings) |

Cards are filtered by the viewer's `Settings.<node>` permission, and each page re-checks its own node
through `SettingsSection` — so a section cannot ship with its gate forgotten. A user with View but
not Edit gets the page in read-only, labelled as such.

**Why pages and not tabs.** Tabs hid four of five sections behind a click, left no room to say what a
section was for, and put unrelated forms on one screen where a stray Save could touch something the
person was not looking at.

**Why Policies is still one page.** Every setting on it lives in the same Firestore settings document.
Splitting one document across five pages with five Save buttons is how a save on one page silently
reverts an edit made on another. Within it the cards run most-consequential first — change control,
approver powers, recall & reverse, reminders, and numbering last.

Two groupings were fixed on the way. *Approval Matrix* and *Department Routing* both answer "who gets
it" and now sit adjacent in the hub. And the four switches governing nesting, return-to-any-step and
approve-&-complete used to live inside the **Change Control** card, which they have nothing to do
with; they are now their own **What approvers may do** card, described as what they are —
organisation-wide ceilings a workflow stage can lower but never raise.
