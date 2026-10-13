/**
 * Backward-compatible permission aliases for legacy role documents.
 *
 * Shared by the browser's `useAuthorization().can` and by the server, which writes each user's
 * resolved permissions for the Firestore security rules to read (`access-rules-permissions.ts`).
 * One definition, so a resource the screen treats as held is a resource the rules treat as held.
 *
 * At module scope, not rebuilt per question. It is a constant, and `can` is called dozens of times
 * per render across the application — `useEApprovalPermissions` alone asks it twenty-five questions —
 * so building this twenty-entry map and then running `Object.entries().filter().map()` over it on
 * every question was pure repeat work for an answer that never changes.
 *
 * This module imports nothing, so it is safe on both sides of the server/client boundary.
 */
export const resourceAliasMap: Record<string, string[]> = {
  'Bank Balance.Expenses': ['Bank Balance.Expenses Log'],
  'Bank Balance.Receipts': ['Bank Balance.Receipts Log'],
  'Bank Balance.Internal Transaction': ['Bank Balance.Internal Transaction Log'],
  'Letter of Credit Management': ['LC Management', 'LC Module'],
  'Letter of Credit Management.View Module': ['LC Management.View Module', 'LC Module.View Module'],
  'Letter of Credit Management.Dashboard': ['LC Management.Dashboard', 'LC Module.Dashboard'],
  'Letter of Credit Management.LC Requests': ['LC Management.LC Request', 'LC Module.LC Request'],
  'Letter of Credit Management.LC Register': ['LC Management.LC Detail', 'LC Module.LC Detail'],
  'Letter of Credit Management.Pending Approvals': ['LC Management.LC Request', 'LC Module.LC Request'],
  'Letter of Credit Management.LC Opening': ['LC Management.LC Opening', 'LC Module.LC Opening'],
  'Letter of Credit Management.Hundis & Bills': ['LC Management.LC Documents', 'LC Module.LC Documents'],
  'Letter of Credit Management.Shipment & Documents': ['LC Management.LC Documents', 'LC Module.LC Documents'],
  'Letter of Credit Management.Payment Due Calendar': ['LC Management.LC Payments', 'LC Module.LC Payments'],
  'Letter of Credit Management.Payment Processing': ['LC Management.LC Payments', 'LC Module.LC Payments'],
  'Letter of Credit Management.LC Amendments': ['LC Management.LC Amendments', 'LC Module.LC Amendments'],
  'Letter of Credit Management.Reports': ['LC Management.LC Reports', 'LC Module.LC Reports'],
  // E-Approval's "Administration" node was renamed "Settings" to match the rest of the app, and
  // its catch-all "Settings" child became "Policies". Roles granted before the rename keep
  // working through these aliases rather than silently losing access to the config screens.
  'E-Approval.Settings': ['E-Approval.Administration'],
  'E-Approval.Settings.Approval Types': ['E-Approval.Administration.Approval Types'],
  'E-Approval.Settings.Workflow Templates': ['E-Approval.Administration.Workflow Templates'],
  'E-Approval.Settings.Approval Matrix': ['E-Approval.Administration.Approval Matrix'],
  'E-Approval.Settings.Department Routing': ['E-Approval.Administration.Department Routing'],
  'E-Approval.Settings.Policies': ['E-Approval.Administration.Settings'],
};

/**
 * Which canonical resources name a given resource as one of their aliases.
 *
 * Precomputed once by inverting the map above, because resolving it per call meant scanning every
 * entry of `resourceAliasMap` on every permission check — for a lookup that is the same every time.
 */
const reverseAliasMap: Record<string, string[]> = (() => {
  const inverted: Record<string, string[]> = {};
  for (const [canonical, aliases] of Object.entries(resourceAliasMap)) {
    for (const alias of aliases) (inverted[alias] ||= []).push(canonical);
  }
  return inverted;
})();

/** The resource plus everything it is known by. Memoised across calls — the answer never changes. */
const candidateResourceCache = new Map<string, string[]>();
export const candidateResourcesFor = (resource: string): string[] => {
  const cached = candidateResourceCache.get(resource);
  if (cached) return cached;
  const value = Array.from(
    new Set([resource, ...(resourceAliasMap[resource] || []), ...(reverseAliasMap[resource] || [])]),
  );
  candidateResourceCache.set(resource, value);
  return value;
};
