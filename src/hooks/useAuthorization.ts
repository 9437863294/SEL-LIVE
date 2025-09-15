
import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback } from 'react';

export const useAuthorization = () => {
  const { permissions, loading } = useAuth();

  const can = useCallback((action: string, module: string, scope?: string): boolean => {
    if (loading) {
      return false; 
    }

    // Module.SubModule.Scope -> e.g. Expenses.Departments.dept_id_123
    const scopedPermissionKey = scope ? `${module}.${scope}` : module;

    // Check for scoped permission first
    if (scope && permissions[scopedPermissionKey]?.includes(action)) {
      return true;
    }
    
    // Fallback to general module permission
    const modulePermissions = permissions[module];
    if (modulePermissions?.includes(action)) {
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
