import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ATTRIBUTION,
  EMPTY_MAPS,
  checkTreatment,
  duplicateStates,
  flagTotal,
  gstTypeFor,
  isValidTan,
  registrationFromGstin,
  registrationLabel,
  resolveAttribution,
  resolveRegistrationsDoc,
  summariseGst,
  validateRegistrations,
} from '../src/lib/gst-registrations.ts';

/** Two of the company's own registrations: Odisha (21) and Maharashtra (27). */
const ODISHA = { id: 'r-od', gstin: '21AAPFU0939F1Z7', stateCode: '21', stateName: 'Odisha', label: 'Odisha — Bhubaneswar', tan: 'BBNS12345A', active: true };
const MAHA = { id: 'r-mh', gstin: '27AAPFU0939F1ZV', stateCode: '27', stateName: 'Maharashtra', label: 'Maharashtra', tan: 'MUMS54321B', active: true };

const docOf = (patch = {}) =>
  resolveRegistrationsDoc({
    registrations: [ODISHA, MAHA],
    attribution: { ...DEFAULT_ATTRIBUTION, defaultRegistrationId: 'r-od', ...(patch.attribution ?? {}) },
    maps: patch.maps ?? EMPTY_MAPS,
  });

const bill = (patch) => ({
  id: patch.id ?? Math.random().toString(36).slice(2),
  ref: 'SEL/REC/0001',
  dateKey: '2026-09-20',
  partyName: 'Acme',
  supplierGstin: '',
  taxable: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  tds: 0,
  retention: 0,
  other: 0,
  net: 0,
  invoiceNo: 'INV-1',
  invoiceDate: '2026-09-20',
  panNo: 'AAPFU0939F',
  ...patch,
});

test('a GSTIN gives its own state, name and label', () => {
  const made = registrationFromGstin(' 27aapfu0939f1zv ');
  assert.equal(made.gstin, '27AAPFU0939F1ZV');
  assert.equal(made.stateCode, '27');
  assert.equal(made.stateName, 'Maharashtra');
  assert.equal(made.label, 'Maharashtra');
  assert.equal(registrationFromGstin('bad').stateCode, undefined);
  assert.equal(registrationLabel(null), 'Not attributed');
  assert.equal(registrationLabel(ODISHA), 'Odisha — Bhubaneswar');
  assert.equal(isValidTan('bbns12345a'), true);
  assert.equal(isValidTan('BBNS1234A'), false);
});

test('the registration list is checked for bad, repeated and duplicated entries', () => {
  assert.deepEqual(validateRegistrations([ODISHA, MAHA]), {});
  const repeated = validateRegistrations([ODISHA, { ...MAHA, id: 'r-2', gstin: ODISHA.gstin }]);
  assert.match(repeated['r-2'], /already in the list/);
  assert.match(validateRegistrations([{ ...ODISHA, gstin: '21AAPFU0939F1ZZ' }])['r-od'], /last character/);
  assert.match(validateRegistrations([{ ...ODISHA, tan: 'NOPE' }])['r-od'], /TAN/);
  assert.match(validateRegistrations([{ ...ODISHA, active: false }])[''], /at least one/i);
  assert.deepEqual(duplicateStates([ODISHA, { ...ODISHA, id: 'r-2' }]), ['Odisha']);
});

test('the attribution chain is walked in its configured order', () => {
  const maps = { byProject: { 'p-mumbai': 'r-mh' }, byDepartment: { 'd-hr': 'r-od' } };
  const doc = docOf({ maps });
  const at = (input, attribution) =>
    resolveAttribution(input, { ...doc.attribution, ...(attribution ?? {}) }, doc.maps, doc.registrations);

  assert.equal(at({ gstRegistrationId: 'r-mh', projectId: 'p-mumbai' }).source, 'entry', 'the bill wins');
  assert.equal(at({ projectId: 'p-mumbai', departmentId: 'd-hr' }).registrationId, 'r-mh', 'then the project');
  assert.equal(at({ departmentId: 'd-hr' }).registrationId, 'r-od');
  assert.equal(at({}).source, 'default');
  assert.equal(at({}).registrationId, 'r-od');

  // Turning a source off skips it, and reordering changes who wins.
  assert.equal(at({ projectId: 'p-mumbai', departmentId: 'd-hr' }, { enabled: { ...doc.attribution.enabled, project: false } }).registrationId, 'r-od');
  assert.equal(at({ projectId: 'p-mumbai', departmentId: 'd-hr' }, { order: ['department', 'project', 'entry', 'default'] }).registrationId, 'r-od');
  assert.equal(at({ gstRegistrationId: 'r-gone' }).source, 'default', 'a registration no longer in the list is ignored');
  assert.equal(
    at({}, { enabled: { entry: true, project: true, department: true, default: false } }).source,
    'none',
    'with no default a bill can be left unattributed',
  );
});

test('a stored document is read back safely', () => {
  const doc = resolveRegistrationsDoc({ registrations: [{ ...MAHA, active: undefined }], attribution: { order: ['project'], tdsGrouping: 'nonsense' } });
  assert.deepEqual(doc.attribution.order, ['project', 'entry', 'department', 'default'], 'missing sources are appended, never dropped');
  assert.equal(doc.attribution.tdsGrouping, 'company');
  assert.equal(doc.attribution.defaultRegistrationId, 'r-mh', 'the first active registration stands in');
  assert.equal(doc.registrations[0].active, true);
  assert.deepEqual(resolveRegistrationsDoc(undefined).registrations, []);
  assert.deepEqual(resolveRegistrationsDoc({ registrations: [null, 'x'] }).registrations, []);
});

test('the treatment follows the registration state, not one fixed company state', () => {
  assert.equal(gstTypeFor('21', '21'), 'cgst-sgst');
  assert.equal(gstTypeFor('21', '27'), 'igst');
  assert.equal(gstTypeFor(undefined, '27'), 'cgst-sgst');
  // A Maharashtra supplier billed to the Maharashtra registration is local, though it is not Odisha.
  assert.equal(checkTreatment(MAHA, MAHA.gstin, 'cgst-sgst').ok, true);
  const wrong = checkTreatment(ODISHA, MAHA.gstin, 'cgst-sgst');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.expected, 'igst');
  assert.match(wrong.message, /Maharashtra/);
  assert.equal(checkTreatment(null, MAHA.gstin, 'igst').ok, true, 'nothing to check without a registration');
});

test('input credit and reverse-charge liability are never added together', () => {
  const summary = summariseGst(
    [
      bill({ id: 'a', projectId: 'p-od', taxable: 100000, cgst: 9000, sgst: 9000, net: 118000, supplierGstin: ODISHA.gstin, gstType: 'cgst-sgst' }),
      bill({ id: 'b', projectId: 'p-od', taxable: 50000, igst: 9000, net: 50000, reverseCharge: true, supplierGstin: MAHA.gstin, gstType: 'igst' }),
    ],
    docOf({ maps: { byProject: { 'p-od': 'r-od' }, byDepartment: {} } }),
  );
  const od = summary.byRegistration.find((r) => r.registrationId === 'r-od');
  assert.equal(od.totals.bills, 2);
  assert.equal(od.totals.itc, 18000, 'only the GST a supplier charged');
  assert.equal(od.totals.rcmOutput, 9000, 'the reverse-charge GST is the company’s own liability');
  assert.equal(od.totals.rcmTaxable, 50000);
  assert.equal(od.totals.taxable, 150000);
  assert.equal(summary.company.itc, 18000);
  assert.equal(summary.company.rcmOutput, 9000);
});

test('bills that cannot be claimed as they stand are flagged, and the unattributed are kept apart', () => {
  const summary = summariseGst(
    [
      bill({ id: 'a', taxable: 1000, cgst: 90, sgst: 90, supplierGstin: '', gstType: 'cgst-sgst' }),
      bill({ id: 'b', taxable: 1000, igst: 180, supplierGstin: MAHA.gstin, invoiceNo: '', gstType: 'igst' }),
      bill({ id: 'c', taxable: 1000, tds: 20, panNo: '', gstType: 'none' }),
      bill({ id: 'd', taxable: 1000, cgst: 90, sgst: 90, supplierGstin: MAHA.gstin, gstType: 'cgst-sgst' }),
    ],
    docOf(),
  );
  const od = summary.byRegistration.find((r) => r.registrationId === 'r-od');
  assert.equal(od.flags.missingSupplierGstin, 1);
  assert.equal(od.flags.missingInvoice, 1);
  assert.equal(od.flags.tdsWithoutPan, 1);
  assert.equal(od.flags.treatmentMismatch, 1, 'a Maharashtra supplier split as CGST + SGST against Odisha');
  assert.equal(flagTotal(summary.companyFlags), 4);
  assert.equal(od.bySource.default, 4);

  // With no source able to decide, the bills land in their own bucket rather than a registration's.
  const loose = summariseGst([bill({ id: 'x', taxable: 500, net: 500 })], docOf({ attribution: { enabled: { entry: true, project: true, department: true, default: false } } }));
  const bucket = loose.byRegistration.find((r) => r.registrationId === '');
  assert.equal(bucket.totals.bills, 1);
  assert.equal(bucket.label, 'Not attributed');
  assert.equal(loose.attributionOf.get('x').source, 'none');
});

test('TDS groups per TAN only when configured to', () => {
  const bills = [
    bill({ id: 'a', projectId: 'p-od', tds: 2000 }),
    bill({ id: 'b', projectId: 'p-mh', tds: 500 }),
  ];
  const maps = { byProject: { 'p-od': 'r-od', 'p-mh': 'r-mh' }, byDepartment: {} };
  assert.deepEqual(summariseGst(bills, docOf({ maps })).byTan, [], 'company-wide by default');

  const perTan = summariseGst(bills, docOf({ maps, attribution: { tdsGrouping: 'registration' } })).byTan;
  assert.deepEqual(
    perTan.map((t) => [t.tan, t.tds, t.bills]),
    [
      ['BBNS12345A', 2000, 1],
      ['MUMS54321B', 500, 1],
    ],
  );
  assert.equal(summariseGst(bills, docOf({ maps })).company.tds, 2500);
});

test('a duplicate GSTIN is reported even when the first copy has a bad TAN', () => {
  const first = { ...ODISHA, id: 'r-1', tan: 'NOTATAN' };
  const second = { ...ODISHA, id: 'r-2' };
  const errors = validateRegistrations([first, second]);
  assert.match(errors['r-1'], /TAN/);
  assert.match(errors['r-2'], /already in the list/, 'the second copy is the duplicate, whatever is wrong with the first');
});
