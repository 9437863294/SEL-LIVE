
'use client';

import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { User, Role, SavedUser } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PinSetupDialog } from './PinSetupDialog';
import { SessionExpiryDialog } from './SessionExpiryDialog';

// Session configuration
const SESSION_CHECK_INTERVAL = 60000; // Check every minute

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

const publicRoutes = ['/login', '/print-auth'];

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

  // Refs for managing timeouts and avoiding stale closures
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleSignOut = useCallback(async (isExpired = false) => {
    try {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      
      await signOut(auth);
      
      if (!isExpired) {
        sessionStorage.clear();
      }
      
      if (isExpired) {
        toast({
          title: 'Session Expired',
          description: 'Your session has expired. Please log in again.',
          variant: 'destructive',
        });
      }
      
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: 'Error',
        description: 'Failed to sign out. Please try again.',
        variant: 'destructive',
      });
    }
  }, [router, toast]);


  const resetTimeouts = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    const sessionDurationMinutes = user?.theme?.sessionDuration || 60;
    const SESSION_TIMEOUT = sessionDurationMinutes * 60 * 1000;
    const WARNING_TIME = 1 * 60 * 1000; 
    
    // Set a timeout to show the warning dialog
    warningTimeoutRef.current = setTimeout(() => {
        setIsSessionExpired(true);
    }, SESSION_TIMEOUT - WARNING_TIME);
    
    // Set a timeout to log the user out
    timeoutRef.current = setTimeout(() => {
        handleSignOut(true);
    }, SESSION_TIMEOUT);
  }, [user, handleSignOut]);

  const extendSession = useCallback(() => {
    sessionStorage.setItem('lastActivity', Date.now().toString());
    setIsSessionExpired(false);
    resetTimeouts();
  }, [resetTimeouts]);
  
  const loadSavedUsers = useCallback(() => {
    try {
      const storedUsers = localStorage.getItem('savedUsers');
      if (storedUsers) {
        const parsed = JSON.parse(storedUsers);
        setSavedUsers(Array.isArray(parsed) ? parsed : []);
      }
    } catch (error) {
      console.error('Failed to load saved users from localStorage', error);
      setSavedUsers([]);
    }
  }, []);

  const clearSavedUsers = useCallback(() => {
    try {
      localStorage.removeItem('savedUsers');
      setSavedUsers([]);
    } catch (error) {
      console.error('Failed to clear saved users', error);
    }
  }, []);
  
  const fetchUserData = useCallback(async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
    if (!firebaseUser) {
      setUser(null);
      setPermissions({});
      setOriginalUser(null);
      setIsImpersonating(false);
      return null;
    }

    try {
      // Fetch all users for impersonation dropdown
      const allUsersSnap = await getDocs(collection(db, 'users'));
      const allUsersData = allUsersSnap.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as User));
      setUsers(allUsersData);
      
      // Check for impersonation session
      const impersonationUserId = sessionStorage.getItem('impersonationUserId');
      const storedOriginalUser = sessionStorage.getItem('originalAdminUser');

      let userToLoadId = firebaseUser.uid;
      let isImpersonationSession = false;

      if (impersonationUserId && storedOriginalUser) {
        try {
          const originalAdminData = JSON.parse(storedOriginalUser) as User;
          if (firebaseUser.uid === originalAdminData.id) {
            userToLoadId = impersonationUserId;
            setOriginalUser(originalAdminData);
            isImpersonationSession = true;
          } else {
            // Clear invalid impersonation data
            sessionStorage.removeItem('impersonationUserId');
            sessionStorage.removeItem('originalAdminUser');
          }
        } catch (parseError) {
          console.error('Error parsing stored original user', parseError);
          sessionStorage.removeItem('impersonationUserId');
          sessionStorage.removeItem('originalAdminUser');
        }
      }
      
      setIsImpersonating(isImpersonationSession);

      // Fetch user document
      const userDocRef = doc(db, 'users', userToLoadId);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        console.error('User document not found for UID:', userToLoadId);
        await handleSignOut();
        return null;
      }

      const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
      setUser(userData);
      
      // Initialize session timestamp if not exists
      if (!sessionStorage.getItem('lastActivity')) {
        extendSession();
      }
      
      // Handle PIN setup for remembered users
      if (shouldRemember && !isImpersonationSession) {
        try {
          const currentSavedUsers: SavedUser[] = JSON.parse(
            localStorage.getItem('savedUsers') || '[]'
          );
          const userIsSaved = currentSavedUsers.some(u => u.id === userData.id);
          
          if (!userIsSaved) {
            setUserForPinSetup(userData);
            setIsPinSetupOpen(true);
          }
        } catch (error) {
          console.error('Error checking saved users', error);
        }
        
        setShouldRemember(false);
      }

      // Fetch user role and permissions
      if (userData.role) {
        const rolesQuery = query(
          collection(db, 'roles'), 
          where('name', '==', userData.role)
        );
        const roleSnap = await getDocs(rolesQuery);
        
        if (!roleSnap.empty) {
          const roleData = roleSnap.docs[0].data() as Role;
          setPermissions(roleData.permissions || {});
        } else {
          console.warn(`Role '${userData.role}' not found.`);
          setPermissions({});
        }
      } else {
        console.warn('User has no role assigned.');
        setPermissions({});
      }
      
      return userData;
    } catch (error) {
      console.error('Error fetching user data:', error);
      setUser(null);
      setPermissions({});
      
      toast({
        title: 'Error',
        description: 'Failed to load user data. Please try logging in again.',
        variant: 'destructive',
      });
      
      return null;
    }
  }, [handleSignOut, shouldRemember, extendSession, toast]);

  
  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    await fetchUserData(firebaseUser);
  }, [fetchUserData]);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true); // Set loading to true at the start of auth state change
      if (firebaseUser) {
        await fetchUserData(firebaseUser);
        // After fetching, if we're on login, we should redirect
        if (pathname === '/login') {
            router.replace('/');
        }
      } else {
        setUser(null);
        setPermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
        if (!publicRoutes.includes(pathname) && !pathname.startsWith('/billing-recon/')) {
          router.push('/login');
        }
      }
      setLoading(false); // Set loading to false after all operations
    });

    return () => unsubscribeAuth();
  }, [fetchUserData, pathname, router]);

  // Activity listener to extend session
  useEffect(() => {
    if (!user) return;
    
    // Immediately reset timers when the user object (and their settings) becomes available
    resetTimeouts();

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll'];
    activityEvents.forEach(event => window.addEventListener(event, extendSession));

    return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
        activityEvents.forEach(event => window.removeEventListener(event, extendSession));
    };
  }, [user, extendSession, resetTimeouts]);


  const contextValue: AuthContextType = {
    user,
    users,
    permissions,
    loading,
    isImpersonating,
    originalUser,
    refreshUserData,
    isSessionExpired,
    setIsSessionExpired,
    extendSession,
    handleSignOut,
    savedUsers,
    setShouldRemember,
    clearSavedUsers,
    loadSavedUsers,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      {userForPinSetup && (
        <PinSetupDialog
          user={userForPinSetup}
          isOpen={isPinSetupOpen}
          onOpenChange={setIsPinSetupOpen}
          onPinSet={loadSavedUsers}
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
