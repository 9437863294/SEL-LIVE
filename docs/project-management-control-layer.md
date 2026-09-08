# Project Control, Commercial & Management Intelligence Layer

*An additive layer above the existing Project Management execution module.*

**Status:** design, not yet implemented. No existing *capability* is removed by it.

This is the design-review artefact for the layer. It is written to be read alongside
[project-management-readiness.md](project-management-readiness.md), which documents the
execution module this sits on top of.

> **⚠️ Written against a pre-launch database**
>
> **SEL LIVE holds no production data yet.** That is a one-time window, and this design uses
> it. An earlier draft of this document went to considerable lengths to preserve existing
> record shapes — grandfathering flags, rule-based side-tables, wrap-and-emit seams — all of
> which existed *only* to avoid migrating live data. Those are gone.
>
> In their place, **Part 0** fixes the brittle joins underneath this layer rather than
> designing around them. The most important is that JMC/MVAC measurement items get a real
> `boqItemId`, retiring the tolerant composite-key match that is currently the single most
> fragile mechanism in the codebase.
>
> **This window closes the moment real data is entered.** Every item in Part 0 becomes an
> expensive migration after go-live, and two of them (the measurement join, the BOQ reserved
> fields) span modules other than this one.

---

## Context

The existing Project Management module (86 pages, ~58k lines, 27 collections, 150 passing
domain tests, clean scoped typecheck) is a **BOQ-driven execution system**. It records what
was surveyed, indented, quoted, purchased, drawn, cleared, inspected, dispatched, received
and accepted, and enforces the gate chain between those steps.

It cannot answer the *management* question: how much value has been earned, what it cost,
what was billed and collected, what the forecast profit and cash position are, and what
exposure the delays create.

This layer adds that. The governing rule:

> **Employees execute work in the existing module. The Control layer calculates management
> information automatically from that execution. No number is entered twice.**

The Control layer is predominantly a **consumer and calculator**. Where it owns data, that
data has no other home (contract terms, baselines, client bills, variations, claims, risks,
forecasts).

---

## Part 0 — Pre-launch foundation corrections

These are only possible while the database is empty. Each is a **schema correction**, not a
feature, and each is a prerequisite for something in Parts 3–7.

The discipline applied: *only fix what this layer actually needs, plus what is trivially cheap
now and expensive forever after.* Things that are merely imperfect are left alone.

### 0.1 Measurement items get a real `boqItemId` — **the important one**

Today, JMC and MVAC measurement items carry **no `boqItemId`**. They are joined to BOQ lines by
a composite key of `(Scope 1, Scope 2, BOQ SL No)`, built by `civilBoqKey()`, and because those
scope fields are stored with inconsistent spellings (`"Scope 1"`, `"scope1"`, `"Scope.1"`) the
lookup goes through `readLooseScope()`, which strips whitespace and dots and lowercases before
matching. Legacy scope-less items degrade to `"____<slNo>"` and *still match*.

That mechanism works, and it is carefully written — but it is a string match standing between
subcontractor payments and the quantities that justify them. It is the weakest load-bearing
join in the application, and the whole civil half of EVM would sit on top of it.

**Fix:** add `boqItemId` to measurement items at the point of creation (the JMC/MVAC entry
screens already have the BOQ item in hand — `BoqItemSelector` / `JmcItemSelectorDialog` select
it), then join by document id like work orders and bills already do.

- `civilBoqKey` / `civilBoqKeyOfBoqItem` / `readLooseScope` stay as a **fallback** for any row
  without `boqItemId`, so nothing breaks and the change is incremental.
- `aggregateMeasurementsByBoqKey` gains a sibling `aggregateMeasurementsByBoqItem`; the
  composite version is kept until the fallback is provably unused.
- **Crosses into Billing Recon and Subcontractors Management** — their entry screens write
  these records. This is the one Part 0 item that touches other modules' code.

### 0.2 Towers get `boqItemId`

A tower is linked to the BOQ line it executes directly, at creation and in the import wizard —
rather than through the rule-based side-table that would otherwise be needed to avoid touching
the tower schema (§3.0).

Because one BOQ line covers many towers (a "foundation" line spans a whole section),
the tower carries the reference and the roll-up aggregates upward — the natural direction, and
it means `filterTowers()` needs no second job.

Kept from the old design: `basis: 'per-tower' | 'per-span'`, because `stringing` and `opgw` are
measured per span and the existing summary already draws that distinction.

### 0.3 One variation model

`boqVariations` (quantity-only, inline approve) and the new commercial change order merge into a
single `projectVariations` record that carries **both** the quantity arm and the commercial arm
(rate impact, cost/revenue impact, time impact, client correspondence links).

The earlier design had the commercial record *emit* `boqVariations` rows to keep
`computeAvailableQty` working. With no data, that seam is unnecessary: `variationApprovedQty` is
recomputed from approved `projectVariations` instead, and the quantity ladder keeps working
unchanged because it only ever reads that one number.

### 0.4 Stable workflow step IDs, everywhere

The destructive `normalizeIds()` — which rewrites every step id to its 1-based array index on
load, delete, reorder *and* save — is duplicated in **7** workflow-configuration pages. Since
`currentStepId` is the live foreign key, reordering a step silently re-homes in-flight records.

**Fix:** delete all 7 copies and route those pages through the existing shared
`src/components/workflow/workflow-configuration-editor.tsx`, which already mints stable ids and
does not renumber on reorder. No backfill needed on an empty database.

This also removes the reason `workflows/jmc-workflow` being a single global document is
dangerous, so that stays as-is.

### 0.5 BOQ reserved fields

The dynamic-column model (`BoqItem = { id: string; [key: string]: any }`, columns configured per
org) **stays** — per-project BOQ shapes are a deliberate feature, not an accident.

What changes: the fields *code* depends on become **reserved, first-class, and typed**, instead
of being read through multi-alias tolerant getters:

| Field | Needed by |
|---|---|
| `scope1`, `scope2`, `boqSlNo` | WBS matching (§3.1), the measurement fallback |
| `hsnSac` | GST / e-invoice (§3.11) |
| `inventoryItemId` | Requirement Planner stock join (§3.20) |
| `qty`, `unit`, `unitRate`, `budgetPrice`, `totalAmount` | EVM budget (`projectBoqValue`) |

Display labels stay configurable; the *keys* stop moving. The existing loose readers
(`projectBoqQuantity`, `projectBoqUnit`, …) remain as fallbacks.

### 0.6 Inventory v2 becomes the store of record

The earlier design took the legacy `inventoryLogs` path purely because its `itemId` happens to
be the BOQ document id. That is the wrong system to build a new feature on.

**Fix:** commit to Inventory v2 and give it the two things it lacks — `boqItemId` on
`inventoryItems` (replacing the write-only `legacyBoqItemId`), and project resolution through
`InventoryLocation.projectId` where `type === 'Project Store'`. The legacy `inventoryLogs` path
is left running for the existing store screens.

### 0.7 SAS cost dimensions

Cheap now, expensive later, and needed the moment cost derivation replaces manual entry:

- `SASExpense.categoryId` alongside the existing `expenseCategory` name string — today a
  category rename orphans its own history.
- `SASExpense.globalProjectId` alongside `projectId`, removing the
  `siteAccountProjects.centralProjectId` → `projects/{id}` bridge from every future join.
- `costCodeId` on `SASExpense`, referencing the new cost-code master (§3.6) — the first such
  master in the repo. `costCentre` / `budgetHead` remain free text on e-approval,
  recurring-payments, tour-travel and hr-requirement; **retrofitting those is explicitly out of
  scope** and noted only so the inconsistency is a known one.

### 0.8 Security and indexes from day one

Not schema, but same window: there is no reason to ship the new layer's contract values and
margins before these are in place.

- Wire the missing `firestore` → `rules` key into `firebase.json` — **the existing 441-line
  rules file has never been deployed** — then write rules for the PM and Control collections
  and add a default-deny.
- Add the first PM entries to `firestore.indexes.json`, including `COLLECTION_GROUP` scope.
- Set `CRON_SECRET` (currently unset, while every cron route guards
  `if (!secret) return true` — so those endpoints are open) and register the new jobs in
  `scripts/setup-cloud-scheduler.sh`.

---

## Part 1 — Exploration findings that shape the design

Verified against the code, not assumed. Several of these **correct** common assumptions and
change the design materially.

### 1.1 ⚠️ Seven corrections worth reading before anything else

The first two contradict the requirement as written; the rest correct assumptions that would
otherwise have been designed around.

Findings marked **→ fixed in Part 0** were originally constraints to design *around*. On an
empty database they are instead corrected at the source, which is why Parts 3–7 are simpler
than the finding alone would suggest. The findings are kept here because they document why
the code looked the way it did, and because they will be true again for anyone reading this
after go-live.

| # | Finding | Consequence |
|---|---|---|
| 0a | **A tower has no `boqItemId`.** `ProjectTower`, `TowerActivityState` and `TowerProgressUpdate` carry **no BOQ reference of any kind** — the only linkage is the Firestore path `projects/{globalProjectId}/towers/{towerId}`. (`ProjectWorkPackage` likewise has none; it links by `scope`.) | **→ fixed in Part 0** (§0.2): the tower gets a real `boqItemId` instead of a rule-based side-table. See §3.0. |
| 0b | **The existing module deliberately credits *unverified* complete work.** `COMPLETE_STATUSES = ["Completed", "Under Verification", "Approved"]` all earn `activityStatusCredit = 1` — *"the tower is built whether or not a signature has landed, and hiding that would make the dashboard lag reality by days."* Verification gates only client-facing evidence, via `isEvidenceClientReady`. | **This contradicts §7/§23's "only verified progress enters EVM".** Resolved in §3.4a, which is a decision that needs to be taken explicitly rather than absorbed. |
| 1 | **The app runs on Firebase App Hosting, not Vercel.** `vercel.json`'s 6 crons are **inert** — App Hosting never reads that file. The real runner is `scripts/setup-cloud-scheduler.sh` → Google Cloud Scheduler (`module-hub-uc7tw`, `asia-south1`, `Asia/Kolkata`, `https://seltech.store`). The script's own header documents that this was the root cause of a stale greytHR mirror and five other silently-dead jobs. | Any new scheduled job must be registered in **that script**, not just `vercel.json`. Whether the script has actually been *run* cannot be verified from the repo. |
| 2 | **`CRON_SECRET` is set nowhere**, and every cron route guards with `if (!secret) return true`. **The cron endpoints are publicly callable today.** | New cron endpoints must not ship until the secret exists. Added to hardening. |
| 3 | **The workflow positional-ID defect barely touches PM.** The dangerous bespoke `normalizeIds()` (rewrites ids on load/delete/reorder/save) is duplicated in 7 pages — of which only **PM's JMC** workflow-configuration page is one. PM's Indent, RFQ, PO, MC, Inspections and Survey settings all use the **shared** `src/components/workflow/workflow-configuration-editor.tsx`, which mints stable `String(Date.now()+i)` ids and **does not renumber on reorder**. | **→ fixed in Part 0** (§0.4): all 7 copies deleted and those pages routed through the shared editor. No backfill needed on an empty database. |
| 4 | **There are two disjoint stock systems.** Legacy `inventoryLogs` — **`itemId` *is* the `projects/{id}/boqItems` document id** (verified at `project-stock-dashboard.ts:158`, `boqById.get(log.itemId)`), and `calculateProjectStockDashboard(boqItems, inventoryLogs)` already returns per-BOQ-item on-hand. Inventory v2 (`inventoryBalances`) is keyed `(organizationId, locationId, itemId)` with **no `projectId`**, and its only BOQ link (`legacyBoqItemId`) is written solely by the migration script and **read by nothing**. | **→ fixed in Part 0** (§0.6): Inventory v2 becomes the store of record and gains a real `boqItemId` plus project resolution, rather than building §14 on the legacy path because its key happens to line up. |
| 5 | **Notifications are far more established than the module report implied.** 10+ producers already call them (e-approval-service, hr-requirement-service, sas-budget-alerts, recurring payments, vehicle insurance, bank guarantee, and 6 cron routes). **Project Management is the outlier that produces none.** | Wiring PM up is following a well-trodden path, not pioneering one. |

### 1.2 Infrastructure to reuse

| Capability | Where | Notes |
|---|---|---|
| Notifications | `notifications.ts` → `dispatchNotification(recipients, payload): Promise<number>` (never throws); `notifications-server.ts` → `dispatchNotificationServer`, **`dispatchNotificationOnce(recipients, payload, dedupeKey)`** (deterministic id `${key}__${userId}` via `.create()`, so a cron re-run is a no-op) | One collection `userNotifications`, one document per recipient. `NotificationType` is an **open union** (`| (string & {})`) — a new type needs no migration. Push is automatic. |
| Bell / inbox | `src/components/app/Header.tsx` — the only reader, **no type allowlist**, `BELL_ALERT_LIMIT = 50` | A new producer appears in the bell without touching Header. There is **no** `/notifications` page. |
| Cron template | `src/app/api/workflow/check-escalations/route.ts` — `CRON_SECRET` bearer, lazy admin singleton, `dispatchNotificationOnce` | Register new jobs in `scripts/setup-cloud-scheduler.sh` |
| Generic approval engine | `e-approval-policy.ts` (pure, 4791 lines, zero imports) / `e-approval.ts` / `e-approval-service.ts`. Entry points `createEApprovalDraft`, `submitEApproval`, `performEApprovalAction` | See 1.3 |
| Audit stamps | ⚠️ **PM does not use `audit-fields.ts`** — zero hits for `withCreateAudit`/`withUpdateAudit`/`actorFromUser` across the whole module | PM writes the six fields **inline** with `serverTimestamp()` and stamps `actor.id`/`actor.name` (the helper uses `actor.userId`/`actor.userName` and writes nulls rather than omitting). **Match PM's inline convention**, not the helper — mixing them would put two field spellings in one module. |
| Activity log | `logUserActivity`, `diffFields(before, after)`, `useActivityLogger(module)`, `logServerActivity`+`SYSTEM_LOG_ACTOR`+`requestProvenance`. Collection `userLogs`, viewer `/settings/audit-logs` | Module name **must** come from `ACTIVITY_MODULES.PROJECT_MANAGEMENT` |
| Per-project permission scope | `can(action, resource, scope)` checks `${resource}.${scope}` first; `accessGrants.projectAccess[]`, `accessScopeGrants` | Exactly how `Expenses.Departments.<deptId>` works today |
| Server route guard | `access-control-server.ts` — `authenticateAccess`, `requireAccess`, `accessErrorResponse`; returns `context.projectIds` | |
| Excel | `report-excel.ts` — `exportRowsToExcel(title, rows, opts)`, `exportWorkbook(filename, sheets: ExcelSheet[])`; dynamic `import('exceljs')` | ~50 files still hand-roll exceljs. **Use the shared helper.** |
| Charts | `recharts@2.12.7` | Every chart in the app |
| Per-module gates | `tsconfig.project-management.json` + `npm run typecheck:project-management`; `npm run test:project-management` → `node --experimental-strip-types --test` | Why pure libs use explicit `.ts` relative imports |
| Pure-policy / service split | `e-approval-policy`+`-service`, `hr-policy`+`hr-requirement-service`, `access-control`+`-service`, `site-account-statement-date-policy` | The house pattern |

**No PDF generation library exists.** `pdf-lib` only *stamps* an existing PDF (e-approval
signatures). Document output in this app is **browser-print `/print` routes** with print CSS
in `globals.css:319`. PM already has three (`purchase-orders/[poId]/print`, two tower ones).

### 1.3 The e-approval engine — capability and its one real limit

`E_APPROVAL_ACTION_KINDS` already covers **every action §33 asks for**: Submit, Approve,
Approve And Complete, Send For Verification, Verify, Request/Provide Clarification,
**Return**, **Forward**, **Delegate**, Add Approver, **Escalate**, Reject, Hold, Resume,
Cancel, Resubmit, Take Ownership, Assign, Add Participant, Recall, Reverse.

- **Return-to-any-step** — `eApprovalReturnTargets(steps, step, { allowReturnToAnyStep })`.
- **`sequence` is a number and fractional inserts are legitimate** — "an inserted approver
  takes the midpoint between its neighbours so no existing step has to be renumbered." The
  positional-ID defect structurally cannot occur here.
- **Project routing** — `eApprovalProjectRouting`, `EApprovalProjectMode = 'Anyone'|'Head'|'Queue'|'Role'`
  with named `roleHolders` per project. One workflow serves every site.
- **A new approval kind is created in the Settings UI, not in code** — `eApprovalTypes` +
  `eApprovalTemplates` + `eApprovalRules` (matrix: type × dept × project × amount band).
- Also free: paused SLA clocks, parallel groups (`Single|All|Any|NofM`), material-change
  supersede with version snapshots, recall/reverse windows, append-only history.

> **The one real limit:** an `EApprovalRequest` is a **note-sheet shape** — `subject`, `body`,
> `amount`, `costCentre`, `budgetHead`, `externalRef`, `vendorId` — with **no typed domain
> payload field**. So a Baseline or Variation approval rides as `externalRef` + attachments +
> a deep link back to the Control record, *not* as structured baseline data. That is
> acceptable (the Control record remains the source of truth; e-approval owns only the
> decision trail) but it must be designed for deliberately.
>
> `EApprovalRequest.projectId` / `projectName` already exist, so project scoping is free.
>
> **Caveat:** no module has been migrated onto this engine yet — this layer would be the
> first consumer. The engine is heavily unit-tested, but the integration path is unproven.
> Also `/api/e-approval/escalations` is **in neither cron runner**, so its SLA ladder is not
> currently being swept.

### 1.4 Reusable pure calculators already in PM (do not reimplement)

| Function | File | Use here |
|---|---|---|
| `projectBoqValue(item)`, `projectManagementNumber` | `project-management-dashboard.ts` | Per-line budget → BAC |
| `isBoqSectionHeader(item)` | `project-management-boq-columns.ts` | Exclude headers from EVM |
| `reconcileBoqQuantities(...)` → `QuantityLedger` | `boq-quantity-control.ts` | The ladder — **extended**, not replaced |
| `computeAvailableQty`, `computeNetRequirement`, `requiresVariation`, `computeVariancePct` | `project-management-variations.ts` | Scope control |
| `aggregateMeasurementsByBoqKey` / `aggregateWorkOrdersByBoqItem` / `aggregateSubcontractorBillsByBoqItem` | `civil-execution.ts` | Civil EV + certified qty |
| `civilBoqKey`, `civilBoqKeyOfBoqItem`, `readLooseScope`, `readBoqSlNo` | `civil-execution.ts` | Tolerant BOQ dimension reads → WBS matching |
| `calculateTowerProgressSummary`, `computeTowerProgressPct` | `project-management-tower-progress.ts` | Erection EV |
| `calculateProjectControlTower(...)` → `.cost`, `.civil`, `.schedule`, `.stalledGates`, `.quantityIntegrity`, `.attention` | `project-management-dashboard.ts` | **Already has a `cost` block** (`budgetValue`, `committedValue`, `poCommittedValue`, `workOrderCommittedValue`, `varianceValue`, `committedPct`, `overBudget`). Reuse; and concatenate its `attention` list rather than building a second alert engine. |
| `computeFlowDownCheck`, `isCommitmentOverBoq`, `isPoOverdue` | `purchase-orders.ts` | Commercial exposure |
| `classifySurveyDeviation` | `project-management-survey.ts` | Scope movement → variations |
| `calculateProjectStockDashboard(boqItems, inventoryLogs)` → `ProjectStockRow[]` | `project-stock-dashboard.ts` | **BOQ-keyed stock on hand** for §14 |

### 1.5 Precedents to copy

- **Aggregate/snapshot:** no module keeps a dashboard snapshot doc. Three real precedents:
  `inventoryBalances` (transactional per-key aggregate, `runTransaction` on the Admin SDK,
  with `inventoryIdempotency`); `siteAccountBudgetAlertState` (threshold state,
  `sentThresholds` guarded in a transaction); and `refreshRequirementCounters`
  (recompute-and-store on the parent, called at 13 sites). The last one states the right
  philosophy explicitly: *"the stored counters exist so the register can filter and the
  dashboard can aggregate without reading every application; they are never trusted for a
  decision — closure, fill status and the SLA all recompute from here first."*
- **Server-side aggregation instead of snapshots:** SAS uses real Firestore aggregation —
  `getAggregateFromServer(base, { total: sum(field), rows: count() })` in `aggregateLedger` /
  `sumLedger` / `cumulativeThrough`. **Better than client-side full reads for Control-layer
  totals; adopt it.** It also ships a missing-index circuit breaker (`failed-precondition` →
  5-minute per-shape breaker → unindexed fallback that *expires rather than latches*).
- **`SAS_IN_CHUNK = 15`, not 30** — Firestore's `in` cap is 30, but per-document rule lookups
  cap at ~20 document-access calls per query evaluation. Load-bearing if per-project rules
  are written.
- **Period restriction:** `site-account-statement-date-policy.ts` — a rolling window
  (`resolveDateWindow`, `validateEntryDate`) in one org doc `siteAccountSettings/dateControl`,
  with a **separate bypass permission** `Site Account Statement.Backdated Entry` that *lifts*
  the window rather than widening it, and **double enforcement** (the input's `min`/`max`
  *and* the submit check, "because `min`/`max` on a date input is a hint a determined user can
  walk straight past"). Limits: it is a rolling window, **not a period lock** — no "close
  2026-08", no close record, no lock on edits to already-filed rows.
- **Immutability:** e-approval's append-only `eApprovalHistory` ("an approval whose trail can
  be rewritten is not an approval"), comment `editHistory` (append, never overwrite),
  attachments never overwritten (`supersedesAttachmentId`), soft delete except drafts, undo
  as a *recorded reversal*; `stockLedger` posted-and-reversed-never-edited.
- **Separation of duties:** `Tower Progress` splits `Verify Progress` from `Update Progress` —
  "the engineer who records a completion must not be able to sign it off."

### 1.6 Data-shape constraints

- **`BoqItem` is fully dynamic** — `types.ts:964`, `{ id: string; [key: string]: any }`, columns
  configured in `projectManagementSettings/boqColumns`. Loose multi-alias readers already
  exist for QTY/rate/unit/description.
  → **WBS/Control Accounts must be *rules over existing BOQ dimensions*** (Scope 1/2,
  Category 1–3) plus explicit include/exclude — never a hand-maintained per-line table. The
  dynamic model **stays** (per-project BOQ shapes are deliberate); **→ Part 0** (§0.5) only
  reserves the handful of keys code depends on.
- **Three different BOQ join strategies coexist:** doc id (`boqItemId`) for PO/WO/bill items;
  composite `(scope1, scope2, boqSlNo)` for JMC/MVAC measurement items; and `itemId` for
  legacy `inventoryLogs`.
  → **fixed in Part 0** (§0.1, §0.6): measurement items and inventory items both get a real
  `boqItemId`, collapsing three join strategies to one. This is the single most valuable
  correction the empty-database window buys — the composite key is a lowercased,
  whitespace-stripped string match standing between subcontractor payments and the quantities
  that justify them.
- **`boqVariations` exists but is quantity-only** — one BOQ item, `requestedQty`,
  `variancePct`, inline Pending/Approved/Rejected; on approval it `increment`s
  `variationApprovedQty`, feeding `computeAvailableQty` and the ladder.
  → **fixed in Part 0** (§0.3): one `projectVariations` model carries both arms, and
  `variationApprovedQty` becomes a derivation rather than a running total.
- **Client billing genuinely does not exist.** Verified: `billing-recon/[project]/billing/*`
  and `subcontractors-management/[project]/billing/*` both bill **subcontractors** against
  work orders (they import `WorkOrder`/`Subcontractor`/`WorkOrderItemSelectorDialog`).
  `projects/{id}/bills` is the subcontractor register. Nothing bills the client.
- **SAS is not directly joinable to PM.** `SASExpense.projectId` points at a
  **`siteAccountProjects`** doc, not the global project — the bridge is
  `siteAccountProjects.centralProjectId → projects/{id}`, while
  `projectManagementProjects.globalProjectId → projects/{id}`. Worse,
  `SASExpense.expenseCategory` is a **name string, not an id**, so a category rename orphans
  history.
  → **fixed in Part 0** (§0.7): `globalProjectId`, `categoryId` and `costCodeId` added to
  `SASExpense`. Not needed while cost entry is manual, but free now and a migration later.
- **There is no cost-code master anywhere in the repo.** `costCentre` / `budgetHead` exist as
  free-text with no master and no validation on e-approval, recurring-payments, tour-travel
  and hr-requirement. The Control layer's cost-code master is the **first** one — and
  retrofitting those four modules onto it is **explicitly out of scope** (§0.7).
- **Zero PM collections are indexed** (119 indexes / 57 collection groups, none PM) — a
  consequence of PM's 151 unfiltered reads vs 11 filtered queries. `firestore.indexes.json`
  *is* deployed; **`firestore.rules` is not wired into `firebase.json` at all.**
- **PM registers are project-scoped subcollections** (`projects/{globalProjectId}/purchaseOrders`, …),
  so any cross-project sweep needs `collectionGroup()` + `COLLECTION_GROUP` indexes.
- **`manufacturingProgressPct` has no data source.** §8 allocates 25% to "Manufacturing" —
  the gap between MC Cleared and Inspection Requested, which no register records.
- **The Lapanga workbook is not in the repo** (no xlsx/csv anywhere, no "lapanga" match). The
  requirements as stated are the specification of record.

---

## Part 2 — Layer model and the source-of-truth contract

```
LAYER 1  Project Master / BOQ                ← existing, unchanged
LAYER 2  Execution: Supply + Civil + Tower   ← existing, unchanged
──────────────────────────────────────────────  everything below is new
LAYER 3  Project Control       Contract · WBS · Baseline · Progress Recognition · EVM
LAYER 4  Commercial & Finance  Cost · Forecast · Client Billing · Collection · Cash · P&L · ROI
LAYER 5  Exposure              Variations · EOT · LD · Claims · Delay Cost · Risk
LAYER 6  Intelligence          Exceptions · Reviews · Actions · Month Close · Snapshots · Portfolio
```

| Information | Owner | Control layer may |
|---|---|---|
| BOQ, Survey, Indent, RFQ, PO, Drawing, MC, Inspection, MDCC, DI, GRN, MVAC | existing PM registers | **read only** |
| Tower progress + verification | Tower module | **read only**, `Approved` states only |
| Civil WO / JMC certified / subcontractor bills | Billing Recon / Subcontractors | **read only** (via `civil-execution.ts`) |
| Stock on hand, free issue | Store & Stock | **read only** |
| Contract terms, baselines, WBS, earning rules | Control layer | own |
| Actual cost, forecasts, client bills, collections | Control layer | own |
| Variations (commercial), EOT, claims, LD, risks, milestones | Control layer | own |
| EVM, P&L, cash flow, ROI | Control layer | **compute only — never an input** |

Two hard rules that follow:

1. **Progress is never typed in.** No screen accepts "project progress = 41.35%".
2. **Progress is earned, not claimed.** Civil uses *certified* JMC quantity, never executed.
   Supply earns per gate record, each verified by its own existing gate predicate. Tower earns
   on the existing credit rule, with a **separate verified figure and a reconciling
   exception** — see §3.4a, which resolves a real conflict between §7's wording and the Tower
   module's deliberate design.

---

## Part 3 — New pure domain libraries

House pattern for all of them: pure (no Firebase, no React), module-header comment explaining
*why*, `X_COLLECTION` / `X_PERMISSION_RESOURCE` consts, `const X_STATUSES = [...] as const` +
derived type, `xStatusStyles: Record<..., string>`, validators returning `{field, message}[]`,
injected `today: Date`, explicit `.ts` relative imports. Tests in
`tests/project-control-domain.test.mjs`.

### 3.0 The tower ↔ BOQ link

§23 asks for `Tower Progress → BOQ Progress → WBS Progress → Project Progress`. The first arrow
did not exist — a tower carried no BOQ reference of any kind (§1.1 #0a).

**Resolved by §0.2:** the tower record now carries `boqItemId` directly, plus
`boqBasis: 'per-tower' | 'per-span'`. Set on tower creation and in the import wizard.

- One BOQ line covers many towers, so the reference lives on the tower and the roll-up
  aggregates upward. No matching rules, no side-table, no `filterTowers()` second job.
- `per-span` denominates against spans rather than towers, matching what
  `calculateTowerProgressSummary` already does for `stringing`/`opgw` — including its clamp for
  the last tower on the line, which carries no span of its own.
- A tower with no `boqItemId` earns nothing and is reported as an **unlinked-tower exception**,
  never silently dropped from the denominator.
- A BOQ line with no towers pointing at it falls back to its supply or civil lane.

### 3.1 `project-control-wbs.ts` — Control Accounts (§4)

BOQ stays atomic; WBS is a **reporting grouping defined by rules**.

```ts
ControlAccount { id, code, name, parentId?, order,
                 matchRules: BoqMatchRule[],           // scope1/scope2/category1..3, tolerant match
                 explicitIncludeBoqItemIds: string[],
                 explicitExcludeBoqItemIds: string[] }
```

`assignBoqItemsToControlAccounts(boqItems, accounts)` → `{ byAccount, unassigned, conflicts }`.
Invariant: every non-header BOQ line lands in **exactly one** account; `unassigned` and
`conflicts` surface as exceptions, never silently absorbed. Uses `readLooseScope` and
`isBoqSectionHeader`.

### 3.2 `project-control-contract.ts` — Contract & versioning (§5)

All §5 fields. **Versioned, never overwritten:**
`ContractVersion { version, label, effectiveFrom, terms, sourceType: 'Original'|'Amendment'|'Variation'|'EOT', approvedVia }`.
`resolveContractTermsAsOf(versions, date)` — a bill raised in June uses June's terms even
after an August amendment.

### 3.3 `project-control-baseline.ts` — Baselines (§6)

`BaselineType = 'Tender'|'B0'|'B1'|'B2'|…`, `status: Draft|Approved|Superseded`.

```ts
BaselineLine { controlAccountId, boqItemId?, budgetValue,
               plannedStartDate, plannedEndDate,
               curveShape: 'linear'|'sCurve'|'manual',
               manualCurve?: Record<PeriodKey, number> }   // cumulative %
```

- `computePlannedPct(line, asOfDate, shape)` — linear default, S-curve via cumulative-beta,
  manual per-period override. **This is what makes PV computable without asking anyone to
  draw a curve.**
- `canDeleteBaseline(...)` → **always false for the first Approved baseline.**
- `summariseScheduleExposure(...)` → §6's table incl. **net exposure**.

### 3.4 `project-control-progress.ts` — Progress recognition (§7, §8, §23)

The heart of the layer. Three lanes, one output: verified earned % per BOQ line.

**Supply — configurable earning rule (§8):**
```ts
SupplyEarningStage = 'po'|'drawing'|'mc'|'manufacturing'|'inspection'|'mdcc'|'di'|'grn'|'mvac'
SupplyEarningRule { stages: Array<{ stage: SupplyEarningStage, weightPct: number }> }  // must total 100
```
Resolution cascade **project → scope → BOQ category** from `projectControlSettings`, falling
back to §8's default table — so transformers and consumables differ.
`computeSupplyEarnedPct(gateStates, rule)`: each stage earns its full weight once its gate
record reaches its earning status. Reuses the status enums from `supply-gates.ts`.

> **`manufacturing` has no source.** Design: an optional `manufacturingProgressPct` field
> added to the **existing** MC record, earning `weight × pct/100`, **defaulting to 0** so the
> rule degrades gracefully and never yields `NaN`. Additive; no existing MC behaviour changes.

**Civil:** `computeCivilEarnedPct(certifiedQty, boqQty + approvedVariationQty)` from
`aggregateMeasurementsByBoqItem(...).certifiedQty` — the new **`boqItemId`-keyed** aggregate
from §0.1, falling back to the composite-key version for any row without one. Certified, never
executed.

**Erection/Tower:** `computeTowerEarnedPctForBoqLine(towers, weights)` reusing
`computeTowerProgressPct` and `activityStatusCredit` unchanged, over the towers whose
`boqItemId` points at the line (§0.2). Chain `tower → BOQ line → control account → project`,
weighted by `projectBoqValue`.

`rollUpEarnedValue(lines, accounts)` → EV by line, account and project in one pass.

### 3.4a ⚠️ Design decision: what counts as "verified" for EVM

§7 and §23 both say *only verified progress should enter EVM*. The existing Tower module
deliberately does the opposite: `Completed`, `Under Verification` and `Approved` all earn full
credit, because *"the tower is built whether or not a signature has landed, and hiding that
would make the dashboard lag reality by days."* Verification currently gates only
client-facing evidence (`isEvidenceClientReady`).

Taking §7 literally would mean **EV drops every time a verification queue builds up**, and a
CPI/SPI that moves because a checker went on leave is worse than no CPI at all. Taking the
existing rule literally means EV can include a claim later rejected.

**Recommendation — compute both, reconcile the gap:**

| Figure | Basis | Used for |
|---|---|---|
| `earnedPct` | existing `activityStatusCredit` (incl. Under Verification) | the live EVM figure — matches the execution dashboards, no lag |
| `verifiedEarnedPct` | `Approved` only | the client-facing and month-close figure |
| `unverifiedEvValue` | the difference × budget | **a new exception**: "EV awaiting verification" |

Month close (§3.18) locks on `verifiedEarnedPct`, so a period is never closed on unverified
claims; the open period reports on `earnedPct`, so the dashboard never lags reality. The gap
between them becomes a *managed* number instead of a hidden one — and a persistent gap is
itself the useful signal (verification is the bottleneck).

Civil is unaffected: it already uses *certified* JMC quantity, which is verified by definition.
See Open Question 4.

### 3.5 `project-control-evm.ts` — EVM engine (§9, §10)

```ts
computeEvm({ lines: Array<{ budget, plannedPct, earnedPct, actualCost }>, asOfDate })
  → { BAC, PV, EV, AC, SV, CV, SPI, CPI,
      etcBottomUp, eacBottomUp, eacStatistical, vac, tcpi,
      forecastCompletionDate, forecastCredibilityGapPct }
```

**Two forecasts, deliberately (§10):** `eacBottomUp = AC + Σ owner ETC` versus
`eacStatistical = BAC / CPI`; `forecastCredibilityGapPct` raises a **Forecast Credibility**
exception past a configurable threshold (default 5%).

**Division guards:** `SPI`/`CPI`/`TCPI`/`eacStatistical` return **`undefined` — not `0`, not
`Infinity`** — when `PV`/`AC`/`BAC−EV` is zero. A project that hasn't started must never
render "SPI 0.00 🔴".

### 3.6 `project-control-cost.ts` — Cost & cost codes (§11–13)

Per decision, actuals are **manual entry + Excel import**.

```ts
CostCode { code, name, group: 'Material'|'Labour'|'Subcontract'|'Equipment'|'Site'|'Logistics'|'Finance'|'Overhead'|'Other', active }
ActualCostLine { id, globalProjectId, periodKey /* YYYY-MM */, costCodeId,
                 controlAccountId?, boqItemId?, amount, narration,
                 source: 'manual'|'import'|'derived', sourceModule?, sourceRef?,
                 enteredBy, approvedVia? }
```

> **One flagged assumption.** The `source` / `sourceModule` / `sourceRef` fields are designed
> in now even though nothing writes `'derived'` yet. This is deliberate: auto-derivation from
> PO/GRN, subcontractor bills, SAS, vehicle and travel can later be added as an *additional
> writer* with **no reshaping of stored data and no migration**. Manual and derived lines
> coexist; a derived line is read-only in the UI. Noted because manual entry does re-key data
> SEL LIVE already holds — and because the SAS join is non-trivial anyway (§1.6: the
> `centralProjectId` bridge plus category-by-name).

- `rollUpActualCost(lines, by)` → cost code / group / control account / period.
- `computeCommitmentLadder({ budget, committed, actual, etc })` → §13. `committed` comes from
  the **existing** `calculateProjectControlTower().cost`, not recomputed.
- Import reuses the BOQ-import wizard pattern (header aliasing, per-row validation,
  reject-row-rather-than-drop-field) and the shared `exportWorkbook` for the template.

### 3.7 `project-control-forecast.ts` — Forecast versions (§37)

One document per period per project, **never overwritten**.
`buildForecastTrend(versions)` → §37's deterioration series, so management sees margin
sliding before it is a loss.

### 3.8 `project-control-pl.ts` — P&L and margin bridge (§18, §19)

- `buildProjectPl({ revenue: {contract, approvedVariation, expectedVariation}, cost: {…9 heads} })`
  → forecast revenue / cost / profit / margin %, compared across
  **Tender / Baseline / Previous Forecast / Current Forecast**.
- `buildMarginBridge(previous, current, drivers)` → §19's waterfall. Drivers auto-derived
  where the data exists (variation recovery, LD exposure, quantity increase from the ladder,
  delay cost, escalation) plus a **computed balancing line**.
  **Invariant: the bridge always sums exactly to the profit delta.** A bridge that doesn't
  tie is worse than no bridge, so the balancing line is computed, never entered.

### 3.9 `project-control-cashflow.ts` — Cash flow & peak funding (§20, §21)

Inflows from client bills, collections, advance and retention-release schedules; outflows from
PO payment schedules, subcontractor bills and the manual cost forecast.
`buildCashFlowForecast({ periods, inflows, outflows, openingBalance, scenario })` for
`Actual | Committed | Expected | Best | Worst` (scenarios = configurable collection-delay and
cost-escalation factors). `computePeakFunding(forecast)` → `{ peakAmount, peakPeriodKey }`;
`fundingGap = peak − available` → 🔴 **Project Funding Gap**.

### 3.10 `project-control-roi.ts` — ROI / ROCE (§22)

`computeCapitalEmployed({ peakWorkingCapital, retentionHeld, bgMargin, securityDeposits, otherBlocked })`
then `computeRoi({ forecastProfit, capitalEmployed, durationMonths })` → ROI, annualised ROCE,
return on cost, margin on sales.

### 3.11 `project-client-billing.ts` + `project-client-billing-gst.ts` (§15–17)

Extends the chain past MVAC:
```
MVAC Signed → Billing Eligible → RA Bill Draft → Internal Verified → Client Submitted
  → Client Certified (part|full) → Tax Invoice → Payment Due → Part Collected → Collected
```
All §16 fields. Deductions computed, not typed:
`computeBillDeductions(gross, contractTermsAsOf, advanceOutstanding, retentionHeldToDate)` —
reusing the client master terms that **already exist** under `Project Management.Clients`
(`retentionPct`, `paymentTermsDays`, `defaultTdsPct`, `ldRatePct`, `ldCapPct`,
`performanceSecurityPct`, `inspectionRegime`).

**Three values kept strictly separate (§17):** `earnedRevenue` (= EV from 3.4) · `billed` ·
`collected`, with `unbilledRevenue = EV − billed`, `receivable = invoiced − collected`, and
ageing buckets.

**GST / e-invoice (included per decision):**
- `computeGstBreakup(items, supplierStateCode, clientStateCode)` → intra-state CGST+SGST vs
  inter-state IGST.
- `buildEInvoicePayload(bill, seller, buyer)` → IRP Schema 1.1 JSON. **Pure and unit-testable.**
- **Prerequisites, flagged:** (a) `HSN/SAC` must become a BOQ column — additive and optional
  in the `projectManagementSettings/boqColumns` defaults so existing BOQs keep loading;
  (b) client master needs `stateCode` / `placeOfSupply`; (c) GSP credentials as App Hosting
  secrets.
- The GSP/IRN call is an **external boundary**:
  `src/app/api/project-management/e-invoice/route.ts`, server-only, guarded with
  `requireAccess`. Never from the browser. Without credentials the bill still works
  end-to-end; only IRN generation is blocked, and the screen says so.
- GSTR-1 extract = an `exportWorkbook` projection over certified bills.
- **Bill/invoice PDF is a `/print` route**, not a generated PDF — there is no PDF generation
  library, and browser print is this app's established mechanism.

### 3.12 `project-commercial-variations.ts` — Change orders (§27)

`Potential → Identified → Notified → Qty Evaluated → Cost Evaluated → Time Assessed →
Internal Approved → Submitted → Under Negotiation → Approved | Rejected | Withdrawn`.

**One record, both arms (§0.3).** `projectVariations` replaces `boqVariations` outright rather
than wrapping it, since there is no data to preserve:

- *quantity arm* — affected BOQ lines and their `requestedQty` / `variancePct`, which is all the
  old `boqVariations` held;
- *commercial arm* — **rate impact**, cost impact, revenue impact, `timeImpactDays`, cause, and
  links to drawing / RFI / JMC / client letter / site instruction / EOT / bill.

`variationApprovedQty` on the BOQ item is **recomputed from approved variations** rather than
`increment`-ed in place. The quantity ladder and `computeAvailableQty` are untouched — they only
ever read that one number, and it now has a derivation instead of a running total that could
drift from the records behind it.

Approval routes through e-approval (§7.1), which replaces the old inline
Pending/Approved/Rejected — a change order that alters contract value should not be decided by a
dropdown.

`buildVariationFunnel(...)` → §39's funnel.

### 3.13 `project-commercial-eot.ts` + `project-commercial-delay-cost.ts` (§25, §26)

**Delay is not LD.**
`apportionDelay({ grossDelayDays, attributions: [{cause:'Client'|'ForceMajeure'|'SEL'|'Other', days}] })`
→ EOT-eligible vs SEL-attributable, then `netLdExposureDays = grossDelay − eotApproved`, with
EOT *pending* shown separately and **never netted off silently**.
`computeLdExposure({ contractValue, ldRatePctPerWeek, ldCapPct, netDelayDays })` — **capped**.
`computeDelayCost({ siteOverheadPerMonth, salariesPerMonth, equipmentPerMonth,
interestPerMonth, bgExtensionCost, insuranceExtensionCost, otherPerMonth })` → per
month/week/day + potential LD. This makes a recovery-plan decision arguable with numbers.

### 3.14 `project-commercial-claims.ts` (§28)

Separate from variations. §28's 11 categories, own lifecycle, expected-recovery value, links
to variations/EOT/correspondence.

### 3.15 `project-control-risk.ts` (§29, §30)

5×5 P/I, `score = P × I`, `financialExposure`, owner, mitigation, trigger, due date, and
**residual** P/I/score. `computeEmv(probability, exposure)` with a configurable 1–5 →
probability-band map. `buildRiskHeatmap(risks)` → §39's heatmap.

### 3.16 `project-control-milestones.ts` (§24)

§24's 10 commercial milestones: original / current-baseline / forecast / actual date,
slippage, `critical`, responsible person, reason, recovery action. Deliberately separate from
execution gates — a contractual milestone is not a BOQ stage.

### 3.17 `project-control-exceptions.ts` (§34) — extend, do not replace

**The single most important anti-duplication decision.** This module emits the **same
`ProjectAttentionItem` shape** `calculateProjectControlTower()` already produces; the Control
Centre **concatenates** the two lists through one sort. New `ProjectAttentionTarget` values
are added to the existing union in `project-management-dashboard.ts`.

All 17 rules from §34, thresholds configurable in `projectControlSettings` (SPI < 0.95,
CPI < 0.97, EAC > BAC, margin drop > X%, milestone slip, payment overdue, forecast cash < 0,
variation ageing, EOT deadline, high risk, billing < earned revenue, commitment > budget, PO
stalled, inspection stalled, GRN discrepancy, progress without evidence, forecast credibility).

### 3.18 `project-control-period.ts` — Month close & period lock (§36)

`PeriodStatus = 'Open'|'Progress Locked'|'Cost Locked'|'Under Review'|'Closed'`. §36's 20
ordered steps as a checklist, each `required` or advisory; `canClosePeriod(checklist)` returns
the blocking steps.

**Extends the SAS date-policy precedent** rather than inventing one: same one-doc settings
shape, same **separate bypass permission** idea (`Period Close.Reopen` lifts the lock the way
`Backdated Entry` lifts the date window), and the same **double enforcement** — the form's
`min`/`max` *and* the submit check. What SAS lacks and this adds: a real named period, a close
record, and a lock on *edits* to already-filed rows.

On close, write an **immutable** `projectControlSnapshots/{globalProjectId}_{periodKey}` with
the full computed set. Closed periods are **never recomputed** — dashboards read the snapshot.
Reopening requires a **Period Reopening** e-approval and the original snapshot survives.

### 3.19 Ladder extension (§31)

Edit `boq-quantity-control.ts` **additively**: append `clientCertifiedQty` and
`clientBilledQty` to `QuantityRungKey`, `RUNG_LABELS`, `SUPPLY_LADDER`, `CIVIL_LADDER`.
`billed` finally gets a value, so the monotonic rule fires on
`JMC certified 100 → client billed 110` 🔴. No behaviour changes when the fields are absent —
undefined still means "not recorded", not zero, and every existing ladder test must still pass.

### 3.20 Requirement Planner enhancement (§14)

Extend `project-management-requirement-planner.ts` additively:
```
Net Procurement Requirement =
  Required − Available Project Stock − Free Issue − In Transit − Indented − Ordered
```

- **In Transit needs no Store integration at all** — it is already computable inside PM as
  `Σ dispatchInstructions.dispatchQty − Σ grns.receivedQty`.
- **Available Project Stock / Free Issue** — against **Inventory v2** (§0.6), the store of
  record: resolve `inventoryLocations where projectId == globalProjectId && type == 'Project Store'`
  → sum `availableQuantity` from `inventoryBalances` for those `locationId`s → join to the BOQ
  line via `inventoryItems.boqItemId` (added in §0.6) or the BOQ's own `inventoryItemId` (§0.5).
- `availableStock(onHand, reserved)` already exists in `inventory.ts` — reuse it rather than
  subtracting reservations by hand.
- **An unlinked item shows stock as "unknown", never zero.** Zero would recommend
  over-procurement, which is the exact failure the planner exists to prevent.
- Indent / RFQ / PO mechanics unchanged.

---

## Part 4 — New Firestore collections

All reference `globalProjectId`; line-level ones also `boqItemId` and/or `controlAccountId`.
Every one ships with its composite indexes **and** its rules (Part 8).

| Collection | Grain | Notes |
|---|---|---|
| `projectControlSettings` | 1/project | earning rules, thresholds, scenario factors, EMV bands |
| `projectContractVersions` | n/project | append-only |
| `projectControlAccounts` | n/project | WBS rules |
| `projectBaselines` / `projectBaselineVersions` | n/project | first Approved undeletable |
| `projectProgressSnapshots` | 1/project/period | verified earned % by line + account |
| `projectCostCodes` | global | the repo's first cost-code master |
| `projectActualCosts` | n/project/period | `source` field for future derivation |
| `projectCostForecasts` / `projectForecastVersions` | 1/project/period | never overwritten |
| `projectEvmSnapshots` | 1/project/period | |
| `projectClientBills` / `projectClientBillItems` / `projectCollections` | n/project | |
| `projectPlSnapshots` / `projectCashFlowForecasts` / `projectRoiSnapshots` | 1/project/period | |
| `projectCommercialMilestones` | n/project | |
| `projectVariations` | n/project | **replaces `boqVariations`** (§0.3) — quantity + commercial arms in one record |
| `projectClaims` / `projectEotClaims` / `projectLdAssessments` | n/project | |
| `projectRisks` / `projectRiskActions` | n/project | |
| `projectReviews` / `projectReviewActions` / `projectExceptions` | n/project | |
| `projectMonthClosures` | 1/project/period | |
| `projectControlSnapshots` | 1/project/period | **immutable** on close |
| `projectDashboardSnapshots` | 1/project | cron-maintained; the only thing Portfolio reads |

Approvals are **not** new collections — they live in `eApprovalRequests` / `eApprovalSteps`
with the Control record's id in `externalRef` plus `projectId` (see §1.3).

Top-level vs nested: cross-project queues (`projectVariations`, `projectClaims`,
`projectEotClaims`, `projectExceptions`) go **top-level** with a `globalProjectId` field,
matching how `boqVariations` and `poIssueApprovals` already work. Everything else nests under
`projects/{globalProjectId}/…` like the rest of PM.

### Fields added to existing records (Part 0)

| Record | Added | For |
|---|---|---|
| `jmcEntries` / `mvacEntries` items | `boqItemId` | §0.1 — retires the composite-key join |
| `towers` | `boqItemId`, `boqBasis` | §0.2 — the tower→BOQ arrow |
| `boqItems` | reserved `scope1`, `scope2`, `boqSlNo`, `hsnSac`, `inventoryItemId`, `qty`, `unit`, `unitRate`, `budgetPrice`, `totalAmount` | §0.5 |
| `manufacturingClearances` | `manufacturingProgressPct` | §3.4's earning rule |
| `inventoryItems` | `boqItemId` (replacing write-only `legacyBoqItemId`) | §0.6 |
| `siteAccountExpenses` | `globalProjectId`, `categoryId`, `costCodeId` | §0.7 |
| clients master | `stateCode`, `placeOfSupply` | §3.11 e-invoice |

`boqVariations` is **removed**; `variationApprovedQty` stays on the BOQ item but becomes a
derived value (§0.3).

---

## Part 5 — New routes

All keep `?project={mappingId}`. The existing 86 pages are untouched; the PM hub page gains
two groups ("Project Control", "Commercial") in its `linkGroups` array.

```
/project-management/control-center                    executive view (§38, §39)

/project-management/control/setup                     (§5)
/project-management/control/wbs                       (§4)
/project-management/control/baselines                 (§6)
/project-management/control/progress                  (§7, §8, §23)
/project-management/control/evm                       (§9, §10)
/project-management/control/cost                      (§11–13)
/project-management/control/forecast                  (§10, §37)
/project-management/control/pl                        (§18, §19)
/project-management/control/cash-flow                 (§20, §21)
/project-management/control/roi                       (§22)
/project-management/control/milestones                (§24)
/project-management/control/risks                     (§29, §30)
/project-management/control/reviews                   (§32)
/project-management/control/actions                   (§32)
/project-management/control/exceptions                (§34)
/project-management/control/month-close               (§36)
/project-management/control/snapshots                 (§36, §37)

/project-management/commercial/client-billing         (§15–17)
/project-management/commercial/client-billing/[billId]/print   ← bill/invoice output
/project-management/commercial/collections            (§17)
/project-management/commercial/variations             (§27)
/project-management/commercial/claims                 (§28)
/project-management/commercial/eot                    (§25)
/project-management/commercial/ld                     (§25, §26)

/project-management/portfolio                         (§40) — snapshot-only, cross-project
```

Server routes:
```
/api/project-management/control/snapshot   nightly — snapshots + exception notifications
/api/project-management/e-invoice          GSP/IRN boundary, credentials server-side
```

**BOQ 360° extension (§30):** the existing `/project-management/boq/item/[boqItemId]` page
gains sections below the current timeline — Budget/Commitment/Actual/Forecast ·
Physical %/PV/EV/CPI/SPI · Variations/Claims/Risks/Documents/Actions. One page; this is the
"BOQ digital thread".

---

## Part 6 — Permissions

Added to the `"Project Management"` block in `src/lib/permissions.ts` (currently 25
sub-resources at `:714-793`). Financial resources are deliberately **separate** so a site
engineer can hold `Tower Progress` without ever seeing margin:

```
Control Setup         View, Edit
WBS                   View, Edit
Baselines             View, Create, Approve, Delete
Progress Recognition  View, Edit Rules
EVM                   View, Export
Cost                  View, Add, Edit, Delete, Import, Export
Cost Codes            View, Add, Edit, Delete
Forecast              View, Submit, Approve
P&L                   View, Export
Cash Flow             View, Edit, Export
ROI                   View
Client Billing        View, Add, Edit, Verify, Submit, Certify, Invoice, Delete, Export
E-Invoice             Generate, Cancel
Collections           View, Record, Export
Commercial Variations View, Add, Edit, Notify, Submit, Approve, Reject
Claims                View, Add, Edit, Submit, Approve
EOT                   View, Add, Submit, Approve
LD                    View, Assess, Waive
Milestones            View, Edit
Risks                 View, Add, Edit, Accept, Close
Reviews               View, Conduct, Close
Actions               View, Add, Close
Exceptions            View
Period Close          View, Lock, Close, Reopen
Snapshots             View, Export
Portfolio             View
```

Per-project restriction uses the **existing** scope form — `can("View", "Project Management.P&L", globalProjectId)`
resolves `Project Management.P&L.<projectId>`, exactly how `Expenses.Departments.<deptId>`
works. No new mechanism.

Following the `Tower Progress` separation-of-duties precedent: `Baselines.Approve`,
`Forecast.Approve` and `Period Close.Close` are separate from their `Create`/`Submit`/`Lock`
counterparts, so the person who prepares a number cannot also sign it off.

---

## Part 7 — Approvals, notifications, snapshots

### 7.1 Approvals via e-approval (§33)

Seed `eApprovalTypes` + `eApprovalTemplates` + `eApprovalRules` rows — **configuration, not
code**: Baseline Approval, Forecast Approval, CTC Approval, Variation Approval, Claim
Approval, EOT Approval, Billing Approval, Write-Off, Risk Acceptance, Recovery Plan Approval,
Period Reopening, Contract Amendment.

Integration is one thin service, `project-control-approvals.ts`, wrapping
`createEApprovalDraft` / `submitEApproval` / `performEApprovalAction`, putting the Control
record id in `externalRef` and `projectId` on the request, and storing the returned
`eApprovalRequestId` back on the Control record. Existing per-register PM workflows are **not
migrated**.

Because this is e-approval's first external consumer, the first integration (Baseline
Approval) should be treated as a spike that validates the seam before the other eleven follow.

### 7.2 Notifications (§35)

Four pieces of work:

1. **Register PM's registers in the existing hourly sweep.**
   `api/workflow/check-escalations/route.ts` already does TAT escalation generically off a
   `MODULES` array; PM appears nowhere. PM needs a variant because its registers are
   **project-scoped subcollections** (`collectionGroup()` + `COLLECTION_GROUP` indexes) and
   some use `currentStepIndex` rather than `currentStepId`.
2. **Make the dead config live.** JMC workflow settings already write `step.notifyUserIds`
   ("Notify on Step Entry") and **nothing reads it** — an admin configures notifications, sees
   them save, and nobody is notified. Wire it to `dispatchNotification` on step entry.
3. **Control-layer alerts** from the nightly cron via
   `dispatchNotificationOnce(recipients, payload, dedupeKey)` with
   `dedupeKey = ${projectId}:${ruleId}:${periodKey}`, so a nightly sweep never re-alerts a
   cleared item.
4. **Register `/api/e-approval/escalations` in the scheduler** — it is in neither runner
   today, so the SLA ladder the Control approvals rely on is not being swept.

`NotificationType` is an open union, so new types need no migration. In-app + push come free;
e-mail via `src/lib/mail.ts`.

### 7.3 Read strategy (§45D)

| View | Reads |
|---|---|
| Closed period (any historical dashboard) | `projectControlSnapshots` — never recomputed |
| Open period, single project | computed live at **control-account** grain, using Firestore **server-side aggregation** (`getAggregateFromServer` with `sum()`/`count()`, as SAS's `aggregateLedger` does) rather than pulling every row into the browser |
| Portfolio (§40) | `projectDashboardSnapshots` **only** — one document per project, never a fan-out |

Nightly cron `/api/project-management/control/snapshot` follows the
`check-escalations` template: `CRON_SECRET` bearer, lazy admin singleton,
`logServerActivity({ source: 'cron' })`, `dispatchNotificationOnce`. **Registered in
`scripts/setup-cloud-scheduler.sh`** (not only `vercel.json` — see §1.1).

Adopt `refreshRequirementCounters`' stated philosophy for `projectDashboardSnapshots`: the
snapshot exists so the portfolio can aggregate cheaply; it is **never trusted for a decision**
— opening a project recomputes from source. Also adopt SAS's missing-index circuit breaker
for any new aggregation query.

---

## Part 8 — Hardening, folded into the features that force it

Per decision, hardening runs **alongside** the new work. Each item is tied to the first
feature that cannot ship safely without it.

| Item | Forced by | What is done |
|---|---|---|
| **A. Firestore rules** | `/control/setup` — the moment contract value is stored | Add the missing `firestore` → `rules` key to `firebase.json` (**absent today, so the existing 441-line rules file has never been deployed**), then write rules for the new collections *and* the 27 existing PM ones, mirroring the permission tree via the existing `holdsPermission()` helper, plus a default-deny. Keep per-project `in` chunks at **15**, not 30 (§1.5). |
| **B. Cron authentication** | `/api/project-management/control/snapshot` | `CRON_SECRET` is set nowhere and every route guards `if (!secret) return true` — **the endpoints are open today**. Run `scripts/setup-cloud-scheduler.sh` (which creates the Secret Manager secret and all jobs), add `CRON_SECRET` to `apphosting.yaml` as a secret, and register the two new jobs. |
| **C. Notifications** | `/control/exceptions` and every approval | Part 7.2 |
| **D. Dashboard scalability** | `/portfolio` and `/control-center` | Part 7.3, plus the first PM entries in `firestore.indexes.json` (incl. `COLLECTION_GROUP` scope for the sweep) |
| **E. Workflow step IDs** | **→ moved into Part 0** (§0.4) | On an empty database this stops being a migration and becomes a deletion: remove all 7 bespoke `normalizeIds()` copies and route those pages through the shared `workflow-configuration-editor.tsx`. No backfill. |

> **One caveat, stated once.** Until (A) and (B) land, every new collection holding contract
> value, profit, margin, cash flow and claims is readable and writable by any signed-in user
> straight from the browser console — exactly as the 27 existing PM collections are — and the
> cron endpoints that write snapshots are callable by anyone. A and B are therefore listed in
> Part 0 (§0.8) as well: on a pre-launch database there is no reason to defer them, and doing
> them first means no sensitive collection is ever exposed even briefly.

---

## Part 9 — Build order (for when implementation starts)

Design is complete up front; this is the order the pieces *can* be built, each depending on
the one before.

0. **Scaffolding** — `tsconfig.project-control.json`, `npm run typecheck:project-control`,
   `tests/project-control-domain.test.mjs`, `npm run test:project-control`,
   `project-control-provider.tsx`. Small, but §10.1 means skipping it costs you the build
   gates for everything after.
0.5 **Pre-launch corrections (Part 0)** — do these **before** anything below, and before any
   real data is entered. §0.8 (rules, indexes, cron secret) first, then the schema items.
   §0.1 is the one that crosses into Billing Recon and Subcontractors Management, so it wants
   its own review.
1. **Foundation** — `projectControlSettings`, contract setup + versioning, cost-code master,
   WBS control accounts. Nothing computes yet; everything below needs these.
2. **Baselines + progress recognition** — earning rules, PV curves, earned % across all three
   lanes. First real output: an honest physical progress number nobody typed in.
3. **EVM** — needs 2 for EV/PV and 4 for AC.
4. **Cost** — manual + Excel import, roll-ups, commitment ladder.
5. **Client billing + collections** — needs contract terms (1). GST/e-invoice additionally
   needs the HSN column, client `stateCode`, and GSP credentials.
6. **Forecast, P&L, margin bridge, cash flow, ROI** — need 3, 4, 5.
7. **Exposure** — variations, EOT, LD, delay cost, claims, risks, milestones.
8. **Intelligence** — exceptions, reviews, actions, month close, snapshots.
9. **Control Centre + Portfolio** — last, because they render everything above.

Hardening A–D interleaves per Part 8 (E moved into Part 0). The e-approval spike (7.1) sits
inside step 2.

**The one hard sequencing constraint:** Part 0 must complete before go-live. Everything else
can slip; Part 0 cannot, because each item in it is cheap on an empty database and a migration
on a full one.

---

## Part 10 — Conventions appendix (implementation fidelity)

The module has a strong, consistent house style. New code must match it or it will read as
foreign — and two of these will *silently* break the build gates.

### 10.1 ⚠️ Two things that fail silently

1. **A new pure lib must be added to `tsconfig.project-management.json`'s `include`** (or a new
   `tsconfig.project-control.json`). Otherwise it escapes the scoped typecheck entirely and
   nobody notices.
2. **A lib loaded by a `.mjs` test needs `.ts` on every relative import**, and must not import
   `firebase/*`, `react` or `server-only` anywhere in its transitive graph except
   `import type`. `tsconfig.json` documents the reason for `allowImportingTsExtensions: true`:
   Node's ESM resolver requires explicit extensions, while Next-bundled code stays
   extensionless. The rule is: **`.ts` extensions iff unit-tested under Node.**
   Also, `--experimental-strip-types` *erases* types, it cannot transform — so no `enum`, no
   `namespace`, no parameter properties.

Both `package.json` (`test:project-control`) and the new tsconfig must be added in step 1.

### 10.2 Pure-lib style

Module-header `/** */` with *why*, not just what, closing with the purity note. `X_COLLECTION`
+ `X_PERMISSION_RESOURCE` first in file, each with a path comment. `const X_STATUSES = [...] as const`
+ `type X = (typeof X_STATUSES)[number]`. `xStatusStyles: Record<X, string>` badge maps using
the house palette (neutral `bg-muted text-muted-foreground` · in-flight `blue-100/700` · done
`emerald-100/700` · caution `amber-100/700` · failure `red-100/700`). Validators return a named
exported `{ field: keyof XDraft; message: string }[]` with **full-sentence messages ending in a
period**. `today: Date = new Date()` as the last parameter of every date-sensitive function
(or `options.today`). Local-date parsing always `new Date(\`${v}T00:00:00\`)`, never bare
`Date.parse`. `Pick<>` on parameters so callers can pass partials. Tolerant readers for
anything from Firestore, degrading rather than throwing. Explicit rounding —
`Math.round(x*1000)/1000` for quantities, `/100` for percents. Formatters live in the lib
(`Intl.NumberFormat("en-IN")`), not the page. Section rules as
`/* ── Name ────… */`.

### 10.3 Test style

**Flat `test()` only — there are zero `describe()` calls in the module's 150 tests.** Structure
comes from box-drawing section comments. Names are lowercase declarative sentences describing
*the rule*, not the function (`'procurement tolerance remains a ceiling and is never treated as
project demand'`). `node:assert/strict`; single quotes in tests (libs use double). Factory
fixtures (`makeTower`, `makeUpdate`) at module top with `...overrides` spread. **All fixture
dates in 2026** so nothing time-bombs. `today` passed explicitly at every call site.

### 10.4 Page style

Newest generation is **Provider + Guard** (`tower-progress-provider.tsx` + `tower-progress-ui.tsx`);
the Control layer should follow it, with a `project-control-provider.tsx` resolving
`?project=` once for the whole sub-tree. The layout **must** wrap it in `<Suspense>` — the
provider reads `useSearchParams`, which suspends during prerender.

Reuse the factored chrome in `src/components/jmc/jmc-page-shell.tsx`: `JMC_MAIN_CLASS`,
`JmcPageHeader`, `JmcAccessDenied`, `JmcProjectNotFound`, `JmcLoadingState`,
`JmcCardGridLoadingState`, `JmcNavCard`. Settings screens use the slate gradient
(`from-slate-500 to-slate-700`); each feature gets its own gradient constant.

**Render-order guard triad, always this order:** loading → denied → not-found. The reason is
written down: *"a screen that renders an empty table while permissions are still resolving
looks like 'no data' rather than 'not loaded yet'."* Effects must return early on
`isAuthLoading`.

Errors: `console.error("Failed to <verb> <noun>:", error)` **and** a toast — never one or the
other. Failure titles start `"Unable to …"`, successes are bare noun phrases
(`toast({ title: "Settings saved" })`), validation failures are title-only destructive toasts.
`variant: "destructive"` on every error, none on success. Tab/filter state goes in the URL
(`?view=`) so a refresh doesn't reset it. Settings screens import their defaults from the
domain libs rather than re-typing them.

### 10.5 Firestore write style

Concurrency: `transaction.get()` → precondition check → `transaction.set(ref, payload, { merge: true })`.
Three established variants — `updatedAt` revision compare via `revisionOf()`, state-value
compare with an exported sentinel (`TOWER_CONCURRENT_UPDATE`), or a status precondition
throwing a user-facing message. Toast a *distinguishing* message on conflict ("This changed —
refresh before editing again"), not a generic failure.

Audit fields inline (§1.2), `serverTimestamp()`, `actor.id`/`actor.name`. **Never write
`undefined`** — drop the key instead; a `null` reads back as a value and defeats the tolerant
readers. Batch ceiling `BATCH_LIMIT = 450`.

`logUserActivity`: always `void`-ed (never awaited), **after** the successful write and
**before** the success toast, inside the `try`. `action` is `"<Verb> <Noun>"`; `details` always
starts with `project: <projectName>`; `recordRef` uses `·` (U+00B7) as the compound separator.
Use `diffFields(before, after)` for edits.

### 10.6 Reports — reuse the registry pattern wholesale

`project-management-tower-reports.ts` + `report-views.tsx` already solve exactly the problem
the Control layer's ~15 reports will have: *"fifteen reports share six renderers, so a new
report is a registry entry plus a builder rather than another page component to keep in step."*

Copy it directly for `/control/*` reporting:
- `CONTROL_REPORTS: ControlReportDefinition[]` — `id` doubles as the route segment.
- One dynamic `[reportId]/page.tsx` + `[reportId]/print/page.tsx` serves all of them.
- A pure `buildXReport(...)` per report in the domain libs.
- **Dual-output rows** — `GenericRow { cells: Record<string, ReactNode>; excel: Record<string, unknown> }`
  built in one pass, *"so an export cannot drift from what was on screen."*
- `ReportContext` carries **both** `rows` (filtered) and `allRows` (unfiltered) — filtered rows,
  unfiltered denominators.
- Filters in the query string, so "print this exact report" is a link. Include-sections encoded
  as **exclusions**, so the common case gives a clean URL and an old link still renders a new
  section.
- Registry-integrity test (unique ids, `byId` round-trip, every report has a renderer).

**The S-curve (§39) would be the first in the repo** — no `LineChart`/`AreaChart` exists in PM
today, and nothing matching "s-curve" exists anywhere. Nearest precedent to copy is
`e-approval/reports/executive/page.tsx`. `recharts` primitives are imported directly with hex
colour constants; PM does not use the `ui/chart.tsx` wrapper. `gantt-chart.tsx` and
`workplan-calendar.tsx` are already generic and prop-driven — reuse for milestones and baselines
rather than adding a Gantt dependency.

Print output: a sibling `/print` route with no app shell, inline `@media print` + `@page { size: A4 … }`,
`window.print()` after a delay for image loading. Orientation from the registry.

---

## Part 11 — Open questions to settle before implementation

Three of the original five were resolved by the pre-launch window (Part 0). Two remain, and
both are **judgement calls about how the business works**, not technical unknowns — which is
why they cannot be settled from the code.

1. **§3.4a — is "live EV on the existing credit rule, verified EV for month close and client
   reports, gap raised as an exception" the right answer?** The alternative reading of §7 gives
   an EV that drops whenever the verification queue builds up, so CPI and SPI would move
   because a checker went on leave. This is the one place where the requirement as written and
   the Tower module's deliberate design genuinely disagree, and picking either extreme silently
   would be the wrong way to resolve it.
2. **At what granularity is a transmission-line BOQ actually written?** §0.2 puts `boqItemId` on
   the tower, which works whether foundations/erection/stringing are one BOQ line per activity
   across the whole line, per section, or per tower type. But the *reporting* granularity of
   `/control/progress` depends on the answer, and so does whether `boqBasis: 'per-span'` needs
   a third option.

Resolved, for the record:

| Was | Now |
|---|---|
| Which stock system is the store of record? | Inventory v2, with a real `boqItemId` (§0.6) |
| Does the SAS cost bridge matter later? | Fields added now while free (§0.7); derivation still deferred |
| How is a tower linked to its BOQ lines? | Directly, via `boqItemId` on the tower (§0.2) |
| Is `manufacturingProgressPct` acceptable as a manual MC field? | Yes — added in Part 0's field list, defaults to 0 |

---

## Verification

The module's existing verification story is strong and must be preserved and extended.

**New per-module gates, mirroring the existing convention:**

```sh
# new scoped typecheck — tsconfig.project-control.json listing the new routes,
# components, and src/lib/project-control-*.ts + project-commercial-*.ts + project-client-billing*.ts
npm run typecheck:project-control

# new domain tests — pure libs, node type stripping, no Firebase, no emulator
npm run test:project-control
#   → node --experimental-strip-types --test tests/project-control-domain.test.mjs

# existing suites must stay green — this layer must not regress them
npm run test:project-management       # currently 150 passing
npm run typecheck:project-management  # currently clean
```

**Test coverage the pure libs must have** (table-driven, `today` injected, matching the
existing suites' style):

- **WBS** — every non-header BOQ line lands in exactly one account; conflicts and orphans reported.
- **Earning rules** — weights not totalling 100 rejected; project→scope→category cascade
  resolves; missing `manufacturingProgressPct` degrades to 0%, never `NaN`.
- **EVM** — `SPI`/`CPI`/`TCPI`/`eacStatistical` are `undefined` (not 0, not Infinity) at
  PV/AC/BAC−EV = 0.
- **Baseline** — first Approved baseline cannot be deleted; `computePlannedPct` is monotonic
  and ends at exactly 100%.
- **Ladder extension** — `clientBilled > jmcCertified` raises `critical`; absent fields still
  mean "not recorded"; **every existing ladder test passes unchanged**.
- **Margin bridge** — sums exactly to the profit delta in every case, balancing line included.
- **Delay / LD** — LD capped at `ldCapPct`; pending EOT never silently reduces exposure.
- **Deductions** — retention + advance recovery + TDS against the terms **in force on the bill
  date**, not today's.
- **GST** — intra-state → CGST+SGST, inter-state → IGST; `buildEInvoicePayload` shape.
- **Period close** — `canClosePeriod` blocks on each required step; a closed period is immutable.
- **Exceptions** — emit valid `ProjectAttentionItem`s that sort correctly when concatenated
  with `calculateProjectControlTower().attention`.
- **Tower↔BOQ link (§0.2)** — `per-span` basis excludes the last tower on the line; a tower
  with no `boqItemId` raises an unlinked-tower exception and is excluded from the denominator
  rather than counted as 0%; a BOQ line with no towers falls back to its own lane.
- **Measurement join (§0.1)** — an item with `boqItemId` joins by id; one without falls back to
  the composite key and produces the *same* aggregate, so the fallback is provably equivalent
  before it is retired.
- **Verified vs live EV (§3.4a)** — `earnedPct ≥ verifiedEarnedPct` always;
  `unverifiedEvValue` is exactly the difference × budget; a verification queue changes
  `verifiedEarnedPct` but **never** `earnedPct`.
- **Report registry** — unique ids, `byId` round-trip, every report has a renderer, and every
  row's `excel` keys match its `cells` keys (the export-drift guard).

**End-to-end, once built:** on a real project — record verified tower progress → confirm the
same percentage appears as EV in `/control/evm` with no re-entry → import a period's actual
cost → confirm CPI, EAC, P&L and cash flow move → raise and certify an RA bill → confirm
earned/billed/collected diverge correctly and `unbilledRevenue` ties → invoke the cron with
the `CRON_SECRET` header → confirm a snapshot is written and an exception notification reaches
the header bell → close the period → confirm the snapshot is immutable and reopening demands
an approval.

**Non-negotiable regression checks:**
- No screen anywhere accepts a typed-in progress percentage.
- **No existing PM page changes behaviour when every new collection is empty.**
