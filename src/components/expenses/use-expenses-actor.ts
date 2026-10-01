'use client';

/**
 * The one place an Expenses gate asks "may I?".
 *
 * Authority in this application is a lookup over the merged permission map
 * (`useAuthorization().can`), which knows nothing about who an administrator has made responsible
 * for what. Expenses now has that second answer of its own — Settings › User Roles, stored as
 * `expensesSettings/user-roles` and resolved by `src/lib/expenses-roles.ts`. This hook puts the two
 * together so no screen has to:
 *
 *   `can(action, section, scope)` → `hasPermission` → `mayAct(assignment, actor, hasPermission, ctx)`
 *
 * The decision function is the module's, not this file's — the rules of widening (`assigned-too`)
 * and narrowing (`assigned-only`) live in `expenses-roles.ts` and are tested there. All this does
 * is gather the three inputs and name the permission each action is gated by.
 *
 * With no document saved every action resolves to `mode: 'roles-only'`, where `mayAct` returns the
 * permission verdict unchanged — so every screen behaves exactly as it did before this existed,
 * and reads nothing extra from Firestore either (see `needsRoleIds`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useExpensesRoles } from '@/components/expenses/use-expenses-roles';
import {
  EXPENSES_ACTIONS,
  assignmentFor,
  emptyAssignment,
  expensesAction,
  hasActors,
  mayAct,
  type ActionContext,
  type ActionDecision,
  type ExpensesActionAssignment,
  type ExpensesActionKey,
} from '@/lib/expenses-roles';

/**
 * Role doc ids by lower-cased role name, loaded once per session.
 *
 * A by-role assignment names roles by document id (the convention the access-management screens
 * use), while the session only knows the *names* of the roles in force. One small read bridges
 * them, and only when some action is actually assigned by role — so the default set-up costs
 * nothing. A failure is not fatal: the names alone still match an assignment that stored names.
 */
let roleIdPromise: Promise<Record<string, string>> | null = null;

const loadRoleIdsByName = (): Promise<Record<string, string>> => {
  roleIdPromise ??= getDocs(collection(db, 'roles'))
    .then(snap =>
      Object.fromEntries(
        snap.docs
          .map(roleDoc => [String((roleDoc.data() as { name?: string }).name ?? '').trim().toLowerCase(), roleDoc.id])
          .filter(([name]) => name !== ''),
      ),
    )
    .catch(error => {
      // Let the next caller try again rather than caching the failure for the session.
      roleIdPromise = null;
      console.warn('Expenses: could not read roles for a by-role assignment', error);
      return {};
    });
  return roleIdPromise;
};

export interface ExpensesActor {
  /** May the signed-in user perform this action here? `context` carries the department and amount. */
  may: (actionKey: ExpensesActionKey, context?: ActionContext) => ActionDecision;
  /**
   * The same question where the caller already has its own answer for the role half — for the few
   * gates that accept more than the action's own permission (a legacy fallback, a global auditor).
   */
  mayWith: (actionKey: ExpensesActionKey, hasPermission: boolean, context?: ActionContext) => ActionDecision;
  /** The stored assignment, for a screen that needs to say who is on it. */
  assignment: (actionKey: ExpensesActionKey) => ExpensesActionAssignment;
  /**
   * Whether a refusal of this action is the assignment's doing rather than the permission's — the
   * one case where a caller's own fallback must not override it.
   */
  restrictedToAssignees: (actionKey: ExpensesActionKey, context?: ActionContext) => boolean;
  isLoading: boolean;
}

export function useExpensesActor(): ExpensesActor {
  const { user, effectiveAccess } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { doc: rolesDoc, isLoading: isRolesLoading } = useExpensesRoles();

  /** Only a by-role assignment that is actually being enforced needs role ids resolving. */
  const needsRoleIds = useMemo(
    () =>
      EXPENSES_ACTIONS.some(def => {
        const assignment = assignmentFor(rolesDoc, def.key);
        return assignment.type === 'roles' && assignment.mode !== 'roles-only';
      }),
    [rolesDoc],
  );

  const [roleIdsByName, setRoleIdsByName] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!needsRoleIds) return;
    let alive = true;
    void loadRoleIdsByName().then(map => {
      if (alive) setRoleIdsByName(map);
    });
    return () => {
      alive = false;
    };
  }, [needsRoleIds]);

  /**
   * Every role the user holds, by id *and* by name — an assignment saved either way still matches,
   * and neither can be confused for a user id.
   */
  const roleIds = useMemo(() => {
    const names = effectiveAccess?.effectiveRoleNames?.length
      ? effectiveAccess.effectiveRoleNames
      : user?.role
        ? [user.role]
        : [];
    const ids = names.map(name => roleIdsByName[name.trim().toLowerCase()]).filter(Boolean) as string[];
    return [...new Set([...names, ...ids])];
  }, [effectiveAccess, user, roleIdsByName]);

  const userId = user?.id ?? '';

  /**
   * While the assignment is still loading the action is treated as `roles-only`, so a gate shows
   * what the permission map says and does not flicker open or shut when the document arrives.
   */
  const assignment = useCallback(
    (actionKey: ExpensesActionKey): ExpensesActionAssignment =>
      isRolesLoading ? emptyAssignment() : assignmentFor(rolesDoc, actionKey),
    [isRolesLoading, rolesDoc],
  );

  const mayWith = useCallback(
    (actionKey: ExpensesActionKey, hasPermission: boolean, context: ActionContext = {}): ActionDecision =>
      mayAct(assignment(actionKey), { userId, roleIds }, hasPermission, context),
    [assignment, userId, roleIds],
  );

  const may = useCallback(
    (actionKey: ExpensesActionKey, context: ActionContext = {}): ActionDecision => {
      const def = expensesAction(actionKey);
      if (!def) {
        // An unknown key must not invent authority of its own.
        return mayWith(actionKey, false, context);
      }
      // A department-scoped action is checked against `Expenses.Departments.<deptId>`, which is what
      // `can`'s third argument is for — exactly as the bare checks this replaces did.
      const hasPermission = can(
        def.permission.action,
        def.permission.section,
        def.departmentScoped ? context.departmentId : undefined,
      );
      return mayWith(actionKey, hasPermission, context);
    },
    [can, mayWith],
  );

  const restrictedToAssignees = useCallback(
    (actionKey: ExpensesActionKey, context: ActionContext = {}): boolean => {
      const held = assignment(actionKey);
      return held.mode === 'assigned-only' && hasActors(held, context);
    },
    [assignment],
  );

  return { may, mayWith, assignment, restrictedToAssignees, isLoading: isAuthLoading || isRolesLoading };
}
