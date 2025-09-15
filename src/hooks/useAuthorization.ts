
import { useAuth } from '@/components/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { Role } from '@/lib/types';
import { useCallback } from 'react';

// Cache to store permissions for a session to reduce Firestore reads.
const permissionsCache = new Map<string, Record<string, string[]>>();

export const useAuthorization = () => {
  const { user } = useAuth();

  const can = useCallback(async (action: string, module: string): Promise<boolean> => {
    if (!user || !user.role) {
      return false;
    }

    let rolePermissions = permissionsCache.get(user.role);

    if (!rolePermissions) {
      try {
        const rolesQuery = query(collection(db, 'roles'), where('name', '==', user.role));
        const roleSnap = await getDocs(rolesQuery);

        if (!roleSnap.empty) {
          const roleData = roleSnap.docs[0].data() as Role;
          rolePermissions = roleData.permissions || {};
          permissionsCache.set(user.role, rolePermissions); // Cache the fetched permissions
        } else {
          console.warn(`Role '${user.role}' not found.`);
          rolePermissions = {};
          permissionsCache.set(user.role, {}); // Cache empty permissions to avoid re-fetching
        }
      } catch (error) {
        console.error("Error fetching role permissions:", error);
        return false;
      }
    }

    const modulePermissions = rolePermissions[module];

    if (!modulePermissions) {
      return false;
    }

    return modulePermissions.includes(action);
  }, [user]);

  return { can };
};
