'use client';

/**
 * Project Management › Settings › Field Control — the container: permissions, the live settings
 * document (merged over the registry's defaults; a locked field keeps only its label override) and
 * the save with its activity log. Everything on screen is `FieldControlView`.
 */

import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Loader2, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { logUserActivity } from '@/lib/activity-logger';
import { PM_FORM_KEYS, PM_FORM_REGISTRY, type PMFormKey } from '@/lib/project-management-field-registry';
import { PM_FIELD_CONTROL_DOC_ID, PM_SETTINGS_COLLECTION, type PMFieldSetting } from './use-field-control';
import {
  FieldControlView,
  buildDefaultFieldControlDraft,
  type FieldControlDraft,
} from '@/components/project-management/field-control-view';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const MODULE = 'Project Management';
const PERMISSION_RESOURCE = `${MODULE}.Settings`;

export default function ProjectManagementFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', PERMISSION_RESOURCE);
  const canEdit = can('Manage Field Control', PERMISSION_RESOURCE) || can('Edit', PERMISSION_RESOURCE);
  const [draft, setDraft] = useState<FieldControlDraft>(buildDefaultFieldControlDraft);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onSnapshot(
        doc(db, PM_SETTINGS_COLLECTION, PM_FIELD_CONTROL_DOC_ID),
        (snapshot) => {
          const stored = (snapshot.data() || {}) as Partial<Record<PMFormKey, Record<string, unknown>>>;
          const next = buildDefaultFieldControlDraft();
          for (const formKey of PM_FORM_KEYS) {
            for (const field of PM_FORM_REGISTRY[formKey].fields) {
              const override = stored[formKey]?.[field.key] as Partial<PMFieldSetting> | undefined;
              if (!override) continue;
              if (field.locked) {
                next[formKey][field.key] = { ...next[formKey][field.key], label: override.label || field.defaultLabel };
                continue;
              }
              next[formKey][field.key] = {
                visible: override.visible ?? true,
                required: override.required ?? field.defaultRequired,
                label: override.label || field.defaultLabel,
              };
            }
          }
          setDraft(next);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  const save = useCallback(
    async (next: FieldControlDraft) => {
      if (!canEdit) return;
      await setDoc(doc(db, PM_SETTINGS_COLLECTION, PM_FIELD_CONTROL_DOC_ID), {
        ...next,
        updatedAt: serverTimestamp(),
      });
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: MODULE,
          action: 'Update Field Control',
          details: {},
        });
      }
    },
    [canEdit, user],
  );

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Access denied
          </CardTitle>
          <CardDescription>You do not have permission to view Field Control settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <FieldControlView initialDraft={draft} canEdit={canEdit} onSave={save} />;
}
