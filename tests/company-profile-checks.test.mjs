import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COMPANY_PROFILE } from '../src/lib/company-profile.ts';
import {
  changedAreas,
  gstRowStatuses,
  issuesByField,
  mergeImportedRegistrations,
  panFromGstins,
  profileIssues,
  registrationsNotListed,
} from '../src/lib/company-profile-checks.ts';
import { gstinCheckChar } from '../src/lib/statutory.ts';

/** A GSTIN with the right check character: state code + PAN + entity code + Z. */
const gstin = (state, pan) => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;
const ODISHA = gstin('21', 'AAACS1234F');
const BENGAL = gstin('19', 'AAACS1234F');

const withDesign = (patch) => ({ ...DEFAULT_COMPANY_PROFILE, design: { ...DEFAULT_COMPANY_PROFILE.design, ...patch } });
const fields = (issues) => issues.map((issue) => `${issue.severity}:${issue.field}`);

test('the stored defaults raise nothing', () => {
  assert.deepEqual(profileIssues(DEFAULT_COMPANY_PROFILE), []);
});

test('values the sanitiser would drop or replace are errors', () => {
  const issues = profileIssues({
    ...DEFAULT_COMPANY_PROFILE,
    legalName: '   ',
    city: '',
    pan: 'AAACS1234',
    cin: 'U31200OR1990PLC00234',
    email: 'accounts@',
    website: 'not a site',
    logoUrl: 'http://example.com/logo.png',
  });
  assert.deepEqual(fields(issues), ['error:legalName', 'error:city', 'error:cin', 'error:pan', 'error:email', 'error:website', 'error:logoUrl']);
  assert.ok(issues.every((issue) => issue.area === 'details'));
});

test('valid values pass, and a PAN unlike the GSTIN’s is only a warning', () => {
  const good = { ...DEFAULT_COMPANY_PROFILE, pan: 'aaacs1234f', cin: 'U31200OR1990PLC002345', email: 'a@b.in', website: 'www.example.com', logoUrl: 'https://example.com/l.png' };
  assert.deepEqual(profileIssues(good), []);
  const rows = [{ gstin: ODISHA, state: 'Odisha', label: '', primary: true }];
  assert.deepEqual(profileIssues({ ...good, gstRegistrations: rows }), []);
  const issues = profileIssues({ ...good, pan: 'AAACT9999K', gstRegistrations: rows });
  assert.deepEqual(fields(issues), ['warning:pan']);
  assert.match(issues[0].message, /AAACS1234F/);
});

test('each GST row says whether it is kept, and why not', () => {
  const wrongCheck = `${ODISHA.slice(0, 14)}${ODISHA[14] === '0' ? '1' : '0'}`;
  const statuses = gstRowStatuses([
    { gstin: '', state: '', label: '', primary: false },
    { gstin: wrongCheck, state: '', label: '', primary: false },
    { gstin: ODISHA.toLowerCase(), state: '', label: '', primary: false },
    { gstin: ` ${ODISHA} `, state: '', label: '', primary: false },
  ]);
  assert.deepEqual(statuses.map((status) => status.state), ['empty', 'invalid', 'valid', 'duplicate']);
  assert.equal(statuses[2].stateName, 'Odisha');
  assert.equal(statuses[2].pan, 'AAACS1234F');
  const issues = profileIssues({ ...DEFAULT_COMPANY_PROFILE, gstRegistrations: [{ gstin: '', state: '', label: '', primary: false }] });
  assert.deepEqual(fields(issues), ['error:gst.0']);
  assert.equal(issues[0].area, 'gst');
});

test('the PAN suggestion comes from the primary registration', () => {
  assert.equal(panFromGstins([]), null);
  const rows = [
    { gstin: gstin('19', 'AAACT9999K'), state: '', label: '', primary: false },
    { gstin: ODISHA, state: '', label: '', primary: true },
  ];
  assert.equal(panFromGstins(rows), 'AAACS1234F');
  assert.equal(panFromGstins(rows.map((row) => ({ ...row, primary: false }))), 'AAACT9999K');
});

test('letterhead checks follow the mode on screen', () => {
  const standard = withDesign({ letterhead: { ...DEFAULT_COMPANY_PROFILE.design.letterhead, accentColor: '#12' } });
  assert.deepEqual(fields(profileIssues(standard)), ['error:accentColor']);
  // In the designed mode the accent colour is not on screen; it is stored as it was.
  const designed = withDesign({
    letterhead: {
      ...standard.design.letterhead,
      mode: 'custom',
      custom: { ...DEFAULT_COMPANY_PROFILE.design.letterhead.custom, headerHeightMm: 300, footerHeightMm: 20, marginMm: 0 },
    },
  });
  const issues = profileIssues(designed);
  assert.deepEqual(fields(issues), ['warning:headerHeightMm']);
  assert.match(issues[0].message, /120 mm/);
});

test('too many address lines or captions are warnings', () => {
  const issues = profileIssues({
    ...DEFAULT_COMPANY_PROFILE,
    addressLines: ['1', '2', ' ', '3', '4', '5'],
    design: { ...DEFAULT_COMPANY_PROFILE.design, print: { ...DEFAULT_COMPANY_PROFILE.design.print, signatureLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } },
  });
  assert.deepEqual(fields(issues), ['warning:addressLines', 'warning:signatureLabels']);
});

test('an error wins over a warning about the same field', () => {
  const map = issuesByField([
    { area: 'details', field: 'pan', label: 'PAN', message: 'w', severity: 'warning' },
    { area: 'details', field: 'pan', label: 'PAN', message: 'e', severity: 'error' },
    { area: 'details', field: 'pan', label: 'PAN', message: 'w2', severity: 'warning' },
  ]);
  assert.equal(map.pan.message, 'e');
});

test('changed areas name the tabs with unsaved edits', () => {
  const saved = DEFAULT_COMPANY_PROFILE;
  assert.deepEqual(changedAreas(saved, saved), []);
  const draft = {
    ...saved,
    phone: '123',
    design: { ...saved.design, print: { ...saved.design.print, showPrintedOn: true } },
  };
  assert.deepEqual(changedAreas(draft, saved), ['details', 'print']);
  // Layout and text labels belong to Appearance: not an area of this screen.
  assert.deepEqual(changedAreas({ ...saved, labels: { ...saved.labels, save: 'Keep' } }, saved), []);
});

test('importing keeps primary flags, adds the rest, and picks the head office when none is primary', () => {
  const rows = [{ gstin: BENGAL, state: 'West Bengal', label: 'Kolkata', primary: false }];
  const importable = [
    { gstin: ODISHA.toLowerCase(), stateName: 'Odisha', label: '' },
    { gstin: BENGAL, stateName: 'West Bengal', label: 'Kolkata office' },
  ];
  assert.deepEqual(registrationsNotListed(rows, importable).map((entry) => entry.stateName), ['Odisha']);
  const merged = mergeImportedRegistrations(rows, importable);
  assert.deepEqual(merged, [
    { gstin: ODISHA, state: 'Odisha', label: 'Odisha', primary: true },
    { gstin: BENGAL, state: 'West Bengal', label: 'Kolkata office', primary: false },
  ]);
  const kept = mergeImportedRegistrations([{ ...rows[0], primary: true }], importable);
  assert.deepEqual(kept.map((entry) => entry.primary), [false, true]);
});
