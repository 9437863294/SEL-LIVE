
'use client';

import * as React from 'react';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import type { User, Role, SavedUser } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PinSetupDialog } from './PinSetupDialog';

/* ---------------- types ---------------- */

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

/* ---------------- provider ---------------- */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const [savedUsers, setSavedUsers] = useState<SavedUser[]>([]);
  const [shouldRemember, setShouldRemember] = useState(false);
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [userForPinSetup, setUserForPinSetup] = useState<User | null>(null);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();

  /* ---------- sign out ---------- */

  const handleSignOut = useCallback(
    async (isExpired = false) => {
      try {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

        await signOut(auth);
        
        localStorage.clear();

        if (isExpired) {
          toast({
            title: 'Session Expired',
            description: 'Your session has expired. Please log in again.',
            variant: 'destructive',
          });
        }
        
        // Let ClientSessionHandler component handle redirect
        setUser(null);
        setPermissions({});

      } catch (error) {
        console.error('Error signing out:', error);
        toast({
          title: 'Error',
          description: 'Failed to sign out. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  /* ---------- session timers ---------- */

  const resetTimeouts = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    const sessionDurationMinutes = user?.theme?.sessionDuration || 60;
    const SESSION_TIMEOUT = sessionDurationMinutes * 60 * 1000;
    const WARNING_TIME = 1 * 60 * 1000;

    warningTimeoutRef.current = setTimeout(() => {
      setIsSessionExpired(true);
    }, SESSION_TIMEOUT - WARNING_TIME);

    timeoutRef.current = setTimeout(() => {
      handleSignOut(true);
    }, SESSION_TIMEOUT);
  }, [user, handleSignOut]);

  const extendSession = useCallback(() => {
    localStorage.setItem('lastActivity', Date.now().toString());
    setIsSessionExpired(false);
    resetTimeouts();
  }, [resetTimeouts]);

  /* ---------- saved users helpers ---------- */

  const loadSavedUsers = useCallback(() => {
    try {
      const stored = localStorage.getItem('savedUsers');
      if (!stored) {
        setSavedUsers([]);
        return;
      }
      const parsed = JSON.parse(stored);
      setSavedUsers(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.error('Failed to load saved users', err);
      setSavedUsers([]);
    }
  }, []);

  const clearSavedUsers = useCallback(() => {
    try {
      localStorage.removeItem('savedUsers');
      setSavedUsers([]);
    } catch (err) {
      console.error('Failed to clear saved users', err);
    }
  }, []);

  /* ---------- fetch user + permissions ---------- */

  const fetchUserData = useCallback(
    async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
      if (!firebaseUser) {
        setUser(null);
        setPermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
        return null;
      }

      try {
        // All users list
        const allUsersSnap = await getDocs(collection(db, 'users'));
        const allUsers = allUsersSnap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            } as User)
        );
        setUsers(allUsers);

        // Impersonation
        const impersonationUserId = localStorage.getItem('impersonationUserId');
        const storedOriginalUser = localStorage.getItem('originalAdminUser');

        let userToLoadId = firebaseUser.uid;
        let impersonating = false;

        if (impersonationUserId && storedOriginalUser) {
          try {
            const original = JSON.parse(storedOriginalUser) as User;
            if (firebaseUser.uid === original.id) {
              userToLoadId = impersonationUserId;
              setOriginalUser(original);
              impersonating = true;
            } else {
              localStorage.removeItem('impersonationUserId');
              localStorage.removeItem('originalAdminUser');
            }
          } catch (err) {
            console.error('Error parsing original user', err);
            localStorage.removeItem('impersonationUserId');
            localStorage.removeItem('originalAdminUser');
          }
        }

        setIsImpersonating(impersonating);

        // User doc
        const userDocRef = doc(db, 'users', userToLoadId);
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          console.error('User doc not found for UID:', userToLoadId);
          await handleSignOut();
          return null;
        }

        const userData = {
          id: snap.id,
          ...snap.data(),
        } as User;

        setUser(userData);

        if (!localStorage.getItem('lastActivity')) {
          extendSession();
        }

        // Remember-me → PIN setup
        if (shouldRemember && !impersonating) {
          try {
            const currentSaved: SavedUser[] = JSON.parse(
              localStorage.getItem('savedUsers') || '[]'
            );
            const exists = currentSaved.some((u) => u.id === userData.id);
            if (!exists) {
              setUserForPinSetup(userData);
              setIsPinSetupOpen(true);
            }
          } catch (err) {
            console.error('Error checking saved users', err);
          }
          setShouldRemember(false);
        }

        // Role & permissions
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
            console.warn(`Role '${userData.role}' not found`);
            setPermissions({});
          }
        } else {
          console.warn('User has no role');
          setPermissions({});
        }

        return userData;
      } catch (err) {
        console.error('Error fetching user data:', err);
        setUser(null);
        setPermissions({});
        toast({
          title: 'Error',
          description: 'Failed to load user data. Please try logging in again.',
          variant: 'destructive',
        });
        return null;
      }
    },
    [extendSession, handleSignOut, shouldRemember, toast]
  );

  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    await fetchUserData(firebaseUser);
  }, [fetchUserData]);

  /* ---------- subscribe to Firebase auth ---------- */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      await fetchUserData(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [fetchUserData]);

  /* ---------- session activity ---------- */

  useEffect(() => {
    if (!user) return;

    resetTimeouts();

    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach((e) => window.addEventListener(e, extendSession));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      events.forEach((e) =>
        window.removeEventListener(e, extendSession)
      );
    };
  }, [user, extendSession, resetTimeouts]);

  /* ---------- context value ---------- */

  const value: AuthContextType = {
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
    <AuthContext.Provider value={value}>
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

/* ---------- hook ---------- */

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
