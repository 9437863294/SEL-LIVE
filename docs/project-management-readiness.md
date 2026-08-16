# Project Management readiness notes

## Delivered control model

The module now covers the commercial and physical flow from BOQ through survey, requirement
planning, indent, RFQ, purchase order, manufacturing clearance, inspection, DI/MDCC, GRN, MVAC,
and billing release. Civil and Erection use accountable work packages with owners, planned and
actual dates, priority, progress, blockers, next actions, audit logging, safe CSV export, and
optimistic concurrency checks.

The Project Management landing page includes a cross-register control tower. It calculates:

- BOQ value and survey coverage;
- open indents and RFQs, live PO commitment, and overdue POs;
- committed value measured against the BOQ budget baseline, with an over-commitment exception when
  PO value crosses it;
- schedule position against the mapping's planned completion date, flagged when the date has
  passed while procurement or acceptance is still open;
- drawing approval and overdue engineering deliverables;
- unique BOQ lines at every physical supply gate;
- stalled gates — waiting-state records (RFQs sent, inspections/MDCCs/MVACs requested, DIs issued)
  older than the configurable stall threshold, grouped by who they are sitting with;
- a quantity-integrity roll-up that runs `reconcileBoqQuantities` across every BOQ line and counts
  register disagreements (critical) and over-scope commitments (warning); and
- management exceptions such as late requirements, failed inspections, blocking punch items,
  GRN discrepancies, held MVACs, and signed MVACs not released to billing.

The stall threshold, variation tolerance, survey plausibility limit, and procurement lead time are
all configurable in General Settings (`projectManagementSettings/general`).

Pure domain calculations are covered by `tests/project-management-domain.test.mjs`. A scoped
TypeScript configuration (`tsconfig.project-management.json`) keeps this module independently
verifiable even while unrelated legacy screens have type errors.

## Data ownership

Project mappings remain in `projectManagementProjects`. Operational data remains under the mapped
global project at `projects/{globalProjectId}/...`. Civil and Erection work packages are stored in
`projects/{globalProjectId}/scopeWorkPackages`, distinguished by their `scope` field. This keeps
all execution data attached to the canonical project and avoids a second project hierarchy.

## Civil join (Billing Recon / Subcontractors Management)

The civil commercial chain is owned by Billing Recon and Subcontractors Management and READ by
Project Management — never written (`src/lib/civil-execution.ts` is the single join point):

- `projects/{id}/workOrders` — subcontract commitment; items join by `boqItemId`.
- `projects/{id}/jmcEntries` / `mvacEntries` — joint measurement (executed/certified); items join
  ONLY by the composite key (`scope1` lowercased, `scope2` lowercased, `boqSlNo` trimmed) — they
  carry no `boqItemId`. Both modules write the same collections; PM and Billing Recon read the
  identical `projects/{id}/boqItems` documents, so rows correspond 1:1 by doc id.
- `projects/{id}/bills` — subcontractor bills; items join by `boqItemId`. Retention bills are
  excluded from quantity aggregation (they re-claim already-billed value).

What the join now powers: the civil lane in the BOQ Item 360° timeline (Survey → Work Order →
Execution → JMC → Billing), the civil quantity ladder (BOQ → Survey → WO-Ordered → Executed →
JMC → Subcontractor-Billed → Billed, with sub-billed checked against certified), the Subcontract
& measurement coverage table on the Civil/Erection workspaces, and the control tower's civil
block, its work-order-inclusive cost commitment, and JMC/bill workflow stall ageing.

Rejected/Cancelled measurement entries and cancelled work orders are excluded everywhere,
including the BOQ costing page's JMC/MVAC columns (previously they were counted there).

## JMC screens hosted in Project Management

The JMC screens (hub, entry, log, workflow stage, reports, settings, workflow configuration) now
exist under `/project-management/jmc/**`, reached from the **JMC** button on the Civil and Erection
workspaces. Billing Recon's originals at `/billing-recon/[project]/jmc/**` and the Subcontractors
copy of the entry screen are deliberately unchanged and stay live — same registers, two doors.

The Project Management copies differ only where they must, via `src/lib/jmc-module.ts`:

- routed by `?project={mappingId}` (resolved to the mapped global project by
  `useProjectManagementJmcContext`) instead of a `[project]` slug;
- gated on `Project Management.JMC` rather than `Billing Recon.JMC`, always through the 2-argument
  dotted `can(action, resource)` form (the originals disagreed — the workflow-configuration screen
  used the 3-argument scoped form, which resolves differently for nested role storage);
- activity-log rows carry module `Project Management`.

Everything else is identical, deliberately: the same `projects/{id}/jmcEntries` documents, the same
`billingReconSerialConfigs` counter (so numbering does not fork between the two hosts), and the same
single global `workflows/jmc-workflow` document.

**Before this ships, roles must be granted the new `Project Management.JMC` actions.** Users
authorised only under `Billing Recon.JMC` will see Access Denied on the Project Management copies.

Three gaps were closed on the way, all of which the Billing Recon originals still have:

1. the entry, log and stage screens had **no permission checks at all** — they now carry
   `Create JMC Entry`, `View Log` and `View` gates respectively;
2. the log screen exposed an **ungated `deleteDoc`** on `jmcEntries` — delete is now gated on
   `Delete JMC`, in both the UI and the handler;
3. the two settings screens used **incompatible `can()` call shapes**, so a role stored nested
   could pass the settings index and then fail on workflow configuration.

These are client-side gates. Firestore Security Rules remain the real boundary and should enforce
the same rights on `projects/{projectId}/jmcEntries` (see the production gates section above).

### Known issues inherited from the JMC design (not introduced here)

- `workflows/jmc-workflow` is a **single global document**: editing the workflow from any project
  changes it for every project.
- `WorkflowStep.id` is **positional** — `normalizeIds()` rewrites every id to its 1-based array
  index on load, add, delete, reorder and save. Reordering or deleting a step silently re-homes
  in-flight entries, because `jmcEntries.currentStepId` is the live foreign key, and any bookmarked
  `/stage/{id}` URL then points at a different stage.
- The Subcontractors copy of the entry screen omits `userName`/`userEmail` from its activity-log
  call, so JMCs raised from that route write blank user audit rows.

## Production gates outside the UI

Before treating a deployment as fully production-hardened, verify these environment controls:

1. Source-control and deploy Firestore Security Rules that enforce the same role permissions on
   every Project Management collection. `firebase.json` currently references indexes but does not
   reference a Firestore rules file, so client-side permission checks alone must not be considered
   a security boundary.
2. Replace the broad authenticated-user fallback in `storage.rules` with project/organization and
   action-aware rules for Project Management documents.
3. Configure Firebase backups/PITR, retention, alerting, and restore drills for the production
   project.
4. For very large projects, move control-tower calculations to maintained aggregate documents or
   a scheduled backend job; the current client calculation intentionally reads each selected
   project's operational registers to stay immediately consistent.
5. Resolve the pre-existing repository-wide TypeScript and lint findings before making the global
   CI pipeline blocking. The ESLint flat configuration now loads correctly, and the Project
   Management-specific typecheck, targeted lint, and domain tests are suitable as blocking checks.
