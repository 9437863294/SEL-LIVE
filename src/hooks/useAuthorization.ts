
import { useAuth } from '@/components/auth/AuthProvider';

export const useAuthorization = () => {
  const { permissions } = useAuth();

  const can = (action: string, module: string): boolean => {
    if (!permissions) {
      return false;
    }
    
    // The module key could be simple "Role Management" or nested "Daily Requisition.Entry Sheet"
    // For simplicity, we assume the key is passed correctly.
    const modulePermissions = permissions[module];

    if (!modulePermissions) {
      return false;
    }

    return modulePermissions.includes(action);
  };

  return { can };
};
