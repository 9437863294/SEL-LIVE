
import { useAuth } from '@/components/auth/AuthProvider';

export const useAuthorization = () => {
  const { permissions } = useAuth();

  const can = (action: string, module: string, subModule?: string): boolean => {
    if (!permissions) {
      return false;
    }

    const moduleKey = subModule ? `${module}.${subModule}` : module;

    const modulePermissions = permissions[moduleKey];

    if (!modulePermissions) {
      return false;
    }

    return modulePermissions.includes(action);
  };

  return { can };
};
