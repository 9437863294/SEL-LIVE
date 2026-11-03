import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_WIDE_SCOPE,
  belongsToProjectTrail,
  billAuditSnapshot,
  canExportSubcontractorAudit,
  canViewSubcontractorAudit,
  contactsSummary,
  maskAccountNumber,
  subcontractorAuditDetails,
  subcontractorAuditSnapshot,
} from '../src/lib/subcontractors-audit-scope.ts';

const alpha = { id: 'p-alpha', projectName: 'Alpha Tower' };
const beta = { id: 'p-beta', projectName: 'Beta Bridge' };

test('a project entry is written with its project, first', () => {
  const details = subcontractorAuditDetails({ id: 'p-alpha', name: 'Alpha Tower' }, { billNo: 'B-1' });
  assert.deepEqual(Object.keys(details), ['projectId', 'projectName', 'billNo']);
  assert.equal(details.projectId, 'p-alpha');
  assert.equal(details.scope, undefined);
});

test('a module-wide entry is marked as applying to every project', () => {
  const details = subcontractorAuditDetails(null, { legalName: 'ACME' });
  assert.equal(details.scope, MODULE_WIDE_SCOPE);
  assert.equal(details.projectId, undefined);
  // A project with no id is not a project.
  assert.equal(subcontractorAuditDetails({ id: '', name: 'x' }).scope, MODULE_WIDE_SCOPE);
});

test('undefined values are dropped (Firestore rejects them)', () => {
  const details = subcontractorAuditDetails({ id: 'p-alpha', name: undefined }, { a: undefined, b: 0, c: null, d: '' });
  assert.deepEqual(details, { projectId: 'p-alpha', b: 0, c: null, d: '' });
});

test("a project's trail holds its own entries and never another project's", () => {
  const entry = { details: subcontractorAuditDetails({ id: 'p-alpha', name: 'Alpha Tower' }, { billNo: 'B-1' }) };
  assert.equal(belongsToProjectTrail(entry, alpha), true);
  assert.equal(belongsToProjectTrail(entry, beta), false);
});

test('module-wide entries appear in every project trail', () => {
  const entry = { details: subcontractorAuditDetails(null, { legalName: 'ACME' }) };
  assert.equal(belongsToProjectTrail(entry, alpha), true);
  assert.equal(belongsToProjectTrail(entry, beta), true);
  // Rows written before this (the old billing-workflow log) have no project either.
  assert.equal(belongsToProjectTrail({ details: { stepCount: 3 } }, beta), true);
  assert.equal(belongsToProjectTrail({ details: null }, beta), true);
  assert.equal(belongsToProjectTrail({}, beta), true);
});

test('older entries that carried only the URL slug match by slug', () => {
  const legacy = { details: { project: 'alpha-tower', jmcNo: 'JMC-1' } };
  assert.equal(belongsToProjectTrail(legacy, alpha), true);
  assert.equal(belongsToProjectTrail(legacy, beta), false);
});

test('a project id wins over a slug that says otherwise', () => {
  const entry = { details: { projectId: 'p-beta', project: 'alpha-tower' } };
  assert.equal(belongsToProjectTrail(entry, alpha), false);
  assert.equal(belongsToProjectTrail(entry, beta), true);
});

test('account numbers keep only their last four digits', () => {
  assert.equal(maskAccountNumber('123456789012'), '••••••9012');
  assert.equal(maskAccountNumber('12 34 56'), '••3456');
  assert.equal(maskAccountNumber('1234'), '1234');
  assert.equal(maskAccountNumber(''), '');
  assert.equal(maskAccountNumber(undefined), '');
});

test('contacts read as one line', () => {
  assert.equal(
    contactsSummary([
      { type: 'Project', name: 'Ravi', mobile: '98765', email: '' },
      { type: 'Billing', name: '', mobile: '', email: '' },
      { type: 'Accounts', name: 'Meena', mobile: '', email: 'm@x.in' },
    ]),
    'Project: Ravi, 98765; Accounts: Meena, m@x.in',
  );
  assert.equal(contactsSummary(undefined), '');
});

test('a subcontractor snapshot masks the account and flattens contacts', () => {
  const snap = subcontractorAuditSnapshot({
    legalName: 'ACME',
    accountNumber: '000011112222',
    contacts: [{ type: 'Project', name: 'Ravi', mobile: '1', email: '' }],
  });
  assert.equal(snap.accountNumber, '••••••2222');
  assert.equal(snap.contacts, 'Project: Ravi, 1');
  assert.equal(snap.gstNumber, '');
  assert.equal(subcontractorAuditSnapshot(null).legalName, '');
});

test('a bill snapshot keys each line by BOQ SL No and rounds figures', () => {
  const snap = billAuditSnapshot({
    billNo: 'B-7',
    items: [{ boqSlNo: '1.2', billedQty: '10.005' }, { billedQty: 3 }],
    subtotal: 1000.004,
    advanceDeductions: [{ amount: 100 }, { amount: 50.5 }],
    netPayable: 849.5,
  });
  assert.equal(snap['Billed qty · 1.2'], 10.01);
  assert.equal(snap['Billed qty · line 2'], 3);
  assert.equal(snap.lineCount, 2);
  assert.equal(snap.subtotal, 1000);
  assert.equal(snap.advanceDeduction, 150.5);
  assert.equal(snap.netPayable, 849.5);
  assert.equal(billAuditSnapshot(undefined).lineCount, 0);
});

/** A `can` that holds exactly these "action|resource|scope" grants (scope optional). */
const canWith = (...grants) => (action, resource, scope) =>
  grants.includes(`${action}|${resource}|${scope ?? ''}`) || grants.includes(`${action}|${resource}|*`);

test('the audit log opens on its own right, scoped to the project', () => {
  const can = canWith('View|Subcontractors Management.Audit Log|p-alpha');
  assert.equal(canViewSubcontractorAudit(can, 'p-alpha'), true);
  assert.equal(canViewSubcontractorAudit(can, 'p-beta'), false);
  // A project-scoped grant does not open the all-projects page.
  assert.equal(canViewSubcontractorAudit(can), false);
});

test('module settings administrators and global auditors see it before anyone holds the new right', () => {
  assert.equal(canViewSubcontractorAudit(canWith('View Settings|Subcontractors Management.Billing|'), 'p-alpha'), true);
  assert.equal(canViewSubcontractorAudit(canWith('View Settings|Subcontractors Management.Billing|')), true);
  assert.equal(canViewSubcontractorAudit(canWith('View|Settings.Audit Logs|')), true);
  assert.equal(canViewSubcontractorAudit(canWith('View|Subcontractors Management.Billing|*'), 'p-alpha'), false);
  assert.equal(canViewSubcontractorAudit(canWith()), false);
});

test('export needs Export, Edit Settings or a global auditor — not View Settings alone', () => {
  assert.equal(canExportSubcontractorAudit(canWith('View Settings|Subcontractors Management.Billing|'), 'p-alpha'), false);
  assert.equal(canExportSubcontractorAudit(canWith('Edit Settings|Subcontractors Management.Billing|'), 'p-alpha'), true);
  assert.equal(canExportSubcontractorAudit(canWith('Export|Subcontractors Management.Audit Log|p-alpha'), 'p-alpha'), true);
  assert.equal(canExportSubcontractorAudit(canWith('View|Settings.Audit Logs|')), true);
});
