
'use client';

import * as React from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Header from '@/components/Header';
import { doc, getDoc } from 'firebase/firestore';
import type { User } from '@/lib/types';


interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  loading: true,
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        // User is signed in, fetch their profile from Firestore
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);
        } else {
          // Handle case where user exists in Auth but not in Firestore
          // For now, we'll treat them as partially logged in
          console.error("User document not found in Firestore for UID:", firebaseUser.uid);
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || firebaseUser.email || 'User',
            photoURL: firebaseUser.photoURL || undefined,
            // Fill with default values
            mobile: 'N/A',
            role: 'User',
            status: 'Active',
          });
        }
      } else {
        // User is signed out
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    if (loading) return;

    const isPublicRoute = publicRoutes.includes(pathname);

    if (!user && !isPublicRoute) {
      router.push('/login');
    } else if (user && isPublicRoute) {
      router.push('/');
    }
  }, [user, loading, router, pathname]);
  
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const isPublicRoute = publicRoutes.includes(pathname);

  // While redirecting, show a loader to prevent flicker
  if ((!user && !isPublicRoute) || (user && isPublicRoute)) {
    return (
       <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
       </div>
    );
  }
  
  if (isPublicRoute) {
     return <main>{children}</main>;
  }


  return (
    <AuthContext.Provider value={{ user, loading }}>
        <div className="relative flex min-h-screen flex-col bg-background">
            <Header />
            <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
        </div>
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
