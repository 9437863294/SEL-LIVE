'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, Loader2, Lock, RotateCcw, Save, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { SAS_COLLECTIONS, SAS_FIELD_CONTROL_DOC_ID } from '@/lib/site-account-statement';
import { SAS_FORM_KEYS, SAS_FORM_REGISTRY, type SASFormKey } from '@/lib/site-account-statement-field-registry';
import type { SASFieldSetting } from './use-field-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MODULE = 'Site Account Statement';

type Draft = Record<SASFormKey, Record<string, SASFieldSetting>>;

function buildDefaultDraft(): Draft {
  const draft = {} as Draft;
  for (const formKey of SAS_FORM_KEYS) {
    draft[formKey] = {};
    for (const field of SAS_FORM_REGISTRY[formKey].fields) {
      draft[formKey][field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    }
  }
  return draft;
}

export default function SiteAccountFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();
  const canView = can('View', `${MODULE}.Field Control`) || can('View Module', MODULE);
  const canEdit = can('Edit', `${MODULE}.Field Control`);
  const [activeForm, setActiveForm] = useState<SASFormKey>('expense');
  const [draft, setDraft] = useState<Draft>(buildDefaultDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, SAS_COLLECTIONS.settings, SAS_FIELD_CONTROL_DOC_ID),
        (snapshot) => {
          const stored = (snapshot.data() || {}) as Partial<Record<SASFormKey, Record<string, unknown>>>;
          const next = buildDefaultDraft();
          for (const formKey of SAS_FORM_KEYS) {
            for (const field of SAS_FORM_REGISTRY[formKey].fields) {
              const override = stored[formKey]?.[field.key];
              if (override === undefined) continue;
              if (typeof override === 'boolean') {
                // Legacy shape from the old Add Expense / Add Receipt field control.
                if (!field.locked) next[formKey][field.key] = { ...next[formKey][field.key], required: override };
                continue;
              }
              const overrideObj = override as Partial<SASFieldSetting>;
              if (field.locked) {
                next[formKey][field.key] = { ...next[formKey][field.key], label: overrideObj.label || field.defaultLabel };
                continue;
              }
              next[formKey][field.key] = {
                visible: overrideObj.visible ?? true,
                required: overrideObj.required ?? field.defaultRequired,
                label: overrideObj.label || field.defaultLabel,
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

  function update(formKey: SASFormKey, fieldKey: string, patch: Partial<SASFieldSetting>) {
    setDraft((current) => ({
      ...current,
      [formKey]: { ...current[formKey], [fieldKey]: { ...current[formKey][fieldKey], ...patch } },
    }));
  }

  function resetForm(formKey: SASFormKey) {
    setDraft((current) => {
      const reset: Record<string, SASFieldSetting> = {};
      for (const field of SAS_FORM_REGISTRY[formKey].fields) {
        reset[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
      }
      return { ...current, [formKey]: reset };
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await setDoc(doc(db, SAS_COLLECTIONS.settings, SAS_FIELD_CONTROL_DOC_ID), {
        ...draft,
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || '',
        updatedByName: user?.name || '',
      });
      void log('Update SAS Field Control', {});
      toast({ title: 'Field control saved' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
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

  const formDef = SAS_FORM_REGISTRY[activeForm];
  const fields = formDef.fields;
  const formFieldState = draft[activeForm] || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link href="/site-account-statement/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Field Control</h1>
            <p className="text-sm text-muted-foreground">
              Choose which fields appear, whether they're required, and what they're called — per form.
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          You have view-only access to Field Control. Ask your administrator for "Edit" permission on Field Control to make changes.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-emerald-600" />
              {formDef.title}
            </CardTitle>
            <CardDescription>{formDef.description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={activeForm} onValueChange={(value) => setActiveForm(value as SASFormKey)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAS_FORM_KEYS.map((key) => (
                  <SelectItem value={key} key={key}>
                    {SAS_FORM_REGISTRY[key].title}
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">Label</TableHead>
                  <TableHead className="w-28 text-center">Required</TableHead>
                  <TableHead className="w-28 text-center">Visible</TableHead>
                  <TableHead>Field key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => {
                  const setting = formFieldState[field.key] || {
                    visible: true,
                    required: field.defaultRequired,
                    label: field.defaultLabel,
                  };
                  return (
                    <TableRow key={field.key}>
                      <TableCell>
                        <Input
                          value={setting.label}
                          disabled={!canEdit}
                          onChange={(event) => update(activeForm, field.key, { label: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={setting.required}
                          disabled={!canEdit || field.locked}
                          onCheckedChange={(value) => update(activeForm, field.key, { required: value })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={setting.visible}
                          disabled={!canEdit || field.locked}
                          onCheckedChange={(value) => update(activeForm, field.key, { visible: value })}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {field.key}
                        {field.locked && (
                          <Badge variant="outline" className="ml-2 gap-1 text-[10px]">
                            <Lock className="h-2.5 w-2.5" /> Locked
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Locked fields are required by the form's own logic — for example, a record's own project/date/amount, or an
        entity's own name — so they can't be hidden or made optional here, but their label can still be renamed.
        Changes apply to everyone using this module.
      </p>
    </div>
  );
}
