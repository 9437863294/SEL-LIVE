'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SFR_COLLECTIONS, type SFRProject } from '@/lib/site-fund-request';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';

export interface SFRProjectAccess {
  /** Admin: can see ALL requests across all projects */
  canViewAll: boolean;
  /** User can write (primary or alt user on at least one project) */
  canWrite: boolean;
  /** User is a viewer on at least one project (read-only) */
  isViewer: boolean;
  /** The project IDs this user can access (null = all, when canViewAll=true) */
  accessibleProjectIds: Set<string> | null;
  /** The project IDs this user can write to (primary + alt) */
  writableProjectIds: Set<string>;
  isLoading: boolean;
}

export function useSFRProjectAccess(): SFRProjectAccess {
  const { can, isLoading: authLoading } = useAuthorization();
  const { user } = useAuth();

  const canViewAll = can('View All', 'Site Fund Request.Requests');
  const [projects, setProjects] = useState<SFRProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  useEffect(() => {
    if (authLoading || canViewAll) {
      setProjectsLoaded(true);
      return;
    }
    if (!user?.id) {
      setProjectsLoaded(true);
      return;
    }
    getDocs(collection(db, SFR_COLLECTIONS.projects))
      .then(snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() } as SFRProject))))
      .finally(() => setProjectsLoaded(true));
  }, [authLoading, canViewAll, user?.id]);

  return useMemo((): SFRProjectAccess => {
    const isLoading = authLoading || !projectsLoaded;
    if (isLoading) {
      return {
        canViewAll: false,
        canWrite: false,
        isViewer: false,
        accessibleProjectIds: null,
        writableProjectIds: new Set(),
        isLoading: true,
      };
    }

    if (canViewAll) {
      return {
        canViewAll: true,
        canWrite: true,
        isViewer: false,
        accessibleProjectIds: null,
        writableProjectIds: new Set(),
        isLoading: false,
      };
    }

    const uid = user?.id ?? '';
    const writable = new Set<string>();
    const readable = new Set<string>();

    projects.forEach(p => {
      if (p.status !== 'Active') return;
      const isPrimary = p.assignedPersonId === uid;
      const isAlt     = p.altUserId === uid;
      const isViewerRole = p.viewerId === uid;
      if (isPrimary || isAlt) {
        writable.add(p.centralProjectId);
        readable.add(p.centralProjectId);
      } else if (isViewerRole) {
        readable.add(p.centralProjectId);
      }
    });

    return {
      canViewAll: false,
      canWrite: writable.size > 0,
      isViewer: readable.size > 0 && writable.size === 0,
      accessibleProjectIds: readable.size > 0 ? readable : null,
      writableProjectIds: writable,
      isLoading: false,
    };
  }, [authLoading, projectsLoaded, canViewAll, user?.id, projects]);
}
