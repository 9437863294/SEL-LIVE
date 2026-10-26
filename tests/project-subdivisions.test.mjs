/**
 * Settings › Projects — sub-division sites and the project form rules (src/lib/project-subdivisions).
 *
 * Run: node --experimental-strip-types --test tests/project-subdivisions.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_PROJECT_FORM,
  EMPTY_SUBDIVISION_FORM,
  ProjectRuleError,
  buildSubdivision,
  inChargeLabel,
  matchProject,
  newSubdivisionId,
  projectFormFrom,
  projectPayload,
  removeSubdivision,
  subdivisionsOf,
  suggestSubdivisionCode,
  summariseProjects,
  upsertSubdivision,
  validateProject,
  validateSubdivision,
} from '../src/lib/project-subdivisions.ts';

const site = (id, name, extra = {}) => ({ id, name, status: 'Active', ...extra });

const project = (id, extra = {}) => ({
  id,
  projectName: `Project ${id}`,
  siteCode: `SEL-${id}`,
  projectSite: 'Hyderabad',
  projectDivision: 'Electrical',
  location: 'Gachibowli',
  siteInCharge: 'N/A',
  status: 'Active',
  ...extra,
});

/* ── sites ─────────────────────────────────────────────────────────────── */

test('a project without the field, or with junk in it, has no sites', () => {
  assert.deepEqual(subdivisionsOf(project('1')), []);
  assert.deepEqual(subdivisionsOf(undefined), []);
  assert.deepEqual(subdivisionsOf({ subdivisions: 'nope' }), []);
  assert.deepEqual(
    subdivisionsOf({ subdivisions: [null, { name: 'no id' }, { id: '', name: 'blank id' }, site('a', 'Kept')] }),
    [site('a', 'Kept')],
  );
});

test('a site is stored trimmed, without empty optional fields', () => {
  const built = buildSubdivision(
    { ...EMPTY_SUBDIVISION_FORM, name: '  Section A ', code: ' SEL-1-01 ', location: '   ', siteInCharge: 'N/A' },
    'x',
  );
  assert.deepEqual(built, { id: 'x', name: 'Section A', code: 'SEL-1-01', status: 'Active' });
  assert.equal(Object.values(built).includes(undefined), false);
  assert.equal(buildSubdivision({ ...EMPTY_SUBDIVISION_FORM, name: 'B', status: 'Inactive' }, 'y').status, 'Inactive');
});

test('site names and codes are unique within the project, ignoring case', () => {
  const list = [site('a', 'Section A', { code: 'SEL-1-01' }), site('b', 'Section B')];
  assert.equal(validateSubdivision(site('c', '  '), list), 'Enter the site name.');
  assert.match(validateSubdivision(site('c', 'section a'), list), /already has a site called "section a"/);
  assert.match(validateSubdivision(site('c', 'Section C', { code: 'sel-1-01' }), list), /Site code "sel-1-01"/);
  assert.equal(validateSubdivision(site('c', 'Section C', { code: 'SEL-1-02' }), list), null);
  // Its own earlier copy is not a clash.
  assert.equal(validateSubdivision(site('a', 'Section A', { code: 'SEL-1-01' }), list), null);
});

test('upsert appends a new site, replaces an existing one in place, and refuses a clash', () => {
  const list = [site('a', 'A'), site('b', 'B')];
  assert.deepEqual(upsertSubdivision(list, site('c', 'C')).map((s) => s.id), ['a', 'b', 'c']);
  const renamed = upsertSubdivision(list, site('a', 'A renamed'));
  assert.deepEqual(renamed.map((s) => s.name), ['A renamed', 'B']);
  assert.equal(list[0].name, 'A', 'the input list is not mutated');
  assert.throws(() => upsertSubdivision(list, site('c', 'b')), ProjectRuleError);
  assert.deepEqual(removeSubdivision(list, 'a'), [site('b', 'B')]);
  assert.deepEqual(removeSubdivision(list, 'missing'), list);
});

test('new site ids never collide with existing ones', () => {
  let calls = 0;
  const first = newSubdivisionId([], () => 0.5);
  const id = newSubdivisionId([site(first, 'A')], () => (calls++ === 0 ? 0.5 : 0.25));
  assert.notEqual(id, first);
  assert.match(id, /^sd_/);
});

test('the suggested site code follows the project code and skips taken suffixes', () => {
  assert.equal(suggestSubdivisionCode({ siteCode: 'SEL-001' }), 'SEL-001-01');
  assert.equal(
    suggestSubdivisionCode({ siteCode: 'SEL-001', subdivisions: [site('a', 'A', { code: 'sel-001-01' }), site('b', 'B', { code: 'SEL-001-03' })] }),
    'SEL-001-02',
  );
  assert.equal(suggestSubdivisionCode({ siteCode: '  ' }), '');
});

/* ── projects ──────────────────────────────────────────────────────────── */

test('the project payload never carries sites or other modules’ fields', () => {
  const stored = project('1', {
    subdivisions: [site('a', 'A')],
    signatures: [{ id: 's', designation: 'PM', name: 'X' }],
    clientId: 'c1',
    billingRequired: true,
  });
  const payload = projectPayload({ ...projectFormFrom(stored), projectName: '  Renamed  ' });
  assert.deepEqual(Object.keys(payload).sort(), Object.keys(EMPTY_PROJECT_FORM).sort());
  assert.equal(payload.projectName, 'Renamed');
  assert.equal('subdivisions' in payload, false);
});

test('no in-charge reads as empty and is written as the legacy N/A', () => {
  assert.equal(inChargeLabel('N/A'), '');
  assert.equal(inChargeLabel(' n/a '), '');
  assert.equal(inChargeLabel(undefined), '');
  assert.equal(inChargeLabel(' Ravi '), 'Ravi');
  assert.equal(projectFormFrom(project('1')).siteInCharge, '');
  assert.equal(projectPayload({ ...EMPTY_PROJECT_FORM, projectName: 'P' }).siteInCharge, 'N/A');
  assert.equal(projectPayload({ ...EMPTY_PROJECT_FORM, projectName: 'P', siteInCharge: 'Ravi' }).siteInCharge, 'Ravi');
});

test('project names and codes must be unique, but an old duplicate does not block editing', () => {
  const projects = [project('1'), project('2'), project('3', { projectName: 'Project 1' })];
  const form = (extra) => ({ ...EMPTY_PROJECT_FORM, ...extra });
  assert.equal(validateProject(form({ projectName: ' ' }), projects), 'Enter the project name.');
  assert.match(validateProject(form({ projectName: 'project 2' }), projects), /already exists/);
  assert.match(validateProject(form({ projectName: 'New', siteCode: 'sel-2' }), projects), /Site code "sel-2"/);
  assert.equal(validateProject(form({ projectName: 'New', siteCode: 'SEL-9' }), projects), null);
  // Project 3 shares Project 1's name from before the check existed; saving it unchanged is fine…
  assert.equal(validateProject(projectFormFrom(projects[2]), projects, projects[2]), null);
  // …but renaming it onto another project is not.
  assert.match(validateProject({ ...projectFormFrom(projects[2]), projectName: 'Project 2' }, projects, projects[2]), /already exists/);
});

/* ── register ──────────────────────────────────────────────────────────── */

test('the summary counts projects, sites and projects still without sites', () => {
  const projects = [
    project('1', { subdivisions: [site('a', 'A'), site('b', 'B', { status: 'Inactive' })] }),
    project('2', { status: 'Inactive' }),
    project('3', { subdivisions: [] }),
  ];
  assert.deepEqual(summariseProjects(projects), { total: 3, active: 2, inactive: 1, sites: 2, activeSites: 1, withoutSites: 2 });
});

test('search finds a project by its own fields, its sites, or both together', () => {
  const p = project('44', {
    projectName: 'NH-44 Line',
    subdivisions: [site('a', 'Kurnool Section', { code: 'SEL-44-01' }), site('b', 'Anantapur Section', { siteInCharge: 'Ravi Kumar' })],
  });
  assert.deepEqual(matchProject(p, ''), { matched: true, siteIds: [] });
  assert.deepEqual(matchProject(p, 'nh-44'), { matched: true, siteIds: [] });
  assert.deepEqual(matchProject(p, 'KURNOOL'), { matched: true, siteIds: ['a'] });
  assert.deepEqual(matchProject(p, 'ravi'), { matched: true, siteIds: ['b'] });
  // Words split across the project and one site still find it.
  assert.equal(matchProject(p, 'nh-44 kurnool').matched, true);
  // Words split across two different sites do not.
  assert.equal(matchProject(p, 'kurnool anantapur').matched, false);
  assert.equal(matchProject(p, 'vizag').matched, false);
});
