
'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import type { User, Role } from '@/lib/types';


interface AuthContextType {
  user: User | null;
  permissions: Record<string, string[]>;
  loading: boolean;
  refreshUserData: () => Promise<void>;
  isImpersonating: boolean;
  originalUser: User | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  permissions: {},
  loading: true,
  refreshUserData: async () => {},
  isImpersonating: false,
  originalUser: null,
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUserData = useCallback(async (firebaseUser: FirebaseUser | null) => {
    if (!firebaseUser) {
        setUser(null);
        setPermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
        sessionStorage.removeItem('impersonationUserId');
        sessionStorage.removeItem('originalAdminUser');
        setLoading(false);
        return;
    }

    try {
        const impersonationUserId = sessionStorage.getItem('impersonationUserId');
        const storedOriginalUser = sessionStorage.getItem('originalAdminUser');

        let userToLoadId = firebaseUser.uid;
        let isImpersonationSession = false;

        // Check for an active impersonation session
        if (impersonationUserId && storedOriginalUser) {
            const originalAdminData = JSON.parse(storedOriginalUser) as User;
            // Ensure the currently logged-in Firebase user is the original admin
            if (firebaseUser.uid === originalAdminData.id) {
                userToLoadId = impersonationUserId;
                setOriginalUser(originalAdminData);
                isImpersonationSession = true;
            } else {
                 // Mismatch, clear session and load the actual user
                sessionStorage.removeItem('impersonationUserId');
                sessionStorage.removeItem('originalAdminUser');
            }
        }
        
        setIsImpersonating(isImpersonationSession);

        const userDocRef = doc(db, 'users', userToLoadId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
            setUser(userData);

            // Fetch permissions for the loaded user (original or impersonated)
            if (userData.role) {
                const rolesQuery = query(collection(db, 'roles'), where('name', '==', userData.role));
                const roleSnap = await getDocs(rolesQuery);
                if (!roleSnap.empty) {
                    const roleData = roleSnap.docs[0].data() as Role;
                    setPermissions(roleData.permissions || {});
                } else {
                    console.warn(`Role '${userData.role}' not found.`);
                    setPermissions({});
                }
            } else {
                 console.warn(`User has no role assigned.`);
                 setPermissions({});
            }
        } else {
            // If the user doc doesn't exist, sign out to prevent being stuck.
            console.error("User document not found in Firestore for UID:", userToLoadId);
            setUser(null);
            setPermissions({});
            await auth.signOut();
        }

    } catch (error) {
        console.error("Error during user data fetch:", error);
        setUser(null);
        setPermissions({});
    } finally {
        setLoading(false);
    }
}, []);


  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    setLoading(true);
    if (firebaseUser) {
        await fetchUserData(firebaseUser);
    } else {
        await fetchUserData(null);
    }
    setLoading(false);
  }, [fetchUserData]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        setLoading(true);
        fetchUserData(firebaseUser);
    });

    // Listen for storage changes to sync impersonation state across tabs
    const handleStorageChange = (event: StorageEvent) => {
        if (event.key === 'impersonationUserId' || event.key === 'originalAdminUser') {
            refreshUserData();
        }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
        unsubscribe();
        window.removeEventListener('storage', handleStorageChange);
    };
  }, [fetchUserData, refreshUserData]);

  useEffect(() => {
    if (loading) return;

    const isPublicRoute = publicRoutes.includes(pathname);

    if (!user && !isPublicRoute) {
      router.push('/login');
    } else if (user && isPublicRoute) {
      router.push('/');
    }
  }, [user, loading, router, pathname]);
  
  const isPublicRoute = publicRoutes.includes(pathname);
  if (loading && !isPublicRoute) {
     return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    );
  }

  // Render children only if the route is public, or if loading is finished for a private route
  if (isPublicRoute || !loading) {
     return (
        <AuthContext.Provider value={{ user, permissions, loading, refreshUserData, isImpersonating, originalUser }}>
            {children}
        </AuthContext.Provider>
    );
  }

  // Fallback for private routes while loading
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
    </div>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
