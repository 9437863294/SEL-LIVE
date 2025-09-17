
'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { User, Role } from '@/lib/types';


interface AuthContextType {
  user: User | null;
  permissions: Record<string, string[]>;
  loading: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  refreshUserData: () => Promise<void>; // Kept for manual refresh if needed, but not used in the loop
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  permissions: {},
  loading: true,
  isImpersonating: false,
  originalUser: null,
  refreshUserData: async () => {},
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

        if (impersonationUserId && storedOriginalUser) {
            const originalAdminData = JSON.parse(storedOriginalUser) as User;
            if (firebaseUser.uid === originalAdminData.id) {
                userToLoadId = impersonationUserId;
                setOriginalUser(originalAdminData);
                isImpersonationSession = true;
            } else {
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
            console.error("User document not found for UID:", userToLoadId);
            setUser(null);
            setPermissions({});
            await auth.signOut();
        }

    } catch (error) {
        console.error("Error fetching user data:", error);
        setUser(null);
        setPermissions({});
    } finally {
        setLoading(false);
    }
  }, []);
  
  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    await fetchUserData(firebaseUser);
  }, [fetchUserData]);

  useEffect(() => {
    let currentUserId: string | null = null;
    
    const handleBeforeUnload = () => {
        if (currentUserId) {
            const userDocRef = doc(db, 'users', currentUserId);
            updateDoc(userDocRef, { isOnline: false, lastSeen: serverTimestamp() });
        }
    };

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        setLoading(true);
        if (firebaseUser) {
            currentUserId = firebaseUser.uid;
            await updateDoc(doc(db, 'users', currentUserId), { isOnline: true, lastSeen: serverTimestamp() });
            await fetchUserData(firebaseUser);
        } else {
            if (currentUserId) {
                handleBeforeUnload();
            }
            currentUserId = null;
            setUser(null);
            setPermissions({});
            setLoading(false);
        }
    });

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
        unsubscribe();
        window.removeEventListener('beforeunload', handleBeforeUnload);
        handleBeforeUnload();
    };
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

  return (
    <AuthContext.Provider value={{ user, permissions, loading, refreshUserData, isImpersonating, originalUser }}>
        {isPublicRoute || !loading ? children : null}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
