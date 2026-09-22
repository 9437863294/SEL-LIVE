import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The dashboard's links must land somewhere.
 *
 * Every row on the central dashboard is a deep link — that is the feature. A dead link is therefore
 * not a cosmetic bug, it is the feature failing, and it fails silently: nothing typechecks a string
 * against the App Router, and the module that owns the route has no idea the dashboard points at it.
 * A route folder renamed six months from now would break the click-through with no test going red.
 *
 * So this resolves the base paths the sources actually import against the real route tree. The
 * per-source literal paths (`/hr/approvals`, `/tour-travel/approvals`, …) are listed here too, kept
 * deliberately as a copy: if somebody changes one in `work-dashboard-sources.ts` without changing it
 * here, the disagreement is the signal.
 */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');

/** Every renderable route in the App Router tree, with `(groups)` elided as the router elides them. */
function collectRoutes(dir, prefix = []) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const isGroup = entry.startsWith('(') && entry.endsWith(')');
    const next = isGroup ? prefix : [...prefix, entry];
    if (existsSync(join(full, 'page.tsx')) || existsSync(join(full, 'page.ts'))) {
      found.push(`/${next.join('/')}`);
    }
    found.push(...collectRoutes(full, next));
  }
  return found;
}

const ROUTES = collectRoutes(APP);

/** Does a concrete path match a route pattern, treating `[param]` as a wildcard? */
function matches(path, pattern) {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  const catchAll = patternParts.findIndex((part) => part.startsWith('[...'));
  if (catchAll >= 0) {
    return patternParts
      .slice(0, catchAll)
      .every((part, index) => part.startsWith('[') || part === pathParts[index]);
  }
  if (pathParts.length !== patternParts.length) return false;
  return patternParts.every((part, index) => (part.startsWith('[') ? true : part === pathParts[index]));
}

const resolves = (path) => ROUTES.some((route) => matches(path, route));

/* ── the route tree itself ─────────────────────────────────────────────────────────────────────── */

test('the route collector finds the app it is pointed at', () => {
  // Guards the rest of the file: an empty tree would make every assertion below vacuously pass.
  assert.ok(ROUTES.length > 100, `expected a populated route tree, found ${ROUTES.length}`);
  assert.ok(resolves('/e-approval/inbox'));
  assert.ok(!resolves('/this-route-does-not-exist'));
});

test('the dashboard has a route of its own', () => {
  assert.ok(resolves('/my-work'), '/my-work must exist — the header links to it');
});

/* ── base paths imported by the sources ────────────────────────────────────────────────────────── */

test('every Project Management base path and its stage route resolve', async () => {
  const modules = [
    ['project-management-indent-workflow', 'INDENT_BASE_PATH'],
    ['project-management-po-workflow', 'PO_BASE_PATH'],
    ['project-management-mc-workflow', 'MC_BASE_PATH'],
    ['project-management-rfq-workflow', 'RFQ_BASE_PATH'],
    ['project-management-inspection-workflow', 'INSPECTION_BASE_PATH'],
    ['project-management-survey-workflow', 'SURVEY_BASE_PATH'],
    ['jmc-module', 'PM_JMC_BASE_PATH'],
  ];

  for (const [moduleName, constantName] of modules) {
    const imported = await import(`../src/lib/${moduleName}.ts`);
    const basePath = imported[constantName];
    assert.equal(typeof basePath, 'string', `${constantName} should be exported as a string`);
    assert.ok(resolves(basePath), `${constantName} (${basePath}) does not resolve`);
    // The builder in `work-dashboard-project-sources.ts` links to the step a row is sitting on.
    assert.ok(resolves(`${basePath}/stage/x`), `${basePath}/stage/[stageId] does not resolve`);
  }
});

test('the Office Hub base path and the screens the sources link into resolve', async () => {
  const { OFFICE_HUB_BASE_PATH } = await import('../src/lib/office-hub-permissions.ts');
  assert.equal(OFFICE_HUB_BASE_PATH, '/office-hub');
  for (const suffix of ['', '/tasks/x', '/meetings/x', '/action-items', '/decisions', '/notifications']) {
    assert.ok(resolves(`${OFFICE_HUB_BASE_PATH}${suffix}`), `${OFFICE_HUB_BASE_PATH}${suffix} does not resolve`);
  }
});

test('the E-Approval detail route resolves', () => {
  // `e-approval.ts` re-exports `./e-approval-policy` extensionless, so it will not import under
  // node's type-stripping loader. The constant is asserted directly instead.
  assert.ok(resolves('/e-approval/x'), '/e-approval/[approvalId] does not resolve');
});

/* ── the literal destinations ──────────────────────────────────────────────────────────────────── */

test('every literal href in the source registry resolves', () => {
  const literals = [
    '/daily-requisition',
    '/insurance/my-tasks',
    '/tour-travel/approvals',
    '/recurring-payments/approvals',
    '/vehicle-management/insurance/workflow',
    '/hr/approvals',
    '/hr/selection',
    '/hr/offers',
    '/hr/interviews',
    '/fixed-deposit/approvals',
    '/bank-guarantee/approvals',
    '/letter-of-credit/approvals',
    '/store-stock-management/inventory/movements',
  ];
  for (const path of literals) {
    assert.ok(resolves(path), `${path} does not resolve`);
  }
});

test('the two requisition workflows resolve at their module root and their stage route', () => {
  for (const basePath of ['/site-fund-request', '/site-fund-requisition-2']) {
    assert.ok(resolves(basePath), `${basePath} does not resolve`);
    assert.ok(resolves(`${basePath}/stage/x`), `${basePath}/stage/[stageId] does not resolve`);
  }
});
