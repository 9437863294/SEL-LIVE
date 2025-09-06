
'use client';

import * as React from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import type { User } from '@/lib/types';


interface AuthContextType {
  user: User | null;
  loading: boolean;
  refreshUserData: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshUserData: async () => {},
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUserData = React.useCallback(async (firebaseUser: FirebaseUser | null) => {
    if (firebaseUser) {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        setUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);
      } else {
        console.error("User document not found in Firestore for UID:", firebaseUser.uid);
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || firebaseUser.email || 'User',
          photoURL: firebaseUser.photoURL || undefined,
          mobile: 'N/A',
          role: 'User',
          status: 'Active',
        });
      }
    } else {
      setUser(null);
    }
    setLoading(false);
  }, []);

  const refreshUserData = React.useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
        setLoading(true);
        await fetchUserData(firebaseUser);
        setLoading(false);
    }
  }, [fetchUserData]);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, fetchUserData);
    return () => unsubscribe();
  }, [fetchUserData]);

  React.useEffect(() => {
    if (loading) return;

    const isPublicRoute = publicRoutes.includes(pathname);

    if (!user && !isPublicRoute) {
      router.push('/login');
    } else if (user && isPublicRoute) {
      router.push('/');
    }
  }, [user, loading, router, pathname]);
  

  const isPublicRoute = publicRoutes.includes(pathname);
  const showLoader = loading && !isPublicRoute
  const showChildren = !loading && ((user && !isPublicRoute) || (!user && isPublicRoute));

  return (
    <AuthContext.Provider value={{ user, loading, refreshUserData }}>
        {showLoader ? (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        ) : showChildren ? (
            children
        ) : null}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
