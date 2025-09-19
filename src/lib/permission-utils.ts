
import type { Role, Department } from '@/lib/types';
import { permissionModules } from '@/lib/types';


// This function should ideally fetch departments from Firestore if they are dynamic.
// For now, if you have a static or smaller list, you can pass them in.
// If departments are managed in Firestore, this would need to be async.
export const getTotalPermissionsForModule = (moduleName: string, departments: Department[] = []): number => {
    const moduleConfig = permissionModules[moduleName as keyof typeof permissionModules];
    if (!moduleConfig) return 0;
    
    if (Array.isArray(moduleConfig)) {
      return moduleConfig.length;
    }
    
    let total = 0;
    for (const key in moduleConfig) {
      const perms = moduleConfig[key as keyof typeof moduleConfig];
      if (key === 'View Module' && typeof perms === 'boolean' && perms) {
        total += 1;
        continue;
      }
      if (Array.isArray(perms)) {
        if(key === 'Departments' && departments.length > 0) {
          total += perms.length * departments.length;
        } else {
          total += perms.length;
        }
      }
    }
    return total;
  };
  
export const getGrantedPermissionsForModule = (permissions: Record<string, string[]> | undefined, moduleName: string): number => {
    if (!permissions) return 0;
    let count = 0;

    const moduleConfig = permissionModules[moduleName as keyof typeof permissionModules];

    if (Array.isArray(moduleConfig)) {
        // Simple module structure
        if (permissions[moduleName] && Array.isArray(permissions[moduleName])) {
            count += permissions[moduleName].length;
        }
    } else {
        // Complex module structure
        // Count 'View Module' permission if it exists
        if (permissions[moduleName]?.includes('View Module')) {
             count++;
        }
        
        // Count permissions for sub-modules
        Object.keys(moduleConfig).forEach(subModuleKey => {
            if (subModuleKey === 'View Module') return;
            const fullKey = `${moduleName}.${subModuleKey}`;
            
            if (subModuleKey === 'Departments') {
                // Special handling for dynamic department keys
                Object.keys(permissions).forEach(permissionKey => {
                    if (permissionKey.startsWith(fullKey)) { // e.g., 'Expenses.Departments.dept_id_123'
                        if (Array.isArray(permissions[permissionKey])) {
                            count += permissions[permissionKey].length;
                        }
                    }
                });
            } else {
                 if (permissions[fullKey] && Array.isArray(permissions[fullKey])) {
                    count += permissions[fullKey].length;
                }
            }
        });
    }

    return count;
};
