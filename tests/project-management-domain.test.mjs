import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProjectControlTower,
  projectBoqValue,
  projectManagementNumber,
} from '../src/lib/project-management-dashboard.ts';
import {
  calculateWorkPackageSummary,
  isWorkPackageOverdue,
  validateWorkPackage,
} from '../src/lib/project-management-work-packages.ts';
import {
  computeAvailableQty,
  computeNetRequirement,
} from '../src/lib/project-management-variations.ts';
import {
  buildBoqTimeline,
  computeBoqProgressPct,
  currentTraceStage,
} from '../src/lib/boq-traceability.ts';
import { reconcileBoqQuantities } from '../src/lib/boq-quantity-control.ts';
import {
  canActivateProject,
  canTransitionLifecycle,
  deriveLegacyStatus,
  projectRunsScope,
  resolveLifecycle,
  validatePmProject,
} from '../src/lib/project-management-projects.ts';

const baseWorkPackage = {
  scope: 'Civil',
  title: 'Foundation block A',
  description: '',
  location: 'Block A',
  ownerName: 'Site Engineer',
  contractor: 'Civil Partner',
  priority: 'High',
  status: 'In Progress',
  plannedStartDate: '2026-07-01',
  plannedEndDate: '2026-08-10',
  actualStartDate: '2026-07-02',
  actualEndDate: '',
  progressPct: 60,
  blocker: '',
  nextAction: 'Complete reinforcement',
};

test('project numeric and BOQ value parsing supports formatted operational data', () => {
  assert.equal(projectManagementNumber('₹1,25,000.50'), 125000.5);
  assert.equal(projectBoqValue({ QTY: '10', 'Budget Price': '₹2,500' }), 25000);
  assert.equal(projectBoqValue({ 'Total Amount': '₹30,000', QTY: 10, 'Budget Price': 2500 }), 30000);
});

test('procurement tolerance remains a ceiling and is never treated as project demand', () => {
  assert.equal(computeAvailableQty(100, 5, 0, 100), 5);
  assert.equal(computeNetRequirement(100, 0, 100), 0);
  assert.equal(computeNetRequirement(100, 12, 100), 12);
});

test('control tower consolidates commercial, engineering, and supply-gate status', () => {
  const summary = calculateProjectControlTower({
    today: new Date(2026, 7, 16),
    leadTimeDays: 30,
    boqItems: [
      { id: 'boq-1', QTY: 10, 'Budget Price': 1000, surveyedQty: 10, requiredAtSiteDate: '2026-09-30' },
      { id: 'boq-2', QTY: 5, 'Budget Price': 2000, requiredAtSiteDate: '2026-08-20' },
    ],
    indents: [{ id: 'indent-1', status: 'Draft', items: [{ boqItemId: 'boq-1', requestedQty: 5 }] }],
    rfqs: [{ id: 'rfq-1', status: 'Sent' }],
    purchaseOrders: [{
      id: 'po-1',
      status: 'Issued',
      totalAmount: 8000,
      endDate: '2026-08-01',
      items: [{ boqItemId: 'boq-1' }, { boqItemId: 'boq-2' }],
    }],
    mdlDrawings: [{ id: 'boq-1', status: 'In Progress', plannedEndDate: '2026-08-05' }],
    manufacturingClearances: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Cleared' }],
    inspections: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Passed' }],
    mdccRecords: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Issued' }],
    dispatchInstructions: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Dispatched' }],
    grns: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Received Clean' }],
    mvacRecords: [{ id: 'boq-1', boqItemId: 'boq-1', status: 'Signed' }],
  });

  assert.equal(summary.boq.budgetValue, 20000);
  assert.equal(summary.boq.surveyCoveragePct, 50);
  assert.equal(summary.procurement.openIndentCount, 1);
  assert.equal(summary.procurement.openRfqCount, 1);
  assert.equal(summary.procurement.committedValue, 8000);
  assert.equal(summary.procurement.overduePoCount, 1);
  assert.equal(summary.engineering.overdueDrawingCount, 1);
  assert.deepEqual(summary.supplyPipeline.map((stage) => stage.count), [2, 1, 1, 1, 1, 1, 1, 0]);
  assert.ok(summary.attention.some((item) => item.id === 'late-requirements'));
  assert.ok(summary.attention.some((item) => item.id === 'signed-not-released'));
  assert.equal(summary.attention[0].severity, 'critical');
});

test('control tower does not flag fully indented requirements as late', () => {
  const summary = calculateProjectControlTower({
    today: new Date(2026, 7, 16),
    leadTimeDays: 30,
    boqItems: [{ id: 'boq-1', QTY: 10, requiredAtSiteDate: '2026-08-01' }],
    indents: [{ status: 'Approved', items: [{ boqItemId: 'boq-1', requestedQty: 10 }] }],
    rfqs: [],
    purchaseOrders: [],
    mdlDrawings: [],
    manufacturingClearances: [],
    inspections: [],
    mdccRecords: [],
    dispatchInstructions: [],
    grns: [],
    mvacRecords: [],
  });
  assert.equal(summary.attention.some((item) => item.id === 'late-requirements'), false);
});

test('work-package validation enforces accountable status and schedule invariants', () => {
  const blockedErrors = validateWorkPackage({ ...baseWorkPackage, status: 'Blocked', blocker: '' });
  assert.ok(blockedErrors.some((error) => error.field === 'blocker'));

  const completedErrors = validateWorkPackage({
    ...baseWorkPackage,
    status: 'Completed',
    progressPct: 95,
    actualEndDate: '',
  });
  assert.ok(completedErrors.some((error) => error.field === 'progressPct'));
  assert.ok(completedErrors.some((error) => error.field === 'actualEndDate'));

  assert.deepEqual(validateWorkPackage({ ...baseWorkPackage }), []);
});

test('execution summary identifies overdue, blocked, due-soon, and progress state', () => {
  const packages = [
    { ...baseWorkPackage, id: 'a' },
    { ...baseWorkPackage, id: 'b', status: 'Blocked', blocker: 'Access unavailable', progressPct: 20, plannedEndDate: '2026-08-20' },
    { ...baseWorkPackage, id: 'c', status: 'Completed', progressPct: 100, actualEndDate: '2026-08-01' },
  ];
  const today = new Date(2026, 7, 16);
  const summary = calculateWorkPackageSummary(packages, today);

  assert.equal(isWorkPackageOverdue(packages[0], today), true);
  assert.equal(isWorkPackageOverdue(packages[2], today), false);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.averageProgressPct, 60);
});

/* ---------------------------------------------------------------------------
 * BOQ traceability — the lifecycle assembler behind the BOQ Item 360 view.
 * ------------------------------------------------------------------------- */

const supplyTraceBase = {
  lane: 'supply',
  boqQty: 10,
  surveyedQty: 10,
  surveyDate: '2026-01-05',
  mdlRequired: true,
  inspectionRequired: true,
  indentLines: [{ indentNumber: 'IND-1', indentDate: '2026-01-10', requestedQty: 10 }],
  rfqLines: [{ rfqNumber: 'RFQ-1', rfqDate: '2026-01-15', qty: 10, awardedVendorName: 'ABC Ltd' }],
  poLines: [{ poNumber: 'PO-1', poDate: '2026-02-01', qty: 10, vendorName: 'ABC Ltd', status: 'Issued' }],
  mdl: { status: 'Approved', firstSubmittedOn: '2026-01-20' },
  mc: { status: 'Cleared', clearedDate: '2026-02-10' },
  inspection: { status: 'Passed', inspectionDate: '2026-02-20', qtyAccepted: 10 },
};

test('BOQ timeline stops at the first unfinished stage and names exactly one current stage', () => {
  const stages = buildBoqTimeline({
    ...supplyTraceBase,
    mdcc: { status: 'Requested', requestedDate: '2026-02-25' },
  });

  const current = currentTraceStage(stages);
  assert.equal(current?.key, 'mdcc');
  // "Requested" means work has visibly started, so it reads as active rather than merely pending.
  assert.equal(current?.status, 'active');

  const currentish = stages.filter((s) => s.status === 'active' || s.status === 'blocked');
  assert.equal(currentish.length, 1);
  assert.equal(stages.find((s) => s.key === 'inspection')?.status, 'done');
  assert.equal(stages.find((s) => s.key === 'grn')?.status, 'pending');
});

test('BOQ timeline blocks MDCC on open critical punch items and explains why', () => {
  const stages = buildBoqTimeline({
    ...supplyTraceBase,
    inspection: {
      status: 'Passed with Punch Items',
      inspectionDate: '2026-02-20',
      qtyAccepted: 10,
      punchItems: [{ punchId: 'p1', description: 'Weld defect', severity: 'Critical', closed: false }],
    },
  });

  const mdcc = stages.find((s) => s.key === 'mdcc');
  assert.equal(mdcc?.status, 'blocked');
  assert.equal(mdcc?.blockedReason, 'Open critical/major punch items');
});

test('BOQ timeline marks drawing, inspection and MDCC N/A on the direct path', () => {
  const stages = buildBoqTimeline({
    ...supplyTraceBase,
    mdlRequired: false,
    inspectionRequired: false,
    mdl: undefined,
    inspection: undefined,
    di: { status: 'Dispatched', diNumber: 'DI-1', dispatchedOn: '2026-03-01', dispatchQty: 10, path: 'direct' },
    grn: { status: 'Received Clean', grnNumber: 'GRN-1', receivedDate: '2026-03-05', acceptedQty: 10 },
    mvac: { status: 'Signed', signedOn: '2026-03-10', qtyAccepted: 10 },
  });

  assert.equal(stages.find((s) => s.key === 'drawing')?.status, 'na');
  assert.equal(stages.find((s) => s.key === 'inspection')?.status, 'na');
  assert.equal(stages.find((s) => s.key === 'mdcc')?.status, 'na');
  assert.equal(stages.find((s) => s.key === 'di')?.status, 'done');
  // N/A stages leave the denominator, so a fully delivered direct-path item still reads 100%.
  assert.equal(computeBoqProgressPct(stages), 100);
});

test('BOQ timeline holds at the drawing while it is under review, and MC waits behind it', () => {
  const stages = buildBoqTimeline({
    ...supplyTraceBase,
    mdl: { status: 'Under Review' },
    mc: undefined,
    inspection: undefined,
  });

  // A drawing under review is genuinely in progress even before it carries a date, so the item is
  // sitting at the drawing — not at MC.
  const current = currentTraceStage(stages);
  assert.equal(current?.key, 'drawing');
  assert.equal(current?.status, 'active');
  assert.equal(stages.find((s) => s.key === 'mc')?.status, 'pending');
});

test('BOQ timeline advances to manufacturing clearance once the drawing is approved', () => {
  const stages = buildBoqTimeline({ ...supplyTraceBase, mc: undefined, inspection: undefined });
  assert.equal(currentTraceStage(stages)?.key, 'mc');
});

test('BOQ timeline reports MVAC held on an open critical observation', () => {
  const stages = buildBoqTimeline({
    ...supplyTraceBase,
    mdcc: { status: 'Issued', mdccNumber: 'MDCC-1', mdccDate: '2026-02-25' },
    di: { status: 'Dispatched', diNumber: 'DI-1', dispatchedOn: '2026-03-01', dispatchQty: 10 },
    grn: { status: 'Received Clean', grnNumber: 'GRN-1', receivedDate: '2026-03-05', acceptedQty: 10 },
    mvac: {
      status: 'Held',
      qtyHeld: 10,
      observations: [{ punchId: 'o1', description: 'Nameplate mismatch', severity: 'Critical', closed: false }],
    },
  });

  const current = currentTraceStage(stages);
  assert.equal(current?.key, 'mvac');
  assert.equal(current?.status, 'blocked');
  assert.equal(current?.blockedReason, 'Held — open critical observation');
});

test('BOQ timeline uses the civil lane for civil items', () => {
  const stages = buildBoqTimeline({
    lane: 'civil',
    boqQty: 100,
    surveyedQty: 105,
    mdlRequired: false,
    inspectionRequired: false,
    workPackages: [
      {
        id: 'wp1',
        scope: 'Civil',
        title: 'Foundation',
        ownerName: 'Site Engineer',
        priority: 'High',
        status: 'Completed',
        plannedStartDate: '2026-01-01',
        plannedEndDate: '2026-02-01',
        actualEndDate: '2026-01-28',
        progressPct: 100,
      },
    ],
  });

  assert.deepEqual(stages.map((s) => s.key), ['survey', 'workOrder', 'workPackage', 'jmc', 'billing']);
  assert.equal(stages.find((s) => s.key === 'workPackage')?.status, 'done');
  assert.equal(stages.find((s) => s.key === 'survey')?.detail, '+5 vs BOQ');
  // No subcontract work order means departmental execution — N/A, never a block.
  assert.equal(stages.find((s) => s.key === 'workOrder')?.status, 'na');
  // JMC is now genuinely joined — with no measurement yet it is the pending current stage.
  assert.equal(stages.find((s) => s.key === 'jmc')?.status, 'pending');
});

test('BOQ timeline shows the subcontract work order and holds JMC until fully certified', () => {
  const stages = buildBoqTimeline({
    lane: 'civil',
    boqQty: 100,
    surveyedQty: 100,
    mdlRequired: false,
    inspectionRequired: false,
    workOrder: {
      orderedQty: 100,
      workOrderNos: ['WO/001'],
      subcontractorNames: ['Civil Partner'],
      latestDate: '2026-02-01',
    },
    jmc: { executedQty: 80, certifiedQty: 50, entryCount: 2, latestNo: 'JMC/007', latestDate: '2026-05-10' },
  });

  const workOrder = stages.find((s) => s.key === 'workOrder');
  assert.equal(workOrder?.status, 'done');
  assert.equal(workOrder?.reference, 'WO/001');
  assert.equal(workOrder?.actor, 'Civil Partner');
  // No PM work package, but JMC shows execution — the stage steps aside instead of blocking.
  assert.equal(stages.find((s) => s.key === 'workPackage')?.status, 'na');
  const jmc = stages.find((s) => s.key === 'jmc');
  assert.equal(jmc?.status, 'active');
  assert.equal(jmc?.detail, '50 certified of 80 executed');

  const certified = buildBoqTimeline({
    lane: 'civil',
    boqQty: 100,
    surveyedQty: 100,
    mdlRequired: false,
    inspectionRequired: false,
    jmc: { executedQty: 80, certifiedQty: 80, entryCount: 2, latestNo: 'JMC/009' },
  });
  assert.equal(certified.find((s) => s.key === 'jmc')?.status, 'done');
});

/* ---------------------------------------------------------------------------
 * Quantity reconciliation — the ladder that catches registers disagreeing.
 * ------------------------------------------------------------------------- */

test('quantity reconciliation passes a clean, monotonically decreasing chain', () => {
  const ledger = reconcileBoqQuantities({
    boqQty: 100,
    surveyedQty: 100,
    indentedQty: 100,
    orderedQty: 100,
    inspectedAcceptedQty: 80,
    dispatchedQty: 60,
    receivedQty: 60,
    siteAcceptedQty: 58,
    clientAcceptedQty: 58,
    tolerancePct: 5,
  });

  assert.deepEqual(ledger.exceptions, []);
  assert.equal(ledger.worstSeverity, null);
  assert.equal(ledger.rungs.find((r) => r.key === 'siteAccepted')?.deltaFromPrevious, -2);
});

test('quantity reconciliation flags a downstream stage exceeding its upstream as critical', () => {
  const ledger = reconcileBoqQuantities({
    boqQty: 100,
    orderedQty: 100,
    inspectedAcceptedQty: 10,
    dispatchedQty: 12,
    tolerancePct: 5,
  });

  const breach = ledger.exceptions.find((e) => e.rung === 'dispatched');
  assert.equal(breach?.severity, 'critical');
  assert.equal(breach?.comparedTo, 'inspected');
  assert.equal(ledger.worstSeverity, 'critical');
});

test('quantity reconciliation applies tolerance and approved variation to ordered quantity', () => {
  const within = reconcileBoqQuantities({ boqQty: 100, orderedQty: 104, tolerancePct: 5 });
  assert.deepEqual(within.exceptions, []);

  const over = reconcileBoqQuantities({ boqQty: 100, orderedQty: 110, tolerancePct: 5 });
  assert.equal(over.exceptions[0]?.severity, 'warning');
  assert.equal(over.exceptions[0]?.comparedTo, 'allowance');

  const covered = reconcileBoqQuantities({
    boqQty: 100,
    orderedQty: 110,
    tolerancePct: 5,
    approvedVariationQty: 10,
  });
  assert.deepEqual(covered.exceptions, []);
});

test('quantity reconciliation never treats a missing billed quantity as zero', () => {
  const ledger = reconcileBoqQuantities({
    boqQty: 10,
    orderedQty: 10,
    inspectedAcceptedQty: 10,
    dispatchedQty: 10,
    receivedQty: 10,
    siteAcceptedQty: 10,
    clientAcceptedQty: 10,
    // billedQty deliberately omitted — no client-billing module exists yet.
  });
  assert.deepEqual(ledger.exceptions, []);
  assert.equal(ledger.rungs.find((r) => r.key === 'billed')?.qty, undefined);
});

test('quantity reconciliation uses surveyed quantity as the base and reports what is left to order', () => {
  const ledger = reconcileBoqQuantities({
    boqQty: 100,
    surveyedQty: 120,
    indentedQty: 100,
    orderedQty: 100,
    tolerancePct: 0,
  });
  // 120 surveyed supersedes the 100 stated in the BOQ, so ordering 100 is within scope.
  assert.deepEqual(ledger.exceptions, []);
  assert.equal(ledger.availableToOrder, 20);
});

test('quantity reconciliation uses the civil ladder for civil items', () => {
  const ledger = reconcileBoqQuantities({
    lane: 'civil',
    boqQty: 100,
    surveyedQty: 100,
    executedQty: 90,
    jmcQty: 95,
    tolerancePct: 0,
  });
  assert.deepEqual(
    ledger.rungs.map((r) => r.key),
    ['boq', 'survey', 'woOrdered', 'executed', 'jmc', 'subBilled', 'billed'],
  );
  // Certifying more than was executed means two registers disagree.
  assert.equal(ledger.exceptions.find((e) => e.rung === 'jmc')?.severity, 'critical');
});

test('civil work-order commitment is scope-checked and never caps departmental execution', () => {
  const ledger = reconcileBoqQuantities({
    lane: 'civil',
    boqQty: 100,
    surveyedQty: 100,
    woOrderedQty: 120,
    executedQty: 95,
    jmcQty: 90,
    tolerancePct: 10,
  });
  // 120 ordered against 100 + 10% tolerance → over approved scope, a warning like supply's PO rung.
  const woException = ledger.exceptions.find((e) => e.rung === 'woOrdered');
  assert.equal(woException?.severity, 'warning');
  assert.equal(woException?.comparedTo, 'allowance');
  // Executed compares against the surveyed base, NOT against the work order — partial departmental
  // execution alongside a subcontract must not read as a register disagreement.
  assert.equal(ledger.exceptions.some((e) => e.rung === 'executed'), false);
  // Civil "available to order" consumes the work-order commitment.
  assert.equal(ledger.availableToOrder, 0);
});

test('subcontractor billing beyond certified measurement is critical', () => {
  const overBilled = reconcileBoqQuantities({
    lane: 'civil',
    boqQty: 100,
    executedQty: 90,
    jmcQty: 80,
    subcontractorBilledQty: 85,
  });
  const exception = overBilled.exceptions.find((e) => e.rung === 'subBilled');
  assert.equal(exception?.severity, 'critical');
  assert.equal(exception?.comparedTo, 'jmc');

  // Billed with no certification recorded at all is uncontrolled, but only a warning — the
  // certification may simply not be recorded yet.
  const noCertification = reconcileBoqQuantities({
    lane: 'civil',
    boqQty: 100,
    subcontractorBilledQty: 10,
  });
  assert.equal(noCertification.exceptions.find((e) => e.rung === 'subBilled')?.severity, 'warning');

  // Within certification is clean, and does not cap the client billed rung.
  const clean = reconcileBoqQuantities({
    lane: 'civil',
    boqQty: 100,
    executedQty: 90,
    jmcQty: 90,
    subcontractorBilledQty: 85,
    billedQty: 88,
  });
  assert.equal(clean.exceptions.length, 0);
});

/* ---------------------------------------------------------------------------
 * Project record — lifecycle, activation bar, and backward compatibility.
 * ------------------------------------------------------------------------- */

const activeReadyProject = {
  projectName: '220kV Substation — Package 3',
  globalProjectId: 'gp-1',
  projectCode: 'SEL/PRJ/0031',
  scopes: ['Supply', 'Civil'],
  projectManagerId: 'user-1',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'Active',
  lifecycle: 'Active',
};

test('a draft project only has to be named and mapped', () => {
  assert.deepEqual(validatePmProject({ projectName: 'New job', globalProjectId: 'gp-1', status: 'Inactive' }), []);

  const missing = validatePmProject({ projectName: '  ', globalProjectId: '', status: 'Inactive' });
  assert.ok(missing.some((e) => e.field === 'projectName'));
  assert.ok(missing.some((e) => e.field === 'globalProjectId'));
});

test('project validation rejects an end date before the start date and a malformed code', () => {
  const errors = validatePmProject({
    projectName: 'Job',
    globalProjectId: 'gp-1',
    startDate: '2026-05-01',
    endDate: '2026-04-01',
    projectCode: 'BAD CODE!',
    status: 'Inactive',
  });
  assert.ok(errors.some((e) => e.field === 'endDate'));
  assert.ok(errors.some((e) => e.field === 'projectCode'));
});

test('activation demands an owner, a scope, a code and a schedule', () => {
  assert.deepEqual(canActivateProject(activeReadyProject), []);

  const bare = canActivateProject({ projectName: 'Job', globalProjectId: 'gp-1', status: 'Inactive' });
  const fields = bare.map((e) => e.field);
  assert.ok(fields.includes('projectCode'));
  assert.ok(fields.includes('scopes'));
  assert.ok(fields.includes('projectManagerId'));
  assert.ok(fields.includes('startDate'));
  assert.ok(fields.includes('endDate'));
});

test('lifecycle transitions follow the allowed graph rather than free-form editing', () => {
  assert.equal(canTransitionLifecycle('Draft', 'Review'), true);
  assert.equal(canTransitionLifecycle('Review', 'Active'), true);
  assert.equal(canTransitionLifecycle('Active', 'On Hold'), true);
  // A draft cannot jump straight to Active, and a closed project cannot silently reopen.
  assert.equal(canTransitionLifecycle('Draft', 'Active'), false);
  assert.equal(canTransitionLifecycle('Closed', 'Active'), false);
  assert.equal(canTransitionLifecycle('Closed', 'On Hold'), true);
});

test('legacy mappings without a lifecycle still resolve, and the legacy flag stays in sync', () => {
  // Written before the wizard existed: no lifecycle field at all.
  assert.equal(resolveLifecycle({ status: 'Active' }), 'Active');
  assert.equal(resolveLifecycle({ status: 'Inactive' }), 'Draft');
  // An explicit lifecycle always wins.
  assert.equal(resolveLifecycle({ status: 'Inactive', lifecycle: 'On Hold' }), 'On Hold');

  assert.equal(deriveLegacyStatus('Active'), 'Active');
  assert.equal(deriveLegacyStatus('Completed'), 'Inactive');
});

test('scope gating shows every lane for legacy projects that never recorded scopes', () => {
  assert.equal(projectRunsScope({ scopes: ['Supply'] }, 'Supply'), true);
  assert.equal(projectRunsScope({ scopes: ['Supply'] }, 'Civil'), false);
  // Unknown scope must not hide lanes that may be in active use.
  assert.equal(projectRunsScope({}, 'Civil'), true);
});

/* ---- control tower: cost, schedule, stall-ageing, and quantity roll-up controls ---- */

const emptyTowerInput = {
  boqItems: [],
  indents: [],
  rfqs: [],
  purchaseOrders: [],
  mdlDrawings: [],
  manufacturingClearances: [],
  inspections: [],
  mdccRecords: [],
  dispatchInstructions: [],
  grns: [],
  mvacRecords: [],
};

test('control tower reports commitment against budget and flags over-commitment', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    boqItems: [{ id: 'boq-1', QTY: 10, 'Budget Price': 1000 }],
    purchaseOrders: [{ id: 'po-1', status: 'Issued', totalAmount: 12000, items: [] }],
  });
  assert.equal(summary.cost.budgetValue, 10000);
  assert.equal(summary.cost.committedValue, 12000);
  assert.equal(summary.cost.varianceValue, 2000);
  assert.equal(summary.cost.committedPct, 120);
  assert.equal(summary.cost.overBudget, true);
  assert.ok(summary.attention.some((item) => item.id === 'over-committed'));
});

test('control tower does not flag commitment within budget', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    boqItems: [{ id: 'boq-1', QTY: 10, 'Budget Price': 1000 }],
    purchaseOrders: [{ id: 'po-1', status: 'Issued', totalAmount: 8000, items: [] }],
  });
  assert.equal(summary.cost.overBudget, false);
  assert.equal(summary.attention.some((item) => item.id === 'over-committed'), false);
});

test('control tower ages waiting-state records into stalled gates', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    boqItems: [{ id: 'boq-1', QTY: 10 }],
    mdccRecords: [
      // 26 days waiting on the client — stalled.
      { id: 'boq-1', boqItemId: 'boq-1', status: 'Requested', requestedDate: '2026-07-21' },
    ],
    dispatchInstructions: [
      // Only 3 days since issue — not stalled.
      { id: 'boq-1', boqItemId: 'boq-1', status: 'Issued', issuedOn: '2026-08-13' },
    ],
    mvacRecords: [
      // Requested but no date recorded — cannot be aged, must be skipped, not guessed.
      { id: 'boq-1', boqItemId: 'boq-1', status: 'Requested' },
    ],
  });
  assert.equal(summary.stalledGates.length, 1);
  assert.equal(summary.stalledGates[0].key, 'mdcc-issue');
  assert.equal(summary.stalledGates[0].waitingOn, 'Client');
  assert.equal(summary.stalledGates[0].oldestDays, 26);
  assert.ok(summary.attention.some((item) => item.id === 'stalled-gates'));
});

test('control tower stall threshold is configurable', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    stallDays: 2,
    dispatchInstructions: [
      { id: 'boq-1', boqItemId: 'boq-1', status: 'Issued', issuedOn: '2026-08-13' },
    ],
  });
  assert.equal(summary.stalledGates.length, 1);
  assert.equal(summary.stalledGates[0].key, 'di-dispatch');
});

test('control tower rolls quantity reconciliation up across every BOQ line', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    tolerancePct: 5,
    boqItems: [
      // Section header — no Unit, no QTY — must be excluded from the check.
      { id: 'header', Description: 'BUS BAR & CIRCUIT MATERIALS' },
      // Clean line.
      { id: 'boq-1', QTY: 10, Unit: 'Nos', surveyedQty: 10 },
      // Registers disagree: dispatched more than inspected.
      { id: 'boq-2', QTY: 10, Unit: 'Nos' },
      // Over approved scope: ordered beyond BOQ + tolerance.
      { id: 'boq-3', QTY: 100, Unit: 'Nos' },
    ],
    purchaseOrders: [
      { id: 'po-1', status: 'Issued', totalAmount: 0, items: [{ boqItemId: 'boq-3', qty: 120 }] },
    ],
    inspections: [{ id: 'boq-2', boqItemId: 'boq-2', status: 'Passed', qtyAccepted: 8 }],
    dispatchInstructions: [
      { id: 'boq-2', boqItemId: 'boq-2', status: 'Dispatched', dispatchQty: 9 },
    ],
  });
  assert.equal(summary.quantityIntegrity.checkedCount, 3);
  assert.equal(summary.quantityIntegrity.criticalCount, 1);
  assert.equal(summary.quantityIntegrity.warningCount, 1);
  assert.ok(summary.attention.some((item) => item.id === 'quantity-mismatch'));
  assert.ok(summary.attention.some((item) => item.id === 'quantity-over-scope'));
});

test('control tower flags a passed end date only while work is still open', () => {
  const overdue = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    projectEndDate: '2026-08-01',
    purchaseOrders: [{ id: 'po-1', status: 'Issued', totalAmount: 1000, items: [] }],
  });
  assert.equal(overdue.schedule.daysRemaining, -15);
  assert.equal(overdue.schedule.overdueWithOpenWork, true);
  assert.ok(overdue.attention.some((item) => item.id === 'schedule-overrun'));

  const finished = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    projectEndDate: '2026-08-01',
    purchaseOrders: [{ id: 'po-1', status: 'Received', totalAmount: 1000, items: [] }],
  });
  assert.equal(finished.schedule.overdueWithOpenWork, false);
  assert.equal(finished.attention.some((item) => item.id === 'schedule-overrun'), false);

  const upcoming = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    projectEndDate: '2026-09-15',
    purchaseOrders: [{ id: 'po-1', status: 'Issued', totalAmount: 1000, items: [] }],
  });
  assert.equal(upcoming.schedule.daysRemaining, 30);
  assert.equal(upcoming.schedule.overdueWithOpenWork, false);
});

/* ---- civil execution join — Billing Recon / Subcontractors registers into the civil lane ---- */

test('measurement aggregation joins by composite key, excludes void entries, values at recorded rates', async () => {
  const { aggregateMeasurementsByBoqKey, civilBoqKey } = await import('../src/lib/civil-execution.ts');
  const aggregates = aggregateMeasurementsByBoqKey([
    {
      jmcNo: 'JMC/001', jmcDate: '2026-05-01', status: 'Completed',
      items: [
        { scope1: 'Substation', scope2: 'Civil', boqSlNo: '14.2', rate: 100, executedQty: 10, certifiedQty: 8 },
        // Legacy spellings still join — 'Scope 1' and 'BOQ SL No' on the item.
        { 'Scope 1': 'Substation', 'Scope 2': 'Civil', 'BOQ SL No': '14.3', rate: 50, executedQty: 4 },
      ],
    },
    {
      mvacNo: 'MVAC/002', mvacDate: '2026-06-01', status: 'In Progress',
      items: [{ scope1: 'SUBSTATION ', scope2: ' civil', boqSlNo: '14.2', rate: 100, executedQty: 5, certifiedQty: 5 }],
    },
    {
      jmcNo: 'JMC/BAD', jmcDate: '2026-06-15', status: 'Rejected',
      items: [{ scope1: 'Substation', scope2: 'Civil', boqSlNo: '14.2', rate: 100, executedQty: 99 }],
    },
  ]);

  const key = civilBoqKey('Substation', 'Civil', '14.2');
  const agg = aggregates.get(key);
  // 10 + 5 executed (rejected 99 excluded); certified 8 + 5; case/whitespace-insensitive scopes.
  assert.equal(agg.executedQty, 15);
  assert.equal(agg.certifiedQty, 13);
  assert.equal(agg.executedValue, 1500);
  assert.equal(agg.certifiedValue, 1300);
  assert.equal(agg.entryCount, 2);
  assert.equal(agg.latestNo, 'MVAC/002');
  assert.equal(agg.latestDate, '2026-06-01');
  assert.equal(aggregates.get(civilBoqKey('Substation', 'Civil', '14.3')).executedQty, 4);
});

test('work order aggregation joins by boqItemId and skips cancelled orders', async () => {
  const { aggregateWorkOrdersByBoqItem } = await import('../src/lib/civil-execution.ts');
  const aggregates = aggregateWorkOrdersByBoqItem([
    {
      workOrderNo: 'WO/01', subcontractorName: 'Civil Partner', date: '2026-02-01', status: 'Active',
      items: [
        { boqItemId: 'boq-1', orderQty: 60, totalAmount: 6000 },
        { boqItemId: 'boq-2', orderQty: 10, totalAmount: 1000 },
      ],
    },
    {
      workOrderNo: 'WO/02', subcontractorName: 'Second Partner', date: '2026-03-01', status: 'Active',
      items: [{ boqItemId: 'boq-1', orderQty: 40, totalAmount: 4000 }],
    },
    {
      workOrderNo: 'WO/VOID', subcontractorName: 'Gone', date: '2026-04-01', status: 'Cancelled',
      items: [{ boqItemId: 'boq-1', orderQty: 500, totalAmount: 50000 }],
    },
  ]);
  const agg = aggregates.get('boq-1');
  assert.equal(agg.orderedQty, 100);
  assert.equal(agg.amount, 10000);
  assert.deepEqual(agg.workOrderNos, ['WO/01', 'WO/02']);
  assert.deepEqual(agg.subcontractorNames, ['Civil Partner', 'Second Partner']);
  assert.equal(agg.latestDate, '2026-03-01');
});

test('subcontractor bill aggregation excludes rejected and retention bills', async () => {
  const { aggregateSubcontractorBillsByBoqItem } = await import('../src/lib/civil-execution.ts');
  const aggregates = aggregateSubcontractorBillsByBoqItem([
    { billNo: 'B/1', billDate: '2026-05-01', status: 'Completed', items: [{ boqItemId: 'boq-1', billedQty: 30 }] },
    { billNo: 'B/2', billDate: '2026-06-01', status: 'In Progress', items: [{ boqItemId: 'boq-1', billedQty: 20 }] },
    { billNo: 'B/R', billDate: '2026-07-01', status: 'Completed', isRetentionBill: true, items: [{ boqItemId: 'boq-1', billedQty: 50 }] },
    { billNo: 'B/X', billDate: '2026-07-02', status: 'Rejected', items: [{ boqItemId: 'boq-1', billedQty: 99 }] },
  ]);
  const agg = aggregates.get('boq-1');
  assert.equal(agg.billedQty, 50);
  assert.equal(agg.billCount, 2);
  assert.equal(agg.latestNo, 'B/2');
});

test('control tower joins the civil registers: cost, civil block, stalls, and the ladder', () => {
  const summary = calculateProjectControlTower({
    ...emptyTowerInput,
    today: new Date(2026, 7, 16),
    tolerancePct: 0,
    boqItems: [
      { id: 'boq-1', 'Scope 1': 'Substation', 'Scope 2': 'Civil', 'BOQ SL No': '14.2', Unit: 'Cum', QTY: 100, 'Budget Price': 100 },
    ],
    workOrders: [
      {
        workOrderNo: 'WO/01', subcontractorName: 'Civil Partner', date: '2026-02-01', status: 'Active',
        totalAmount: 9000,
        items: [{ boqItemId: 'boq-1', orderQty: 90, totalAmount: 9000 }],
      },
    ],
    jmcEntries: [
      {
        jmcNo: 'JMC/01', jmcDate: '2026-07-01', status: 'In Progress',
        items: [{ scope1: 'Substation', scope2: 'Civil', boqSlNo: '14.2', rate: 100, executedQty: 50, certifiedQty: 40 }],
      },
    ],
    subcontractorBills: [
      // Billed 45 against only 40 certified — the ladder must flag this line as critical.
      { billNo: 'B/1', billDate: '2026-07-20', status: 'Completed', totalAmount: 4500, items: [{ boqItemId: 'boq-1', billedQty: 45 }] },
    ],
  });

  // Cost: WO commitment joins PO commitment (which is zero here).
  assert.equal(summary.cost.workOrderCommittedValue, 9000);
  assert.equal(summary.cost.committedValue, 9000);
  assert.equal(summary.procurement.committedValue, 0);
  // Civil block totals.
  assert.equal(summary.civil.workOrderCount, 1);
  assert.equal(summary.civil.executedValue, 5000);
  assert.equal(summary.civil.certifiedValue, 4000);
  assert.equal(summary.civil.measurementEntryCount, 1);
  assert.equal(summary.civil.openMeasurementCount, 1);
  assert.equal(summary.civil.subcontractorBilledValue, 4500);
  // Stall: the JMC entry has been In Progress since 1 Jul — 46 days, past the default threshold.
  assert.equal(summary.stalledGates.some((gate) => gate.key === 'jmc-certification'), true);
  // Ladder: sub-billed 45 > certified 40 → critical on the civil line.
  assert.equal(summary.quantityIntegrity.criticalCount, 1);
});

/* ---- JMC host contract — the Project Management copies of the Billing Recon JMC screens ---- */

test('JMC links carry the project mapping id and resolve to the Civil workspace', async () => {
  const { projectManagementJmcContext } = await import('../src/lib/jmc-module.ts');
  const context = projectManagementJmcContext('map-1', 'global-1');

  assert.equal(context.jmcHref(), '/project-management/jmc?project=map-1');
  assert.equal(context.jmcHref('entry'), '/project-management/jmc/entry?project=map-1');
  assert.equal(context.jmcHref('stage/3'), '/project-management/jmc/stage/3?project=map-1');
  assert.equal(
    context.jmcHref('settings/workflow-configuration'),
    '/project-management/jmc/settings/workflow-configuration?project=map-1',
  );
  // Back out of JMC lands on the Civil execution workspace that owns this lane.
  assert.equal(context.parentHref, '/project-management/civil?project=map-1');
  assert.equal(context.permissionResource, 'Project Management.JMC');
  assert.equal(context.activityModule, 'Project Management');
});

test('JMC context resolves by mapped global project, and stays inert without a mapping', async () => {
  const { projectManagementJmcContext } = await import('../src/lib/jmc-module.ts');
  const projects = [{ id: 'global-1', projectName: 'A' }, { id: 'global-2', projectName: 'B' }];

  assert.equal(projectManagementJmcContext('map-1', 'global-2').resolveProject(projects).id, 'global-2');

  // Unknown or unresolved mapping must never silently fall back to another project, and its links
  // must render as disabled rather than pointing at a project-less route.
  const unresolved = projectManagementJmcContext('map-1', '');
  assert.equal(unresolved.resolveProject(projects), null);
  const noMapping = projectManagementJmcContext('', '');
  assert.equal(noMapping.jmcHref('entry'), '#');
  assert.equal(noMapping.parentHref, '#');
});

test('JMC numbering stays on Billing Recon rules so the two hosts share one sequence', async () => {
  const { jmcSerialConfigId, jmcSlugify } = await import('../src/lib/jmc-module.ts');
  // scope2 precedes scope1 — matching the billingReconSerialConfigs documents already in use.
  assert.equal(jmcSerialConfigId('proj-1', 'Substation', 'Civil Works'), 'proj-1_civil-works_substation');
  // Deliberately untrimmed: the live URLs and stored config ids were built without a trim, so
  // adding one would stop matching existing documents.
  assert.equal(jmcSlugify(' Acme Corp '), '-acme-corp-');
  assert.equal(jmcSlugify('220kV Substation / Pkg-3'), '220kv-substation--pkg-3');
});

/* ---------------- Survey approval workflow ---------------- */

test('a survey advances one stage per approval and only certifies at the last one', async () => {
  const { nextSurveyState, initialSurveyState } = await import(
    '../src/lib/project-management-survey-workflow.ts'
  );
  const steps = [
    { id: '1', name: 'Verification' },
    { id: '2', name: 'Certification' },
  ];

  const start = initialSurveyState(steps);
  assert.equal(start.status, 'Pending');
  assert.equal(start.currentStepIndex, 0);
  // Recording must never write straight through when a workflow exists.
  assert.equal(start.applyToBoq, false);

  const afterFirst = nextSurveyState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'In Progress');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.currentStepName, 'Certification');
  assert.equal(afterFirst.applyToBoq, false);

  const afterLast = nextSurveyState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // Approving the final stage is the single point at which the BOQ item is written.
  assert.equal(afterLast.applyToBoq, true);
});

test('rejection closes a survey and correction returns it to the surveyor, neither applying it', async () => {
  const { nextSurveyState } = await import('../src/lib/project-management-survey-workflow.ts');
  const steps = [{ id: '1', name: 'Verification' }, { id: '2', name: 'Certification' }];

  const rejected = nextSurveyState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.currentStepIndex, -1);
  assert.equal(rejected.applyToBoq, false);

  // Correction re-enters at the first stage rather than resuming mid-workflow, so a changed
  // quantity is re-verified from the top.
  const correction = nextSurveyState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Needs Correction');
  assert.equal(correction.currentStepIndex, 0);
  assert.equal(correction.currentStepName, 'Verification');
  assert.equal(correction.applyToBoq, false);
});

test('with no stages configured a survey applies immediately, preserving pre-workflow behaviour', async () => {
  const { initialSurveyState } = await import('../src/lib/project-management-survey-workflow.ts');
  const start = initialSurveyState([]);
  assert.equal(start.status, 'Approved');
  assert.equal(start.applyToBoq, true);
});

test('only the assignees of an open survey entry may act on it', async () => {
  const { canActOnSurveyEntry } = await import('../src/lib/project-management-survey-workflow.ts');
  const open = { status: 'Pending', assignees: ['u1', 'u2'], currentStepIndex: 0 };

  assert.equal(canActOnSurveyEntry(open, 'u1'), true);
  assert.equal(canActOnSurveyEntry(open, 'u3'), false);
  // A settled entry is nobody's to action, even its former assignee's.
  assert.equal(canActOnSurveyEntry({ ...open, status: 'Approved' }, 'u1'), false);
  assert.equal(canActOnSurveyEntry({ ...open, status: 'Rejected' }, 'u1'), false);
});

test('a stage lists only the open entries currently sitting on it', async () => {
  const { entriesForStep } = await import('../src/lib/project-management-survey-workflow.ts');
  const steps = [{ id: '1', name: 'Verification' }, { id: '2', name: 'Certification' }];
  const entries = [
    { id: 'a', status: 'Pending', currentStepIndex: 0 },
    { id: 'b', status: 'In Progress', currentStepIndex: 1 },
    // Terminal entries have a stale index and must not resurface on any stage.
    { id: 'c', status: 'Approved', currentStepIndex: 0 },
  ];

  assert.deepEqual(entriesForStep(entries, '1', steps).map((e) => e.id), ['a']);
  assert.deepEqual(entriesForStep(entries, '2', steps).map((e) => e.id), ['b']);
  // A stage removed from the workflow shows nothing rather than throwing.
  assert.deepEqual(entriesForStep(entries, '99', steps), []);
});

test('Survey context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementSurveyContext } = await import(
    '../src/lib/project-management-survey-workflow.ts'
  );
  const context = projectManagementSurveyContext('map-1', 'global-2');
  assert.equal(context.surveyHref(), '/project-management/survey?project=map-1');
  assert.equal(context.surveyHref('record'), '/project-management/survey/record?project=map-1');
  assert.equal(context.surveyHref('stage/2'), '/project-management/survey/stage/2?project=map-1');
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementSurveyContext('', '');
  assert.equal(noMapping.surveyHref('record'), '#');
  assert.equal(noMapping.parentHref, '#');
});

/* ---------------- Indent approval workflow ---------------- */

test('only approved indents reserve BOQ quantity, and legacy ones are grandfathered', async () => {
  const { indentReservesQuantity, isLegacyIndent } = await import(
    '../src/lib/project-management-indent-workflow.ts'
  );

  // Raised before the workflow existed: no marker, so it keeps the reservation it always had.
  // This is what makes the change migration-free.
  const legacy = { status: 'Draft' };
  assert.equal(indentReservesQuantity(legacy), true);
  assert.equal(isLegacyIndent(legacy), true);

  // Workflow-aware indents only reserve once approved.
  assert.equal(indentReservesQuantity({ status: 'Draft', workflowEnrolled: true }), false);
  assert.equal(indentReservesQuantity({ status: 'Submitted', workflowEnrolled: true }), false);
  assert.equal(indentReservesQuantity({ status: 'Approved', workflowEnrolled: true }), true);

  // Rejected/Cancelled never reserve, workflow or not.
  assert.equal(indentReservesQuantity({ status: 'Rejected' }), false);
  assert.equal(indentReservesQuantity({ status: 'Cancelled' }), false);
  assert.equal(indentReservesQuantity({ status: 'Rejected', workflowEnrolled: true }), false);
});

test('submitting an indent routes it, and approving the last stage grants the reservation', async () => {
  const { submitIndentState, nextIndentState } = await import(
    '../src/lib/project-management-indent-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Review' }, { id: '2', name: 'Approval' }];

  const submitted = submitIndentState(steps);
  assert.equal(submitted.status, 'Submitted');
  assert.equal(submitted.currentStepIndex, 0);
  assert.equal(submitted.reservesOnCommit, false);

  const afterFirst = nextIndentState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'Submitted');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.reservesOnCommit, false);

  const afterLast = nextIndentState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // Only the final approval turns an indent into one that consumes BOQ quantity.
  assert.equal(afterLast.reservesOnCommit, true);
});

test('rejecting closes an indent and Needs Correction returns it to an editable draft', async () => {
  const { nextIndentState, indentReservesQuantity } = await import(
    '../src/lib/project-management-indent-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Review' }, { id: '2', name: 'Approval' }];

  const rejected = nextIndentState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.reservesOnCommit, false);

  // Correction hands it back as a Draft rather than parking it mid-workflow, so the raiser can
  // edit quantities and resubmit.
  const correction = nextIndentState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Draft');
  assert.equal(correction.currentStepIndex, -1);
  assert.equal(correction.reservesOnCommit, false);
  // And a corrected draft must not reserve while it sits with the raiser.
  assert.equal(indentReservesQuantity({ status: 'Draft', workflowEnrolled: true }), false);
});

test('with no stages configured, submitting an indent approves it outright', async () => {
  const { submitIndentState } = await import('../src/lib/project-management-indent-workflow.ts');
  const submitted = submitIndentState([]);
  assert.equal(submitted.status, 'Approved');
  assert.equal(submitted.reservesOnCommit, true);
});

test('an indent stage lists only submitted, workflow-aware indents sitting on it', async () => {
  const { indentsForStep, canActOnIndent } = await import(
    '../src/lib/project-management-indent-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Review' }, { id: '2', name: 'Approval' }];
  const indents = [
    { id: 'a', status: 'Submitted', workflowEnrolled: true, currentStepIndex: 0 },
    { id: 'b', status: 'Submitted', workflowEnrolled: true, currentStepIndex: 1 },
    // A legacy Draft carries no step index and must never surface as a review backlog.
    { id: 'c', status: 'Draft', currentStepIndex: 0 },
    { id: 'd', status: 'Approved', workflowEnrolled: true, currentStepIndex: 0 },
  ];

  assert.deepEqual(indentsForStep(indents, '1', steps).map((i) => i.id), ['a']);
  assert.deepEqual(indentsForStep(indents, '2', steps).map((i) => i.id), ['b']);
  assert.deepEqual(indentsForStep(indents, '99', steps), []);

  // A draft is nobody's to action even if it somehow carries assignees.
  assert.equal(canActOnIndent({ status: 'Draft', assignees: ['u1'] }, 'u1'), false);
  assert.equal(canActOnIndent({ status: 'Submitted', assignees: ['u1'] }, 'u1'), true);
  assert.equal(canActOnIndent({ status: 'Submitted', assignees: ['u1'] }, 'u2'), false);
  assert.equal(canActOnIndent({ status: 'Approved', assignees: ['u1'] }, 'u1'), false);
});

test('Indent context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementIndentContext } = await import(
    '../src/lib/project-management-indent-workflow.ts'
  );
  const context = projectManagementIndentContext('map-1', 'global-2');
  assert.equal(context.indentHref(), '/project-management/indent?project=map-1');
  assert.equal(context.indentHref('register'), '/project-management/indent/register?project=map-1');
  assert.equal(context.indentHref('stage/2'), '/project-management/indent/stage/2?project=map-1');
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementIndentContext('', '');
  assert.equal(noMapping.indentHref('register'), '#');
  assert.equal(noMapping.parentHref, '#');
});

/* ---------------- RFQ award approval workflow ---------------- */

test('award approval is required only for workflow-aware RFQs with stages configured', async () => {
  const { rfqAwardRequiresApproval, isLegacyRfq } = await import(
    '../src/lib/project-management-rfq-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Award Review' }];

  // Raised before the workflow existed: awards straight to a PO, so nothing mid-negotiation
  // stalls when the feature is switched on.
  const legacy = { status: 'Sent' };
  assert.equal(rfqAwardRequiresApproval(legacy, steps), false);
  assert.equal(isLegacyRfq(legacy), true);

  assert.equal(rfqAwardRequiresApproval({ status: 'Sent', workflowEnrolled: true }, steps), true);
  // A project that never configured stages keeps awarding directly.
  assert.equal(rfqAwardRequiresApproval({ status: 'Sent', workflowEnrolled: true }, []), false);
});

test('an award advances one stage per approval and only raises the PO at the last one', async () => {
  const { initialRfqAwardState, nextRfqAwardState } = await import(
    '../src/lib/project-management-rfq-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Award Review' }, { id: '2', name: 'Award Approval' }];

  const start = initialRfqAwardState(steps);
  assert.equal(start.status, 'Pending');
  assert.equal(start.currentStepIndex, 0);
  assert.equal(start.createsPurchaseOrder, false);

  const afterFirst = nextRfqAwardState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'In Progress');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.createsPurchaseOrder, false);

  const afterLast = nextRfqAwardState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // The PO is created exactly once, at the final approval.
  assert.equal(afterLast.createsPurchaseOrder, true);
});

test('rejecting or returning an award never raises a purchase order', async () => {
  const { nextRfqAwardState, initialRfqAwardState } = await import(
    '../src/lib/project-management-rfq-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Award Review' }, { id: '2', name: 'Award Approval' }];

  const rejected = nextRfqAwardState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.createsPurchaseOrder, false);

  const correction = nextRfqAwardState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Needs Correction');
  assert.equal(correction.currentStepIndex, 0);
  assert.equal(correction.createsPurchaseOrder, false);

  // No stages configured means the request is born approved and raises the PO itself.
  assert.equal(initialRfqAwardState([]).createsPurchaseOrder, true);
});

test('award premium reports whether the recommended vendor was the cheapest', async () => {
  const { awardPremium } = await import('../src/lib/project-management-rfq-workflow.ts');

  assert.deepEqual(awardPremium(100, 100), { isLowest: true, premium: 0, premiumPct: 0 });
  const above = awardPremium(110, 100);
  assert.equal(above.isLowest, false);
  assert.equal(above.premium, 10);
  assert.equal(Math.round(above.premiumPct), 10);
  // Awarding below the recorded lowest still counts as lowest rather than a negative premium.
  assert.equal(awardPremium(90, 100).isLowest, true);
  // With no comparison available, don't imply the award was overpriced.
  assert.deepEqual(awardPremium(100, undefined), { isLowest: true, premium: 0, premiumPct: 0 });
  assert.deepEqual(awardPremium(100, 0), { isLowest: true, premium: 0, premiumPct: 0 });
});

test('only assignees of an open award request may act, and stages list only their own', async () => {
  const { canActOnRfqAward, rfqAwardsForStep } = await import(
    '../src/lib/project-management-rfq-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Award Review' }, { id: '2', name: 'Award Approval' }];

  assert.equal(canActOnRfqAward({ status: 'Pending', assignees: ['u1'] }, 'u1'), true);
  assert.equal(canActOnRfqAward({ status: 'Pending', assignees: ['u1'] }, 'u2'), false);
  assert.equal(canActOnRfqAward({ status: 'Approved', assignees: ['u1'] }, 'u1'), false);

  const approvals = [
    { id: 'a', status: 'Pending', currentStepIndex: 0 },
    { id: 'b', status: 'In Progress', currentStepIndex: 1 },
    { id: 'c', status: 'Approved', currentStepIndex: 0 },
  ];
  assert.deepEqual(rfqAwardsForStep(approvals, '1', steps).map((a) => a.id), ['a']);
  assert.deepEqual(rfqAwardsForStep(approvals, '2', steps).map((a) => a.id), ['b']);
  assert.deepEqual(rfqAwardsForStep(approvals, '99', steps), []);
});

test('RFQ context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementRfqContext } = await import(
    '../src/lib/project-management-rfq-workflow.ts'
  );
  const context = projectManagementRfqContext('map-1', 'global-2');
  assert.equal(context.rfqHref(), '/project-management/rfq?project=map-1');
  assert.equal(context.rfqHref('register'), '/project-management/rfq/register?project=map-1');
  assert.equal(context.rfqHref('stage/2'), '/project-management/rfq/stage/2?project=map-1');
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementRfqContext('', '');
  assert.equal(noMapping.rfqHref('register'), '#');
  assert.equal(noMapping.parentHref, '#');
});

/* ---------------- PO issue approval workflow ---------------- */

test('issue approval is required only for workflow-aware POs with stages configured', async () => {
  const { poIssueRequiresApproval, isLegacyPo } = await import(
    '../src/lib/project-management-po-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Commercial Review' }];

  // Raised before the workflow existed: issues directly, so nothing already in flight stalls.
  const legacy = { status: 'Draft' };
  assert.equal(poIssueRequiresApproval(legacy, steps), false);
  assert.equal(isLegacyPo(legacy), true);

  assert.equal(poIssueRequiresApproval({ status: 'Draft', workflowEnrolled: true }, steps), true);
  // A project that never configured stages keeps issuing directly.
  assert.equal(poIssueRequiresApproval({ status: 'Draft', workflowEnrolled: true }, []), false);
});

test('an issue request advances one stage per approval and only issues at the last one', async () => {
  const { initialPoIssueState, nextPoIssueState } = await import(
    '../src/lib/project-management-po-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Commercial Review' }, { id: '2', name: 'Issue Approval' }];

  const start = initialPoIssueState(steps);
  assert.equal(start.status, 'Pending');
  assert.equal(start.currentStepIndex, 0);
  assert.equal(start.issuesPurchaseOrder, false);

  const afterFirst = nextPoIssueState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'In Progress');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.issuesPurchaseOrder, false);

  const afterLast = nextPoIssueState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // Issuing is the commitment point, and happens exactly once at the final approval.
  assert.equal(afterLast.issuesPurchaseOrder, true);
});

test('rejecting or returning an issue request never issues the PO', async () => {
  const { nextPoIssueState, initialPoIssueState } = await import(
    '../src/lib/project-management-po-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Commercial Review' }, { id: '2', name: 'Issue Approval' }];

  const rejected = nextPoIssueState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.issuesPurchaseOrder, false);

  const correction = nextPoIssueState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Needs Correction');
  assert.equal(correction.currentStepIndex, 0);
  assert.equal(correction.issuesPurchaseOrder, false);

  // No stages configured means the request is born approved and issues the PO itself.
  assert.equal(initialPoIssueState([]).issuesPurchaseOrder, true);
});

test('an open issue request is found per PO so Issue is not offered twice', async () => {
  const { openIssueRequestForPo, poIssuesForStep, canActOnPoIssue } = await import(
    '../src/lib/project-management-po-workflow.ts'
  );
  const approvals = [
    { id: 'r1', poId: 'po-1', status: 'Pending', currentStepIndex: 0 },
    { id: 'r2', poId: 'po-2', status: 'In Progress', currentStepIndex: 1 },
    // A settled request must not block a fresh submission on the same PO.
    { id: 'r3', poId: 'po-3', status: 'Rejected', currentStepIndex: -1 },
  ];

  assert.equal(openIssueRequestForPo(approvals, 'po-1').id, 'r1');
  assert.equal(openIssueRequestForPo(approvals, 'po-3'), null);
  assert.equal(openIssueRequestForPo(approvals, 'po-unknown'), null);

  const steps = [{ id: '1', name: 'Commercial Review' }, { id: '2', name: 'Issue Approval' }];
  assert.deepEqual(poIssuesForStep(approvals, '1', steps).map((a) => a.id), ['r1']);
  assert.deepEqual(poIssuesForStep(approvals, '2', steps).map((a) => a.id), ['r2']);

  assert.equal(canActOnPoIssue({ status: 'Pending', assignees: ['u1'] }, 'u1'), true);
  assert.equal(canActOnPoIssue({ status: 'Pending', assignees: ['u1'] }, 'u2'), false);
  assert.equal(canActOnPoIssue({ status: 'Approved', assignees: ['u1'] }, 'u1'), false);
});

test('PO context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementPoContext } = await import(
    '../src/lib/project-management-po-workflow.ts'
  );
  const context = projectManagementPoContext('map-1', 'global-2');
  assert.equal(context.poHref(), '/project-management/purchase-orders?project=map-1');
  assert.equal(
    context.poHref('register'),
    '/project-management/purchase-orders/register?project=map-1',
  );
  assert.equal(
    context.poHref('stage/2'),
    '/project-management/purchase-orders/stage/2?project=map-1',
  );
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementPoContext('', '');
  assert.equal(noMapping.poHref('register'), '#');
  assert.equal(noMapping.parentHref, '#');
});

/* ---------------- Manufacturing clearance approval workflow ---------------- */

test('clearance approval is required only when stages are configured', async () => {
  const { mcClearanceRequiresApproval } = await import(
    '../src/lib/project-management-mc-workflow.ts'
  );
  // Needs no legacy marker: the meaning of an existing "Cleared" record is unchanged, so only new
  // clearance decisions route. A project that never configures stages clears directly.
  assert.equal(mcClearanceRequiresApproval([]), false);
  assert.equal(mcClearanceRequiresApproval([{ id: '1', name: 'Technical Review' }]), true);
});

test('a clearance advances one stage per approval and only opens the gate at the last one', async () => {
  const { initialMcApprovalState, nextMcApprovalState } = await import(
    '../src/lib/project-management-mc-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Technical Review' }, { id: '2', name: 'Clearance Approval' }];

  const start = initialMcApprovalState(steps);
  assert.equal(start.status, 'Pending');
  assert.equal(start.currentStepIndex, 0);
  // The MC record must stay Pending until the workflow says otherwise.
  assert.equal(start.clearsManufacturing, false);

  const afterFirst = nextMcApprovalState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'In Progress');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.clearsManufacturing, false);

  const afterLast = nextMcApprovalState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // Opening the gate happens exactly once, at the final approval.
  assert.equal(afterLast.clearsManufacturing, true);
});

test('rejecting or returning a clearance request never opens the gate', async () => {
  const { nextMcApprovalState, initialMcApprovalState } = await import(
    '../src/lib/project-management-mc-workflow.ts'
  );
  const steps = [{ id: '1', name: 'Technical Review' }, { id: '2', name: 'Clearance Approval' }];

  const rejected = nextMcApprovalState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.clearsManufacturing, false);

  const correction = nextMcApprovalState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Needs Correction');
  assert.equal(correction.currentStepIndex, 0);
  assert.equal(correction.clearsManufacturing, false);

  // No stages configured means the request is born approved and clears the gate itself.
  assert.equal(initialMcApprovalState([]).clearsManufacturing, true);
});

test('an open clearance request is found per BOQ item so Clear is not offered twice', async () => {
  const { openMcRequestForBoqItem, mcApprovalsForStep, canActOnMcApproval } = await import(
    '../src/lib/project-management-mc-workflow.ts'
  );
  const approvals = [
    { id: 'a1', boqItemId: 'b1', status: 'Pending', currentStepIndex: 0 },
    { id: 'a2', boqItemId: 'b2', status: 'In Progress', currentStepIndex: 1 },
    // A settled request must not block a fresh attempt on the same item.
    { id: 'a3', boqItemId: 'b3', status: 'Rejected', currentStepIndex: -1 },
  ];

  assert.equal(openMcRequestForBoqItem(approvals, 'b1').id, 'a1');
  assert.equal(openMcRequestForBoqItem(approvals, 'b3'), null);
  assert.equal(openMcRequestForBoqItem(approvals, 'unknown'), null);

  const steps = [{ id: '1', name: 'Technical Review' }, { id: '2', name: 'Clearance Approval' }];
  assert.deepEqual(mcApprovalsForStep(approvals, '1', steps).map((a) => a.id), ['a1']);
  assert.deepEqual(mcApprovalsForStep(approvals, '2', steps).map((a) => a.id), ['a2']);
  assert.deepEqual(mcApprovalsForStep(approvals, '99', steps), []);

  assert.equal(canActOnMcApproval({ status: 'Pending', assignees: ['u1'] }, 'u1'), true);
  assert.equal(canActOnMcApproval({ status: 'Pending', assignees: ['u1'] }, 'u2'), false);
  assert.equal(canActOnMcApproval({ status: 'Approved', assignees: ['u1'] }, 'u1'), false);
});

test('MC context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementMcContext } = await import(
    '../src/lib/project-management-mc-workflow.ts'
  );
  const context = projectManagementMcContext('map-1', 'global-2');
  assert.equal(context.mcHref(), '/project-management/manufacturing-clearance?project=map-1');
  assert.equal(
    context.mcHref('register'),
    '/project-management/manufacturing-clearance/register?project=map-1',
  );
  assert.equal(
    context.mcHref('stage/2'),
    '/project-management/manufacturing-clearance/stage/2?project=map-1',
  );
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementMcContext('', '');
  assert.equal(noMapping.mcHref('register'), '#');
  assert.equal(noMapping.parentHref, '#');
});

/* ---------------- Inspection result approval workflow ---------------- */

test('only passing inspection results route, and only when stages are configured', async () => {
  const { inspectionResultRequiresApproval, inspectionResultIsRouted } = await import(
    '../src/lib/project-management-inspection-workflow.ts'
  );
  const steps = [{ id: '1', name: 'QA Review' }];

  // Passing is what opens the MDCC gate, so those are the results that need review.
  assert.equal(inspectionResultIsRouted('Passed'), true);
  assert.equal(inspectionResultIsRouted('Passed with Punch Items'), true);
  // A failure holds the gate shut and must stay immediate — it also keeps the re-inspection loop
  // (Failed -> Request again) working.
  assert.equal(inspectionResultIsRouted('Failed'), false);

  assert.equal(inspectionResultRequiresApproval('Passed', steps), true);
  assert.equal(inspectionResultRequiresApproval('Failed', steps), false);
  // A project that never configured stages records directly.
  assert.equal(inspectionResultRequiresApproval('Passed', []), false);
});

test('a result advances one stage per approval and only records at the last one', async () => {
  const { initialInspectionApprovalState, nextInspectionApprovalState } = await import(
    '../src/lib/project-management-inspection-workflow.ts'
  );
  const steps = [{ id: '1', name: 'QA Review' }, { id: '2', name: 'Result Approval' }];

  const start = initialInspectionApprovalState(steps);
  assert.equal(start.status, 'Pending');
  assert.equal(start.currentStepIndex, 0);
  assert.equal(start.recordsResult, false);

  const afterFirst = nextInspectionApprovalState('Approve', 0, steps);
  assert.equal(afterFirst.status, 'In Progress');
  assert.equal(afterFirst.currentStepIndex, 1);
  assert.equal(afterFirst.recordsResult, false);

  const afterLast = nextInspectionApprovalState('Approve', 1, steps);
  assert.equal(afterLast.status, 'Approved');
  assert.equal(afterLast.currentStepIndex, -1);
  // Recording the result is what opens MDCC, and happens exactly once.
  assert.equal(afterLast.recordsResult, true);

  assert.equal(initialInspectionApprovalState([]).recordsResult, true);
});

test('rejecting a result request refuses it without recording a failure', async () => {
  const { nextInspectionApprovalState } = await import(
    '../src/lib/project-management-inspection-workflow.ts'
  );
  const steps = [{ id: '1', name: 'QA Review' }, { id: '2', name: 'Result Approval' }];

  const rejected = nextInspectionApprovalState('Reject', 1, steps);
  assert.equal(rejected.status, 'Rejected');
  // Crucially not a recorded result: a failure is a substantive finding only an inspector records.
  assert.equal(rejected.recordsResult, false);

  const correction = nextInspectionApprovalState('Needs Correction', 1, steps);
  assert.equal(correction.status, 'Needs Correction');
  assert.equal(correction.currentStepIndex, 0);
  assert.equal(correction.recordsResult, false);
});

test('result concerns call out rejected quantity and punch items that would block MDCC', async () => {
  const { inspectionResultConcerns } = await import(
    '../src/lib/project-management-inspection-workflow.ts'
  );

  assert.deepEqual(
    inspectionResultConcerns({ result: 'Passed', qtyRejected: 0, punchItems: [] }),
    [],
  );

  const rejectedOnly = inspectionResultConcerns({
    result: 'Passed',
    qtyRejected: 3,
    punchItems: [],
  });
  assert.equal(rejectedOnly.length, 1);
  assert.match(rejectedOnly[0], /3 unit\(s\) rejected/);

  // Critical/Major open punch is what hasOpenBlockingPunch treats as blocking MDCC; Minor is not.
  const blocking = inspectionResultConcerns({
    result: 'Passed with Punch Items',
    qtyRejected: 0,
    punchItems: [
      { punchId: 'p1', description: 'x', severity: 'Critical', closed: false },
      { punchId: 'p2', description: 'y', severity: 'Minor', closed: false },
      { punchId: 'p3', description: 'z', severity: 'Major', closed: true },
    ],
  });
  assert.match(blocking.join(' | '), /1 open punch item that will block MDCC/);
  assert.match(blocking.join(' | '), /1 open minor punch item/);

  // A closed blocking punch is not a concern.
  assert.deepEqual(
    inspectionResultConcerns({
      result: 'Passed with Punch Items',
      qtyRejected: 0,
      punchItems: [{ punchId: 'p1', description: 'x', severity: 'Critical', closed: true }],
    }),
    [],
  );
});

test('an open result request is found per BOQ item so recording is not offered twice', async () => {
  const { openInspectionRequestForBoqItem, inspectionApprovalsForStep, canActOnInspectionApproval } =
    await import('../src/lib/project-management-inspection-workflow.ts');
  const approvals = [
    { id: 'r1', boqItemId: 'b1', status: 'Pending', currentStepIndex: 0 },
    { id: 'r2', boqItemId: 'b2', status: 'In Progress', currentStepIndex: 1 },
    { id: 'r3', boqItemId: 'b3', status: 'Rejected', currentStepIndex: -1 },
  ];

  assert.equal(openInspectionRequestForBoqItem(approvals, 'b1').id, 'r1');
  // A refused request must not block re-recording once the inspector reworks it.
  assert.equal(openInspectionRequestForBoqItem(approvals, 'b3'), null);

  const steps = [{ id: '1', name: 'QA Review' }, { id: '2', name: 'Result Approval' }];
  assert.deepEqual(inspectionApprovalsForStep(approvals, '1', steps).map((a) => a.id), ['r1']);
  assert.deepEqual(inspectionApprovalsForStep(approvals, '99', steps), []);

  assert.equal(canActOnInspectionApproval({ status: 'Pending', assignees: ['u1'] }, 'u1'), true);
  assert.equal(canActOnInspectionApproval({ status: 'Pending', assignees: ['u1'] }, 'u2'), false);
  assert.equal(canActOnInspectionApproval({ status: 'Approved', assignees: ['u1'] }, 'u1'), false);
});

test('Inspection context carries the project handle and stays inert without a mapping', async () => {
  const { projectManagementInspectionContext } = await import(
    '../src/lib/project-management-inspection-workflow.ts'
  );
  const context = projectManagementInspectionContext('map-1', 'global-2');
  assert.equal(context.inspectionHref(), '/project-management/inspections?project=map-1');
  assert.equal(
    context.inspectionHref('register'),
    '/project-management/inspections/register?project=map-1',
  );
  assert.equal(
    context.inspectionHref('stage/2'),
    '/project-management/inspections/stage/2?project=map-1',
  );
  assert.equal(context.parentHref, '/project-management/supply?project=map-1');

  const noMapping = projectManagementInspectionContext('', '');
  assert.equal(noMapping.inspectionHref('register'), '#');
  assert.equal(noMapping.parentHref, '#');
});
