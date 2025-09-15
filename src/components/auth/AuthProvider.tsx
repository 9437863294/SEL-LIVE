
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
  const [authChecked, setAuthChecked] = useState(false);
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
                 setPermissions({});
            }
        } else {
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
        setAuthChecked(false);
        setLoading(true);
        fetchUserData(firebaseUser).then(() => {
            setAuthChecked(true);
        });
    });
    return () => unsubscribe();
  }, [fetchUserData]);

  useEffect(() => {
    if (!authChecked) return;

    const isPublicRoute = publicRoutes.includes(pathname);

    if (!user && !isPublicRoute) {
      router.push('/login');
    } else if (user && isPublicRoute) {
      router.push('/');
    }
  }, [user, authChecked, router, pathname]);
  
  const isPublicRoute = publicRoutes.includes(pathname);

  if (loading || (!authChecked && !isPublicRoute)) {
     return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    );
  }

  if ((user && !isPublicRoute) || (!user && isPublicRoute)) {
     return (
        <AuthContext.Provider value={{ user, permissions, loading, refreshUserData }}>
            {children}
        </AuthContext.Provider>
    );
  }

  return null;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
