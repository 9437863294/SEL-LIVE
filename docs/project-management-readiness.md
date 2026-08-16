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
- drawing approval and overdue engineering deliverables;
- unique BOQ lines at every physical supply gate; and
- management exceptions such as late requirements, failed inspections, blocking punch items,
  GRN discrepancies, held MVACs, and signed MVACs not released to billing.

Pure domain calculations are covered by `tests/project-management-domain.test.mjs`. A scoped
TypeScript configuration (`tsconfig.project-management.json`) keeps this module independently
verifiable even while unrelated legacy screens have type errors.

## Data ownership

Project mappings remain in `projectManagementProjects`. Operational data remains under the mapped
global project at `projects/{globalProjectId}/...`. Civil and Erection work packages are stored in
`projects/{globalProjectId}/scopeWorkPackages`, distinguished by their `scope` field. This keeps
all execution data attached to the canonical project and avoids a second project hierarchy.

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
