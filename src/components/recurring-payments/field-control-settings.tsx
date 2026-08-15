'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, Loader2, Lock, RotateCcw, Save, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import { RP_FORM_KEYS, RP_FORM_REGISTRY, type RPFormKey } from '@/lib/recurring-payments-field-registry';
import { fieldControlDocId, type RPFieldSetting } from './use-field-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Draft = Record<RPFormKey, Record<string, RPFieldSetting>>;

function buildDefaultDraft(): Draft {
  const draft = {} as Draft;
  for (const formKey of RP_FORM_KEYS) {
    draft[formKey] = {};
    for (const field of RP_FORM_REGISTRY[formKey].fields) {
      draft[formKey][field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    }
  }
  return draft;
}

export default function RecurringFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const canView = can('View', 'Recurring Payments.Settings');
  const canEdit = can('Manage Field Control', 'Recurring Payments.Settings');
  const [activeForm, setActiveForm] = useState<RPFormKey>('master');
  const [draft, setDraft] = useState<Draft>(buildDefaultDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, RP_COLLECTIONS.settings, fieldControlDocId(organizationId)),
        (snapshot) => {
          const stored = (snapshot.data() || {}) as Partial<Draft>;
          const next = buildDefaultDraft();
          for (const formKey of RP_FORM_KEYS) {
            for (const field of RP_FORM_REGISTRY[formKey].fields) {
              const override = stored[formKey]?.[field.key];
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
    [organizationId],
  );

  function update(formKey: RPFormKey, fieldKey: string, patch: Partial<RPFieldSetting>) {
    setDraft((current) => ({
      ...current,
      [formKey]: { ...current[formKey], [fieldKey]: { ...current[formKey][fieldKey], ...patch } },
    }));
  }

  function resetForm(formKey: RPFormKey) {
    setDraft((current) => {
      const reset: Record<string, RPFieldSetting> = {};
      for (const field of RP_FORM_REGISTRY[formKey].fields) {
        reset[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
      }
      return { ...current, [formKey]: reset };
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await setDoc(doc(db, RP_COLLECTIONS.settings, fieldControlDocId(organizationId)), {
        ...draft,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Field control saved' });
    } catch {
      toast({ title: 'Field control could not be saved', variant: 'destructive' });
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

  const formDef = RP_FORM_REGISTRY[activeForm];
  const fields = formDef.fields;
  const formFieldState = draft[activeForm] || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link href="/recurring-payments/settings">
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
          You have view-only access to Field Control. Ask your administrator for "Manage Field Control" permission to make changes.
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
            <Select value={activeForm} onValueChange={(value) => setActiveForm(value as RPFormKey)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RP_FORM_KEYS.map((key) => (
                  <SelectItem value={key} key={key}>
                    {RP_FORM_REGISTRY[key].title}
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
        Locked fields are required by the form's own logic — for example, a workflow step's mandatory amount or the
        record's own name/title — so they can't be hidden or made optional here, but their label can still be
        renamed. Changes apply to every user in this organization.
      </p>
    </div>
  );
}
