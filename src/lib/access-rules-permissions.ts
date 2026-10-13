/**
 * The permission document the Firestore security rules read: `userPermissions/{authUid}`.
 *
 * ── Why a document, and why this shape ─────────────────────────────────────────────────────────
 *
 * Rules cannot run a query, so they cannot do what the app does — look the user up by uid then by
 * email, find the role by *name*, fold in additional and temporary roles and scope grants. Every
 * role document here has an auto-generated id, so `get(/roles/<role name>)` finds nothing, and the
 * resolved permission map (median 3 KB, up to 19 KB) is far too large for a custom claim's 1,000
 * bytes. So the server resolves each user's effective access with the same resolver the API routes
 * use and writes the answer to one document keyed by the Firebase auth uid — the one id a rule
 * knows. A rule then costs a single `get()`, cached for the rest of the request.
 *
 * `p` maps every held resource to its actions, already expanded through the legacy aliases
 * `useAuthorization().can` honours, and with legacy nested permission objects flattened into dotted
 * keys — so a rule's `p['Module.Page']` gives the same answer the screen's `can()` does.
 *
 * Browsers may read their own document and never write it; only the Admin SDK writes here.
 *
 * This module imports nothing outside `src/lib`, so it is unit-testable under `node --test`.
 */
import { candidateResourcesFor } from './permission-aliases.ts';

export const USER_PERMISSIONS_COLLECTION = 'userPermissions';

/** Bumped when the document's shape changes, so rules and readers can tell old documents apart. */
export const USER_PERMISSIONS_VERSION = 1;

export type RulesPermissionMap = Record<string, string[]>;

export interface UserPermissionsDoc {
  v: number;
  /** resource → actions, aliases expanded, sorted. */
  p: RulesPermissionMap;
  /** The `users` document this was resolved from. Usually equal to the auth uid, not always. */
  userDocId: string;
  roleNames: string[];
  projectIds: string[];
  departmentIds: string[];
  active: boolean;
  computedAtIso: string;
}

/** Walk a permission map that may still hold legacy nested objects, yielding dotted keys. */
function* flatten(value: unknown, prefix: string): Generator<[string, string[]]> {
  if (Array.isArray(value)) {
    const actions = value.filter((a): a is string => typeof a === 'string' && a.length > 0);
    if (prefix && actions.length) yield [prefix, actions];
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      yield* flatten(child, prefix ? `${prefix}.${key}` : key);
    }
  }
}

/**
 * The map the rules read. Every resource is also filed under each of its aliases, in both
 * directions, because `can()` accepts a grant under any of them.
 */
export function rulesPermissionMap(permissions: unknown): RulesPermissionMap {
  const merged = new Map<string, Set<string>>();
  for (const [resource, actions] of flatten(permissions, '')) {
    for (const name of candidateResourcesFor(resource)) {
      const set = merged.get(name) ?? new Set<string>();
      for (const action of actions) set.add(action);
      merged.set(name, set);
    }
  }
  const out: RulesPermissionMap = {};
  for (const name of [...merged.keys()].sort()) out[name] = [...merged.get(name)!].sort();
  return out;
}

export function buildUserPermissionsDoc(input: {
  userDocId: string;
  permissions: unknown;
  roleNames: string[];
  projectIds: string[];
  departmentIds: string[];
  active: boolean;
  now?: Date;
}): UserPermissionsDoc {
  return {
    v: USER_PERMISSIONS_VERSION,
    p: input.active ? rulesPermissionMap(input.permissions) : {},
    userDocId: input.userDocId,
    roleNames: [...new Set(input.roleNames)].sort(),
    projectIds: [...new Set(input.projectIds)].sort(),
    departmentIds: [...new Set(input.departmentIds)].sort(),
    active: input.active,
    computedAtIso: (input.now ?? new Date()).toISOString(),
  };
}
