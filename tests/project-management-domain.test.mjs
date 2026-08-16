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
