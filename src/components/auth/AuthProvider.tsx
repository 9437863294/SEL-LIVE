
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
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  permissions: {},
  loading: true,
  refreshUserData: async () => {},
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUserData = useCallback(async (firebaseUser: FirebaseUser | null) => {
    if (firebaseUser) {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
        setUser(userData);

        if (userData.role) {
            const rolesQuery = query(collection(db, 'roles'), where('name', '==', userData.role));
            const roleSnap = await getDocs(rolesQuery);
            if (!roleSnap.empty) {
                const roleData = roleSnap.docs[0].data() as Role;
                setPermissions(roleData.permissions || {});
            } else {
                 console.warn(`Role '${userData.role}' not found for user ${userData.email}.`);
                 setPermissions({});
            }
        } else {
            console.warn(`User ${userData.email} has no role assigned.`);
            setPermissions({});
        }

      } else {
        console.error("User document not found in Firestore for UID:", firebaseUser.uid);
        setUser(null);
        setPermissions({});
      }
    } else {
      setUser(null);
      setPermissions({});
    }
    setLoading(false);
  }, []);

  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
        setLoading(true);
        await fetchUserData(firebaseUser);
    }
  }, [fetchUserData]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        setLoading(true);
        fetchUserData(firebaseUser);
    });
    return () => unsubscribe();
  }, [fetchUserData]);

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
        <AuthContext.Provider value={{ user, permissions, loading, refreshUserData }}>
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
