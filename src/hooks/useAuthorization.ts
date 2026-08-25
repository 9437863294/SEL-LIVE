
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useMemo } from 'react';
import {
  canAccessModule as canAccessModuleFor,
  canAccessPage as canAccessPageFor,
  explainPermission as explainPermissionFor,
  getEffectivePermissions as getEffectivePermissionsFor,
  getPermissionSources as getPermissionSourcesFor,
  type PermissionExplanation,
  type PermissionRef,
  type PermissionSource,
} from '@/lib/access-control';

export const useAuthorization = () => {
  const { permissions, effectiveAccess, loading } = useAuth();

  const can = useCallback((action: string, resource: string, scope?: string): boolean => {
    if (loading) {
      return false; 
    }

    const checkPermissions = (permissionSet: Record<string, any>, resourceParts: string[]): boolean => {
      const currentPart = resourceParts[0];
      const remainingParts = resourceParts.slice(1);
      
      if (!permissionSet || !permissionSet.hasOwnProperty(currentPart)) {
        return false;
      }
      
      const nextPermissionSet = permissionSet[currentPart];

      if (remainingParts.length === 0) {
        // This is the final level, check for the action
        if (Array.isArray(nextPermissionSet)) {
          return nextPermissionSet.includes(action);
        }
        // This handles cases like `can('View', 'Some Module.View Module')` which isn't standard
        // but the original hook was trying to support. A direct check is better.
        if (typeof nextPermissionSet === 'object' && nextPermissionSet !== null && !Array.isArray(nextPermissionSet) && action in nextPermissionSet) {
          return true;
        }
        return false;
      }
      
      // Recurse into the next level
      if (typeof nextPermissionSet === 'object' && nextPermissionSet !== null && !Array.isArray(nextPermissionSet)) {
        return checkPermissions(nextPermissionSet, remainingParts);
      }
      
      return false;
    };

    // Backward-compatible permission aliases for legacy role documents.
    const resourceAliasMap: Record<string, string[]> = {
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

    const candidateResources = (() => {
      const reverseAliases = Object.entries(resourceAliasMap)
        .filter(([, aliases]) => aliases.includes(resource))
        .map(([canonical]) => canonical);

      return Array.from(
        new Set([
          resource,
          ...(resourceAliasMap[resource] || []),
          ...reverseAliases,
        ])
      );
    })();
    
    // Check for direct scoped permission first, e.g., 'Expenses.Departments.dept_id_123'
    if (scope) {
      for (const candidateResource of candidateResources) {
        const scopedResourceKey = `${candidateResource}.${scope}`;
        if (permissions[scopedResourceKey]?.includes(action)) {
            return true;
        }
      }
    }
    
    // Check for 'View All' which grants 'View' on all scopes.
    if (action === 'View' && scope) {
      const viewAllModule = resource.split('.')[0];
      if (permissions[viewAllModule]?.includes('View All')) {
        return true;
      }
    }

    // New recursive check for nested permissions
    for (const candidateResource of candidateResources) {
      const resourceParts = candidateResource.split('.');
      if (checkPermissions(permissions, resourceParts)) {
        return true;
      }
    }

    // Original direct check for simple top-level permissions
    for (const candidateResource of candidateResources) {
      if (permissions[candidateResource]?.includes(action)) {
        return true;
      }
    }

    return false;
  }, [permissions, loading]);

  /* ------------------------------------------------------------------------------------------
   * The §19 vocabulary.
   *
   * `can` stays exactly as it was — several hundred call sites depend on its behaviour, including
   * the alias map for renamed permission nodes that `hasPermission` in access-control.ts does not
   * carry. Everything below is additional, and reads from the same effective permission set that
   * now includes the additive layer.
   *
   * The point of having these at all is the one §20 makes: `if (user.role === "admin")` does not
   * survive a system where a user can hold five roles. `canPerformAction(...)` does.
   * ---------------------------------------------------------------------------------------- */

  /** Holds at least one of these. */
  const hasAnyPermission = useCallback(
    (refs: PermissionRef[]): boolean => refs.some((ref) => can(ref.action, ref.resource, ref.scope)),
    [can],
  );

  /** Holds every one of these. */
  const hasAllPermissions = useCallback(
    (refs: PermissionRef[]): boolean => refs.every((ref) => can(ref.action, ref.resource, ref.scope)),
    [can],
  );

  /** Can open this module at all — including via a page-level grant with no explicit View Module. */
  const canAccessModule = useCallback(
    (moduleName: string): boolean => {
      if (loading) return false;
      return can('View Module', moduleName) || canAccessModuleFor(permissions, moduleName);
    },
    [can, loading, permissions],
  );

  /** Holds any action at all on this page. */
  const canAccessPage = useCallback(
    (resource: string, scope?: string): boolean => {
      if (loading) return false;
      return canAccessPageFor(permissions, resource, scope);
    },
    [loading, permissions],
  );

  /** Reads better than `can` at action call sites, with the arguments the other way round. */
  const canPerformAction = useCallback(
    (resource: string, action: string, scope?: string): boolean => can(action, resource, scope),
    [can],
  );

  const getEffectivePermissions = useCallback(
    () => getEffectivePermissionsFor(permissions),
    [permissions],
  );

  /** Where a permission came from. Empty when the user does not hold it. */
  const getPermissionSources = useCallback(
    (resource: string, action: string): PermissionSource[] =>
      getPermissionSourcesFor(effectiveAccess, resource, action),
    [effectiveAccess],
  );

  /** The sentence behind "Why do I have this?" — see §44. */
  const explainPermission = useCallback(
    (resource: string, action: string): PermissionExplanation =>
      explainPermissionFor(effectiveAccess, resource, action),
    [effectiveAccess],
  );

  /** Handy for debug panels and the access screens; not for permission checks. */
  const roleNames = useMemo(() => effectiveAccess?.effectiveRoleNames ?? [], [effectiveAccess]);

  return {
    can,
    isLoading: loading,
    hasPermission: canPerformAction,
    hasAnyPermission,
    hasAllPermissions,
    canAccessModule,
    canAccessPage,
    canPerformAction,
    getEffectivePermissions,
    getPermissionSources,
    explainPermission,
    effectiveAccess,
    roleNames,
  };
};
