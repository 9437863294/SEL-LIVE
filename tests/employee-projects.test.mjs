/**
 * Employee → project links (src/lib/employee-projects): the matching rules, the Employee › Category
 * save, and the lookup a trip's project picker uses — against the in-memory Firestore.
 *
 * Run: npm run test:fleet
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';
import { employeeCategoryValue, linkedProjectIds, normaliseProjectName, projectAllowed, projectChoices } from '../src/lib/employee-projects/links.ts';

globalThis.__db = new FakeFirestore();
const db = globalThis.__db;
const { employeeProjectIdsOf, projectLinksOverview, projectSourceOverview, saveProjectLink, saveProjectSource } = await import('../src/lib/employee-projects/server.ts');

/* ── rules ─────────────────────────────────────────────────────────────── */

test("an employee's value comes from the chosen category, with the record's own fields as fallback", () => {
  const employee = { categories: { 'Project Division': 'Tower Division', 'Project Name': 'Infocity Tower' }, projectName: 'Old Name' };
  assert.equal(employeeCategoryValue(employee, 'Project Division'), 'Tower Division');
  assert.equal(employeeCategoryValue(employee, 'Project Name'), 'Infocity Tower');
  assert.equal(employeeCategoryValue({ projectDivision: 'East' }, 'Project Division'), 'East');
  assert.equal(employeeCategoryValue({ projectName: 'HO' }, 'Project Name'), 'HO');
  assert.equal(employeeCategoryValue({}, 'Cost Center'), '');
  // A link answers only for its own category; one without a category is a Project Name link.
  const links = [
    { valueName: 'HO', projectIds: ['p9'] },
    { valueName: 'HO', projectIds: ['p5'], categoryType: 'Project Division' },
  ];
  assert.deepEqual(linkedProjectIds('HO', links), ['p9']);
  assert.deepEqual(linkedProjectIds('HO', links, undefined, 'Project Division'), ['p5']);
});

test('a greytHR project name matches its link however it is typed', () => {
  assert.equal(normaliseProjectName('  Infocity  Tower '), 'infocity tower');
  const links = [
    { valueName: 'Infocity Tower', projectIds: ['p1', 'p2'] },
    { valueName: 'HO', projectIds: ['p9'] },
  ];
  assert.deepEqual(linkedProjectIds('infocity-tower', links), ['p1', 'p2']);
  assert.deepEqual(linkedProjectIds('Infocity Tower', links, new Set(['p2'])), ['p2']);
  assert.deepEqual(linkedProjectIds('', links), []);
  assert.deepEqual(linkedProjectIds('Unknown', links), []);
});

test("the picker lists the employee's projects first, or only; never leaves someone with nothing", () => {
  const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const first = projectChoices(projects, ['c'], false);
  assert.deepEqual(first.options.map((option) => [option.id, option.mine]), [['c', true], ['a', false], ['b', false]]);
  assert.equal(first.preselect, 'c');
  const only = projectChoices(projects, ['b', 'c'], true);
  assert.deepEqual(only.options.map((option) => option.id), ['b', 'c']);
  assert.equal(only.preselect, null, 'two projects: nothing pre-selected');
  assert.equal(only.restricted, true);
  const none = projectChoices(projects, [], true);
  assert.equal(none.options.length, 3, 'no linked project: every project');
  assert.equal(none.restricted, false);
  assert.equal(projectAllowed('a', ['b'], true), false);
  assert.equal(projectAllowed('a', ['b'], false), true);
  assert.equal(projectAllowed('a', [], true), true);
  assert.equal(projectAllowed(null, ['b'], true), true);
});

/* ── server ────────────────────────────────────────────────────────────── */

db.seed('categories', 'Project_Name_12', { id: 12, name: 'Infocity Tower', type: 'Project Name' });
db.seed('categories', 'Project_Name_13', { id: 13, name: 'HO', type: 'Project Name' });
db.seed('categories', 'Department_4', { id: 4, name: 'Civil', type: 'Department' });
db.seed('categories', 'Project_Division_7', { id: 7, name: 'Tower Division', type: 'Project Division' });
db.seed('projects', 'p1', { projectName: 'Infocity Tower', siteCode: 'ICT', status: 'Active' });
db.seed('projects', 'p2', { projectName: 'Infocity Tower — Block B', siteCode: 'ICT-B', status: 'Active' });
db.seed('projects', 'p9', { projectName: 'Head Office', siteCode: 'HO', status: 'Active' });
db.seed('users', 'u-ravi', { name: 'Ravi', employeeId: 'E1' });
db.seed('users', 'u-nobody', { name: 'No employee' });
db.seed('employees', 'E1', { name: 'Ravi', projectName: 'Infocity Tower', status: 'Active', categories: { 'Project Name': 'Infocity Tower', 'Project Division': 'Tower Division' } });
db.seed('employees', 'E2', { name: 'Asha', projectName: 'infocity tower', status: 'Active' });
db.seed('employees', 'E3', { name: 'Gone', projectName: 'Infocity Tower', status: 'Inactive' });

const subject = (grants) => ({ permissions: grants, roleNames: [], role: 'User' });
const actor = (grants) => ({ userId: 'admin', userName: 'Admin', access: subject(grants) });
const editor = actor({ 'Settings.Employee Management': ['View', 'Edit'] });
const viewer = actor({ 'Settings.Employee Management': ['View'] });

test('the category screen lists the greytHR projects with their staff and links', async () => {
  const overview = await projectLinksOverview(viewer);
  assert.deepEqual(overview.rows.map((row) => [row.name, row.employees, row.projectIds.length]), [['HO', 0, 0], ['Infocity Tower', 2, 0]]);
  assert.equal(overview.canEdit, false);
  assert.equal(overview.projects.length, 3);
  await assert.rejects(projectLinksOverview(actor({})), /Employee Management/);
});

test('linking needs Edit, a real greytHR project value and real app projects', async () => {
  await assert.rejects(saveProjectLink(viewer, 'Project_Name_12', { projectIds: ['p1'] }), (error) => error.status === 403);
  await assert.rejects(saveProjectLink(editor, 'Project_Name_404', { projectIds: ['p1'] }), (error) => error.status === 404);
  // Any category's values may be linked (any of them can be made the source); only the source's links are used.
  await saveProjectLink(editor, 'Department_4', { projectIds: ['p9'] });
  assert.equal(db.read('employeeProjectLinks', 'Department_4').categoryType, 'Department');
  await assert.rejects(saveProjectLink(editor, 'Project_Name_12', { projectIds: ['nope'] }), /no longer exist/);
  const { row } = await saveProjectLink(editor, 'Project_Name_12', { projectIds: ['p1', 'p2', 'p1'] });
  assert.deepEqual(row.projectIds, ['p1', 'p2']);
  assert.deepEqual(db.read('employeeProjectLinks', 'Project_Name_12').projectIds, ['p1', 'p2']);
  assert.equal(db.read('employeeProjectLinks', 'Project_Name_12').valueName, 'Infocity Tower');
  const overview = await projectLinksOverview(editor);
  assert.deepEqual(overview.rows.find((entry) => entry.id === 'Project_Name_12').projectIds, ['p1', 'p2']);
});

test("an employee's projects follow their greytHR project through the link", async () => {
  assert.deepEqual((await employeeProjectIdsOf('u-ravi')).sort(), ['p1', 'p2']);
  assert.deepEqual(await employeeProjectIdsOf('u-nobody'), [], 'no greytHR employee: none');
  await saveProjectLink(editor, 'Project_Name_12', { projectIds: [] });
  assert.deepEqual(await employeeProjectIdsOf('u-ravi'), [], 'unlinked: none');
});

test('the source category is a setting: switch to Project Division and its links take over', async () => {
  assert.deepEqual(await projectSourceOverview(viewer), { sourceCategory: 'Project Name', canEdit: false });
  await assert.rejects(saveProjectSource(viewer, { sourceCategory: 'Project Division' }), (error) => error.status === 403);
  await assert.rejects(saveProjectSource(editor, { sourceCategory: 'Nonsense' }), /no category/);

  await saveProjectLink(editor, 'Project_Name_12', { projectIds: ['p1'] });
  await saveProjectLink(editor, 'Project_Division_7', { projectIds: ['p9'] });
  assert.equal(db.read('employeeProjectLinks', 'Project_Division_7').categoryType, 'Project Division');
  assert.deepEqual(await employeeProjectIdsOf('u-ravi'), ['p1'], 'still Project Name');

  await saveProjectSource(editor, { sourceCategory: 'Project Division' });
  assert.equal((await projectSourceOverview(editor)).sourceCategory, 'Project Division');
  assert.deepEqual(await employeeProjectIdsOf('u-ravi'), ['p9'], 'now Project Division');
  const division = await projectLinksOverview(editor);
  assert.equal(division.category, 'Project Division');
  assert.deepEqual(division.rows.map((row) => [row.name, row.employees, row.projectIds]), [['Tower Division', 1, ['p9']]]);
  const names = await projectLinksOverview(editor, 'Project Name');
  assert.deepEqual(names.rows.find((row) => row.id === 'Project_Name_12').projectIds, ['p1'], 'the Project Name links are kept');

  await saveProjectSource(editor, { sourceCategory: 'Project Name' });
  assert.deepEqual(await employeeProjectIdsOf('u-ravi'), ['p1'], 'and switching back restores them');
});
