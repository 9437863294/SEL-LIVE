
'use client';

import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { User, Role, SavedUser } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PinSetupDialog } from './PinSetupDialog';
import { SessionExpiryDialog } from './SessionExpiryDialog';


interface AuthContextType {
  user: User | null;
  users: User[];
  permissions: Record<string, string[]>;
  loading: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  refreshUserData: () => Promise<void>;
  isSessionExpired: boolean;
  setIsSessionExpired: (isExpired: boolean) => void;
  extendSession: () => void;
  handleSignOut: (isSessionExpired?: boolean) => Promise<void>;
  // PIN login related state
  savedUsers: SavedUser[];
  setShouldRemember: (shouldRemember: boolean) => void;
  clearSavedUsers: () => void;
  loadSavedUsers: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  users: [],
  permissions: {},
  loading: true,
  isImpersonating: false,
  originalUser: null,
  refreshUserData: async () => {},
  isSessionExpired: false,
  setIsSessionExpired: () => {},
  extendSession: () => {},
  handleSignOut: async () => {},
  savedUsers: [],
  setShouldRemember: () => {},
  clearSavedUsers: () => {},
  loadSavedUsers: () => {},
});

const publicRoutes = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  // PIN login state
  const [savedUsers, setSavedUsers] = useState<SavedUser[]>([]);
  const [shouldRemember, setShouldRemember] = useState(false);
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [userForPinSetup, setUserForPinSetup] = useState<User | null>(null);


  const handleSignOut = useCallback(async (isExpired = false) => {
    try {
        await signOut(auth);
        if (!isExpired) {
            sessionStorage.clear();
        }
        if (isExpired) {
            toast({
                title: 'Session Expired',
                description: 'You have been logged out.',
                variant: 'destructive',
            });
        }
        router.push('/login');
    } catch (error) {
        console.error('Error signing out:', error);
    }
  }, [router, toast]);
  
  const extendSession = useCallback(() => {
    sessionStorage.setItem('loginTimestamp', Date.now().toString());
    setIsSessionExpired(false);
  }, []);

  const loadSavedUsers = useCallback(() => {
    try {
      const storedUsers = localStorage.getItem('savedUsers');
      if (storedUsers) {
        setSavedUsers(JSON.parse(storedUsers));
      }
    } catch (error) {
      console.error("Failed to load saved users from localStorage", error);
    }
  }, []);

  const clearSavedUsers = useCallback(() => {
    localStorage.removeItem('savedUsers');
    setSavedUsers([]);
  }, []);

  const fetchUserData = useCallback(async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
    if (!firebaseUser) {
        setUser(null);
        setPermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
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
            
            // Set the initial session timestamp right after fetching user data
            if (!sessionStorage.getItem('loginTimestamp')) {
              extendSession();
            }
            
            if (shouldRemember && !isImpersonationSession) {
              const currentSavedUsers: SavedUser[] = JSON.parse(localStorage.getItem('savedUsers') || '[]');
              const userIsSaved = currentSavedUsers.some(u => u.id === userData.id);
              if (!userIsSaved) {
                setUserForPinSetup(userData);
                setIsPinSetupOpen(true);
              }
              setShouldRemember(false); // Reset after handling
            }


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
  }, [handleSignOut, shouldRemember, extendSession]);
  
  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    await fetchUserData(firebaseUser);
  }, [fetchUserData]);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
            await fetchUserData(firebaseUser);
        } else {
            setUser(null);
            setPermissions({});
            setOriginalUser(null);
            setIsImpersonating(false);
            setLoading(false);
            if (!publicRoutes.includes(pathname)) {
                router.push('/login');
            }
        }
    });

    return () => unsubscribeAuth();
  }, [fetchUserData, pathname, router]);


  return (
    <AuthContext.Provider value={{ user, users, permissions, loading, refreshUserData, isImpersonating, originalUser, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut, savedUsers, setShouldRemember, clearSavedUsers, loadSavedUsers }}>
        {children}
        {userForPinSetup && (
            <PinSetupDialog
                user={userForPinSetup}
                isOpen={isPinSetupOpen}
                onOpenChange={setIsPinSetupOpen}
                onPinSet={loadSavedUsers} // Refresh saved users after setting a PIN
            />
        )}
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
