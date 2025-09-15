
import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback } from 'react';

export const useAuthorization = () => {
  const { permissions, loading } = useAuth();

  const can = useCallback((action: string, module: string): boolean => {
    if (loading) {
      return false; // Don't grant permission while permissions are loading
    }

    const moduleKeyParts = module.split('.');
    let modulePermissions: string[] | undefined;

    if (moduleKeyParts.length > 1) {
        // Handle nested modules like 'Daily Requisition.Entry Sheet'
        const mainModule = moduleKeyParts[0];
        const subModule = moduleKeyParts.slice(1).join('.');
        
        // This is a simplification. The permissions object keys are 'Module.SubModule'
        const fullKey = `${mainModule}.${subModule}`;
        modulePermissions = permissions[fullKey];

    } else {
       modulePermissions = permissions[module];
    }
    
    if (!modulePermissions) {
      return false;
    }

    return modulePermissions.includes(action);
  }, [permissions, loading]);

  return { can, isLoading: loading };
};
