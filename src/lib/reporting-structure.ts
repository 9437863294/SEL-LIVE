/**
 * The reporting structure: who reports to whom, derived from greytHR's org tree.
 *
 * ── What this is for ────────────────────────────────────────────────────────────────────────────
 *
 * The sync has written `reportingManagerEmployeeId` onto every employee record for as long as the
 * "Reporting structure" detail group has been enabled, and until now exactly two things read it:
 * the profile page, one employee at a time, and `reportingAuthorityOf` in the trip-claims module,
 * which walks one step up to find an approver. Nobody could see the shape of the organisation, and
 * nothing reported the gaps in it — which matters, because those gaps are what make an approval
 * route nowhere.
 *
 * ── Why the gaps are the point ──────────────────────────────────────────────────────────────────
 *
 * A reporting field is a foreign key maintained by hand in another system, so it fails in specific,
 * recognisable ways: the manager has left, the manager is not in the mirror at all, somebody is
 * recorded as their own manager, or two people report to each other. Each one is indistinguishable
 * from "fine" when you look at a single employee's profile and obvious the moment you look at the
 * whole set. So this does not just assemble a tree — it names every edge it could not resolve.
 *
 * Pure, and deliberately holding no Firestore or greytHR types beyond the employment state: the
 * route reads the mirror and hands rows in, which is what lets the whole derivation be tested
 * against fixtures rather than against a live tenant.
 */

// Type-only, deliberately. A value import would make this module unresolvable under
// `--experimental-strip-types`, which is how the repo tests its pure rules — and the one rule it
// would have imported (`isWorkingState`) is supplied by the caller as `working` instead, so that
// definition still lives in exactly one place.
import type { EmploymentState } from './greythr';

/** One employee, as the structure needs them. */
export interface ReportingPerson {
  employeeId: string;
  employeeNo: string;
  name: string;
  department: string;
  designation: string;
  employmentState: EmploymentState;
  /**
   * Whether they currently work here, decided by the caller with `isWorkingState`.
   *
   * Passed in rather than derived from `employmentState` here so the definition of "working" stays
   * in `greythr.ts` with the rest of the employment rules, and this module keeps no value imports.
   */
  working: boolean;
  /** greytHR's `reportingManagerEmployeeId`, or null where it recorded none. */
  managerEmployeeId: string | null;
  /**
   * The manager's name as greytHR recorded it.
   *
   * Kept separately from the resolved manager because the two disagree in the case that matters: a
   * manager greytHR names but the mirror does not hold. Without this the row would say "no manager"
   * when the truth is "a manager this platform has never seen".
   */
  managerName: string | null;
}

/**
 * Why an edge could not be resolved.
 *
 * `no-manager` is not necessarily a fault — somebody has to be at the top — so the screen decides
 * what to make of it. The rest are.
 */
export type ReportingIssue =
  | 'no-manager'
  | 'manager-missing'
  | 'manager-departed'
  | 'self-manager'
  | 'cycle';

export interface ReportingNode extends ReportingPerson {
  /**
   * Steps from the top of the chain, or null when there is no top to count from — a node inside a
   * cycle, or hanging off one.
   */
  depth: number | null;
  /** The manager actually resolved in this set, which is not always `managerEmployeeId`. */
  resolvedManagerId: string | null;
  directReportees: number;
  /** Everyone below, at any depth. */
  totalReportees: number;
  /** Manager ids from the immediate manager upwards. Stops at the first unresolved step. */
  chain: string[];
  issues: ReportingIssue[];
  /** Direct reportees' employee ids, in the order given. */
  children: string[];
}

export interface ReportingStructure {
  nodes: ReportingNode[];
  /** Nodes with no resolved manager, which is where a tree view starts drawing. */
  roots: string[];
  /** Each cycle as the employee ids caught in it. */
  cycles: string[][];
  counts: {
    total: number;
    withManager: number;
    roots: number;
    missingManagers: number;
    departedManagers: number;
    selfManaged: number;
    inCycles: number;
    maxDepth: number;
  };
}

/**
 * Assemble the structure, naming every edge that does not resolve.
 *
 * Iterative throughout. A thousand-odd employees is nothing, but a cycle in the data is not a
 * hypothetical — greytHR lets two people be recorded as each other's manager — and a recursive
 * walk over one does not return.
 */
export function buildReportingStructure(people: ReportingPerson[]): ReportingStructure {
  const byId = new Map<string, ReportingPerson>();
  for (const person of people) byId.set(person.employeeId, person);

  /* ── Resolve each edge, and say why when it does not ── */

  const resolved = new Map<string, string | null>();
  const issues = new Map<string, ReportingIssue[]>();
  const note = (id: string, issue: ReportingIssue) => {
    const list = issues.get(id) ?? [];
    if (!list.includes(issue)) list.push(issue);
    issues.set(id, list);
  };

  for (const person of people) {
    const managerId = person.managerEmployeeId?.trim() || null;

    if (!managerId) {
      resolved.set(person.employeeId, null);
      note(person.employeeId, 'no-manager');
      continue;
    }

    if (managerId === person.employeeId) {
      // Recorded as their own manager. Treated as no manager rather than as a one-node cycle,
      // because the useful reading is "this edge is missing", not "this edge loops".
      resolved.set(person.employeeId, null);
      note(person.employeeId, 'self-manager');
      continue;
    }

    const manager = byId.get(managerId);
    if (!manager) {
      // greytHR names somebody the mirror does not hold — usually an employee outside the API
      // user's scope, sometimes one the roster has not synced yet.
      resolved.set(person.employeeId, null);
      note(person.employeeId, 'manager-missing');
      continue;
    }

    if (!manager.working) {
      // The edge still resolves — the chain is intact and worth drawing — but an approval routed
      // up it reaches somebody who has left, so it is flagged rather than quietly accepted.
      note(person.employeeId, 'manager-departed');
    }

    resolved.set(person.employeeId, managerId);
  }

  /* ── Children ── */

  const children = new Map<string, string[]>();
  for (const person of people) children.set(person.employeeId, []);
  for (const person of people) {
    const managerId = resolved.get(person.employeeId);
    if (managerId) children.get(managerId)!.push(person.employeeId);
  }

  /* ── Cycles ──
   *
   * Each node has at most one outgoing edge, so a cycle is found by walking up from every node
   * until the path repeats. `seen` makes that linear overall: once a node is known to reach no
   * cycle, every later walk that meets it can stop.
   */

  const inCycle = new Set<string>();
  const cycles: string[][] = [];
  const settled = new Set<string>();

  for (const person of people) {
    if (settled.has(person.employeeId)) continue;
    const path: string[] = [];
    const indexInPath = new Map<string, number>();
    let current: string | null = person.employeeId;

    while (current && !settled.has(current)) {
      const seenAt = indexInPath.get(current);
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt);
        cycles.push(cycle);
        for (const id of cycle) inCycle.add(id);
        break;
      }
      indexInPath.set(current, path.length);
      path.push(current);
      current = resolved.get(current) ?? null;
    }

    for (const id of path) settled.add(id);
  }

  for (const id of inCycle) note(id, 'cycle');

  /* ── Depth, from the roots down ──
   *
   * Breadth-first from every root. Anything a root cannot reach is in a cycle or hanging below
   * one, and keeps `depth: null` — a number there would be a fiction, since there is no top.
   */

  const roots = people
    .filter((person) => !resolved.get(person.employeeId) && !inCycle.has(person.employeeId))
    .map((person) => person.employeeId);

  const depth = new Map<string, number>();
  const queue: string[] = [...roots];
  for (const id of roots) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const here = depth.get(id)!;
    for (const child of children.get(id) ?? []) {
      if (depth.has(child)) continue;
      depth.set(child, here + 1);
      queue.push(child);
    }
  }

  /* ── Subtree sizes ──
   *
   * Post-order over the reachable forest, iteratively. Unreachable nodes keep their direct count
   * only; summing a cycle's subtree has no answer.
   */

  const totals = new Map<string, number>();
  for (const root of roots) {
    const stack: Array<{ id: string; expanded: boolean }> = [{ id: root, expanded: false }];
    while (stack.length) {
      const frame = stack.pop()!;
      const kids = children.get(frame.id) ?? [];
      if (!frame.expanded) {
        stack.push({ id: frame.id, expanded: true });
        for (const child of kids) stack.push({ id: child, expanded: false });
        continue;
      }
      totals.set(frame.id, kids.reduce((sum, child) => sum + 1 + (totals.get(child) ?? 0), 0));
    }
  }

  /* ── Chains ──
   *
   * Walked per node and capped by the number of people, so a node hanging off a cycle terminates
   * instead of walking for ever.
   */

  const chainOf = (id: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let current = resolved.get(id) ?? null;
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = resolved.get(current) ?? null;
    }
    return chain;
  };

  const nodes: ReportingNode[] = people.map((person) => ({
    ...person,
    depth: depth.has(person.employeeId) ? depth.get(person.employeeId)! : null,
    resolvedManagerId: resolved.get(person.employeeId) ?? null,
    directReportees: (children.get(person.employeeId) ?? []).length,
    totalReportees: totals.get(person.employeeId) ?? (children.get(person.employeeId) ?? []).length,
    chain: chainOf(person.employeeId),
    issues: issues.get(person.employeeId) ?? [],
    children: children.get(person.employeeId) ?? [],
  }));

  const has = (node: ReportingNode, issue: ReportingIssue) => node.issues.includes(issue);

  return {
    nodes,
    roots,
    cycles,
    counts: {
      total: nodes.length,
      withManager: nodes.filter((node) => node.resolvedManagerId).length,
      roots: roots.length,
      missingManagers: nodes.filter((node) => has(node, 'manager-missing')).length,
      departedManagers: nodes.filter((node) => has(node, 'manager-departed')).length,
      selfManaged: nodes.filter((node) => has(node, 'self-manager')).length,
      inCycles: inCycle.size,
      maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth ?? 0), 0),
    },
  };
}

/** What each issue means on screen, in the order a reader should care about them. */
export const REPORTING_ISSUE_LABELS: Record<ReportingIssue, string> = {
  cycle: 'Circular reporting',
  'self-manager': 'Own manager',
  'manager-missing': 'Manager not in the mirror',
  'manager-departed': 'Manager has left',
  'no-manager': 'No manager recorded',
};

/** Worst first, so a row with several problems is labelled by the one that matters most. */
export const REPORTING_ISSUE_ORDER: ReportingIssue[] = [
  'cycle',
  'self-manager',
  'manager-missing',
  'manager-departed',
  'no-manager',
];

export const primaryIssue = (node: ReportingNode): ReportingIssue | null =>
  REPORTING_ISSUE_ORDER.find((issue) => node.issues.includes(issue)) ?? null;

/**
 * The nodes of a tree view, flattened to rows in display order.
 *
 * Flattened rather than nested so the view can render one list and the table and the tree can share
 * a row component. Nodes in cycles are appended after the forest under their own heading — they
 * belong to no tree by definition, and dropping them would hide exactly the people who need looking
 * at.
 */
export function flattenReportingTree(
  structure: ReportingStructure,
  expanded: ReadonlySet<string>,
): Array<{ node: ReportingNode; indent: number; hasChildren: boolean }> {
  const byId = new Map(structure.nodes.map((node) => [node.employeeId, node]));
  const out: Array<{ node: ReportingNode; indent: number; hasChildren: boolean }> = [];

  const sortByName = (ids: string[]) =>
    [...ids].sort((a, b) => (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));

  const walk = (id: string, indent: number) => {
    const node = byId.get(id);
    if (!node) return;
    out.push({ node, indent, hasChildren: node.children.length > 0 });
    if (!expanded.has(id)) return;
    for (const child of sortByName(node.children)) walk(child, indent + 1);
  };

  for (const root of sortByName(structure.roots)) walk(root, 0);

  /*
    Everything a root cannot reach *at all*, so a cycle cannot make people vanish from the view.

    Reachability is computed by its own full walk rather than taken from what `walk` emitted: the
    rows above stop at collapsed branches, so "not on screen" and "not in any tree" look identical
    there. Using the emitted rows appended every collapsed child back at indent 0 — the tree
    flattened itself the moment anything was collapsed.
  */
  const reachable = new Set<string>();
  const stack = [...structure.roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of byId.get(id)?.children ?? []) stack.push(child);
  }

  for (const node of structure.nodes) {
    if (!reachable.has(node.employeeId)) out.push({ node, indent: 0, hasChildren: false });
  }

  return out;
}
