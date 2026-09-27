'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, Loader2, Lock, RotateCcw, Save, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { PM_FORM_KEYS, PM_FORM_REGISTRY, type PMFieldDef, type PMFormKey } from '@/lib/project-management-field-registry';
import { PM_FIELD_CONTROL_DOC_ID, PM_SETTINGS_COLLECTION, type PMFieldSetting } from './use-field-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PmDataList, type PmListColumn } from '@/components/project-management/pm-shell';

const MODULE = 'Project Management';
const PERMISSION_RESOURCE = `${MODULE}.Settings`;

type Draft = Record<PMFormKey, Record<string, PMFieldSetting>>;

/** One register row: the registry's field and its current setting, keyed for the list. */
type FieldRow = { id: string; field: PMFieldDef; setting: PMFieldSetting };

function buildDefaultDraft(): Draft {
  const draft = {} as Draft;
  for (const formKey of PM_FORM_KEYS) {
    draft[formKey] = {};
    for (const field of PM_FORM_REGISTRY[formKey].fields) {
      draft[formKey][field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    }
  }
  return draft;
}

export default function ProjectManagementFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', PERMISSION_RESOURCE);
  const canEdit = can('Manage Field Control', PERMISSION_RESOURCE) || can('Edit', PERMISSION_RESOURCE);
  const [activeForm, setActiveForm] = useState<PMFormKey>('boqAdd');
  const [draft, setDraft] = useState<Draft>(buildDefaultDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, PM_SETTINGS_COLLECTION, PM_FIELD_CONTROL_DOC_ID),
        (snapshot) => {
          const stored = (snapshot.data() || {}) as Partial<Record<PMFormKey, Record<string, unknown>>>;
          const next = buildDefaultDraft();
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

  function update(formKey: PMFormKey, fieldKey: string, patch: Partial<PMFieldSetting>) {
    setDraft((current) => ({
      ...current,
      [formKey]: { ...current[formKey], [fieldKey]: { ...current[formKey][fieldKey], ...patch } },
    }));
  }

  function resetForm(formKey: PMFormKey) {
    setDraft((current) => {
      const reset: Record<string, PMFieldSetting> = {};
      for (const field of PM_FORM_REGISTRY[formKey].fields) {
        reset[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
      }
      return { ...current, [formKey]: reset };
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await setDoc(doc(db, PM_SETTINGS_COLLECTION, PM_FIELD_CONTROL_DOC_ID), {
        ...draft,
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
      toast({ title: 'Field control saved' });
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Field control could not be saved.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

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

  const formDef = PM_FORM_REGISTRY[activeForm];
  const fields = formDef.fields;
  const formFieldState = draft[activeForm] || {};

  const fieldRows: FieldRow[] = fields.map((field) => ({
    id: field.key,
    field,
    setting: formFieldState[field.key] || {
      visible: true,
      required: field.defaultRequired,
      label: field.defaultLabel,
    },
  }));

  const columns: PmListColumn<FieldRow>[] = [
    {
      // The card's full-width bottom row on a phone: the title slot sizes an input to its text and
      // a detail slot to half the card.
      header: 'Label',
      mobile: 'footer',
      className: 'w-64',
      cell: ({ field, setting }) => (
        <Input
          aria-label={`Label for ${field.key}`}
          value={setting.label}
          disabled={!canEdit}
          onChange={(event) => update(activeForm, field.key, { label: event.target.value })}
        />
      ),
    },
    {
      header: 'Required',
      className: 'w-28 text-center',
      cell: ({ field, setting }) => (
        <Switch
          checked={setting.required}
          disabled={!canEdit || field.locked}
          onCheckedChange={(value) => update(activeForm, field.key, { required: value })}
        />
      ),
    },
    {
      header: 'Visible',
      className: 'w-28 text-center',
      cell: ({ field, setting }) => (
        <Switch
          checked={setting.visible}
          disabled={!canEdit || field.locked}
          onCheckedChange={(value) => update(activeForm, field.key, { visible: value })}
        />
      ),
    },
    {
      // The phone card's headline.
      header: 'Field key',
      mobile: 'title',
      className: 'whitespace-nowrap text-xs text-muted-foreground',
      cell: ({ field }) => (
        <>
          {field.key}
          {field.locked && (
            <Badge variant="outline" className="ml-2 gap-1 text-[10px]">
              <Lock className="h-2.5 w-2.5" /> Locked
            </Badge>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/project-management/settings" className="shrink-0">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Field Control</h1>
            <p className="text-sm text-muted-foreground">
              Choose which fields appear, whether they're required, and what they're called — per form.
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving} className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          You have view-only access to Field Control. Ask your administrator for "Manage Field Control" permission to make changes.
        </div>
      )}

      {/* On a phone the card drops its frame: the header reads as a section heading and the field
          cards stand on the page, rather than sitting as cards inside a card. */}
      <Card className="max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
        <CardHeader className="flex flex-col gap-3 max-sm:px-0 max-sm:pt-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
              <SlidersHorizontal className="h-5 w-5 shrink-0 text-indigo-600" />
              {formDef.title}
            </CardTitle>
            <CardDescription>{formDef.description}</CardDescription>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={activeForm} onValueChange={(value) => setActiveForm(value as PMFormKey)}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-64 sm:flex-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PM_FORM_KEYS.map((key) => (
                  <SelectItem value={key} key={key}>
                    {PM_FORM_REGISTRY[key].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => resetForm(activeForm)}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <PmDataList
            rows={fieldRows}
            columns={columns}
            className="sm:rounded-none sm:border-0 sm:shadow-none"
          />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Locked fields are required by the form's own logic — for example, the Scope 1/Scope 2/BOQ SL No
        combination a BOQ item's duplicate check keys off, or a Purchase Order's vendor and dates — so they
        can't be hidden or made optional here, but their label can still be renamed. Changes apply to everyone
        using this module.
      </p>
    </div>
  );
}
