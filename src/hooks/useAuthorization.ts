

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback } from 'react';

export const useAuthorization = () => {
  const { permissions, loading } = useAuth();

  const can = useCallback((action: string, module: string, scope?: string): boolean => {
    if (loading) {
      return false; 
    }
    
    // Direct check for simple modules or top-level module actions
    if (permissions[module]?.includes(action)) {
      return true;
    }

    // Check for nested "View Module" permission, e.g., permissions['Expenses']['View Module']
    if (action === 'View Module' && permissions[module] && typeof permissions[module] === 'object' && !Array.isArray(permissions[module])) {
      const nestedPermissions = permissions[module] as Record<string, string[]>;
      if (nestedPermissions['View Module']) {
        return true;
      }
    }
    
    // Check for scoped permissions, e.g., Expenses.Departments.dept_id_123
    const scopedPermissionKey = scope ? `${module}.${scope}` : module;
    if (scope && permissions[scopedPermissionKey]?.includes(action)) {
      return true;
    }

    // Fallback for sub-module actions without a scope, e.g., can('View', 'Expenses.Reports')
    if (module.includes('.') && permissions[module]?.includes(action)) {
        return true;
    }

    // Special check for 'View All' which grants 'View' on all scopes within that module
    if (action === 'View' && scope) {
      const viewAllModule = module.split('.')[0]; // e.g., 'Expenses' from 'Expenses.Departments'
      if (permissions[viewAllModule]?.includes('View All')) {
        return true;
      }
    }
    
    return false;
  }, [permissions, loading]);

  return { can, isLoading: loading };
};
