

'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { User, Role } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';


interface AuthContextType {
  user: User | null;
  users: User[];
  permissions: Record<string, string[]>;
  loading: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  refreshUserData: () => Promise<void>;
  sessionRemainingTime: number | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  users: [],
  permissions: {},
  loading: true,
  isImpersonating: false,
  originalUser: null,
  refreshUserData: async () => {},
  sessionRemainingTime: null,
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [sessionRemainingTime, setSessionRemainingTime] = useState<number | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = useCallback(async (isSessionExpired = false) => {
    try {
        await signOut(auth);
        sessionStorage.clear();
        if (isSessionExpired) {
            toast({
                title: 'Session Expired',
                description: 'You have been logged out due to inactivity.',
                variant: 'destructive',
            });
        }
        router.push('/login');
    } catch (error) {
        console.error('Error signing out:', error);
    }
  }, [router, toast]);


  const fetchUserData = useCallback(async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
    if (!firebaseUser) {
        setUser(null);
        setPermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
        sessionStorage.removeItem('impersonationUserId');
        sessionStorage.removeItem('originalAdminUser');
        setLoading(false);
        return null;
    }

    try {
        const allUsersSnap = await getDocs(collection(db, 'users'));
        const allUsersData = allUsersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(allUsersData);
      
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
            return userData;
        } else {
            console.error("User document not found for UID:", userToLoadId);
            await handleSignOut();
            return null;
        }

    } catch (error) {
        console.error("Error fetching user data:", error);
        setUser(null);
        setPermissions({});
        return null;
    } finally {
        setLoading(false);
    }
  }, [handleSignOut]);
  
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
            if (!sessionStorage.getItem('loginTimestamp')) {
              sessionStorage.setItem('loginTimestamp', Date.now().toString());
            }
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
            sessionStorage.removeItem('loginTimestamp');
            setSessionRemainingTime(null);
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
    let interval: NodeJS.Timeout | undefined;

    if (user) {
      const startSessionTimer = () => {
        const loginTimestamp = parseInt(sessionStorage.getItem('loginTimestamp') || Date.now().toString(), 10);
        // Use user's theme setting, with a fallback to 60 minutes
        const sessionDurationMinutes = user.theme?.sessionDuration || 60;
        const sessionDurationMs = sessionDurationMinutes * 60 * 1000;
        const expiryTimestamp = loginTimestamp + sessionDurationMs;

        const checkSession = () => {
          const now = Date.now();
          const remainingMs = expiryTimestamp - now;
          
          if (remainingMs <= 0) {
            setSessionRemainingTime(0);
            handleSignOut(true); // isSessionExpired = true
            if (interval) clearInterval(interval);
          } else {
            setSessionRemainingTime(Math.round(remainingMs / 1000));
          }
        };
        
        if (interval) clearInterval(interval);
        checkSession(); // Initial check
        interval = setInterval(checkSession, 1000);
      };
      
      startSessionTimer();
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [user, handleSignOut]);

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
    <AuthContext.Provider value={{ user, users, permissions, loading, refreshUserData, isImpersonating, originalUser, sessionRemainingTime }}>
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
