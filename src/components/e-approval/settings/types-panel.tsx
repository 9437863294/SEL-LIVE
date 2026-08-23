'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileStack, IndianRupee, Lock, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { E_APPROVAL_COLLECTIONS, type EApprovalTemplateRecord, type EApprovalType } from '@/lib/e-approval';
import {
  deleteEApprovalConfigRecord,
  listEApprovalTemplates,
  listEApprovalTypes,
  saveEApprovalType,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { Field } from '../page-header';
import {
  matchesSearch,
  SettingsAddButton,
  SettingsEmpty,
  SettingsFormDialog,
  SettingsList,
  SettingsRow,
  SettingsToolbar,
  useSettingsDraft,
} from './settings-ui';

type Draft = Partial<EApprovalType>;

/** Approval types — what an employee can raise. */
export function ApprovalTypesPanel({
  serviceActor,
  canEdit,
}: {
  serviceActor: EApprovalServiceActor | null;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EApprovalType[]>([]);
  const [templates, setTemplates] = useState<EApprovalTemplateRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const form = useSettingsDraft<Draft>();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [typeRows, templateRows] = await Promise.all([
        listEApprovalTypes(serviceActor?.organizationId),
        listEApprovalTemplates(serviceActor?.organizationId),
      ]);
      setRows(typeRows);
      setTemplates(templateRows);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!serviceActor || !form.draft?.name?.trim()) {
      toast({ variant: 'destructive', title: 'A name is required.' });
      return;
    }
    form.setBusy(true);
    try {
      await saveEApprovalType({ ...form.draft, name: form.draft.name.trim() }, serviceActor);
      toast({ title: 'Approval type saved' });
      form.close();
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      form.setBusy(false);
    }
  };

  const remove = async (row: EApprovalType) => {
    if (!serviceActor) return;
    await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.types, row.id, serviceActor);
    void load();
  };

  const visible = rows.filter((row) => matchesSearch(search, row.name, row.code, row.description));
  const add = () => form.setDraft({ active: true, requiresAmount: false });

  return (
    <div className="space-y-3">
      <SettingsToolbar
        count={rows.length}
        noun="approval type"
        search={search}
        onSearch={setSearch}
        action={canEdit ? <SettingsAddButton label="New type" onClick={add} /> : undefined}
      />

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={FileStack}
            title={rows.length ? 'Nothing matches that search' : 'No approval types yet'}
            description={
              rows.length
                ? undefined
                : 'A type decides whether the amount field is shown, whether the file is confidential by default, and which workflow it falls back to. Requests can still be raised without one.'
            }
            action={canEdit && !rows.length ? <SettingsAddButton label="Add the first type" onClick={add} /> : undefined}
          />
        }
      >
        {visible.map((row) => (
          <SettingsRow
            key={row.id}
            muted={row.active === false}
            title={row.name}
            badges={
              <>
                {row.code && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {row.code}
                  </Badge>
                )}
                {row.requiresAmount && (
                  <Badge variant="outline" className="gap-0.5 text-[10px]">
                    <IndianRupee className="h-2.5 w-2.5" /> Amount required
                  </Badge>
                )}
                {row.confidentialByDefault && (
                  <Badge variant="outline" className="gap-0.5 border-stone-300 bg-stone-100 text-[10px] text-stone-700">
                    <Lock className="h-2.5 w-2.5" /> Confidential
                  </Badge>
                )}
                {row.active === false && (
                  <Badge variant="outline" className="text-[10px]">
                    Inactive
                  </Badge>
                )}
              </>
            }
            subtitle={
              <>
                {row.description || 'No description'}
                {row.defaultTemplateId && (
                  <>
                    {' · falls back to '}
                    <span className="font-medium">
                      {templates.find((template) => template.id === row.defaultTemplateId)?.name ?? 'a workflow'}
                    </span>
                  </>
                )}
                {row.defaultSlaHours ? ` · ${row.defaultSlaHours}h per stage` : ''}
              </>
            }
            actions={
              canEdit && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => form.setDraft(row)}
                    aria-label={`Edit ${row.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => void remove(row)}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )
            }
          />
        ))}
      </SettingsList>

      <SettingsFormDialog
        open={form.open}
        onOpenChange={(next) => !next && form.close()}
        title={form.draft?.id ? 'Edit approval type' : 'New approval type'}
        description="Types are what the approval matrix routes on, and what decides whether the money fields appear at all."
        busy={form.busy}
        canSave={Boolean(form.draft?.name?.trim())}
        onSave={() => void save()}
      >
        <Field label="Name" required>
          <Input
            value={form.draft?.name ?? ''}
            onChange={(event) => form.patch({ name: event.target.value })}
            placeholder="Purchase Approval"
            className="h-9"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" hint="Used in reference numbers when department codes are off.">
            <Input
              value={form.draft?.code ?? ''}
              onChange={(event) => form.patch({ code: event.target.value.toUpperCase() })}
              placeholder="PUR"
              className="h-9 font-mono"
            />
          </Field>
          <Field label="SLA per stage" hint="Hours. Blank uses the module default.">
            <Input
              type="number"
              min={1}
              value={form.draft?.defaultSlaHours ?? ''}
              onChange={(event) => form.patch({ defaultSlaHours: Number(event.target.value) || undefined })}
              className="h-9"
            />
          </Field>
        </div>

        <Field label="Description">
          <Input
            value={form.draft?.description ?? ''}
            onChange={(event) => form.patch({ description: event.target.value })}
            className="h-9"
          />
        </Field>

        <Field label="Fallback workflow" hint="Used when no matrix rule matches.">
          <Select
            value={form.draft?.defaultTemplateId ?? 'NONE'}
            onValueChange={(next) => form.patch({ defaultTemplateId: next === 'NONE' ? undefined : next })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Leave it to the approval matrix</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
          {[
            {
              key: 'requiresAmount' as const,
              label: 'Amount is required',
              hint: 'The money block opens automatically and cannot be left blank.',
            },
            {
              key: 'confidentialByDefault' as const,
              label: 'Confidential by default',
              hint: 'Only participants and holders of confidential access can open it.',
            },
            { key: 'active' as const, label: 'Active', hint: 'Inactive types cannot be chosen on new requests.' },
          ].map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-2">
              <Checkbox
                checked={option.key === 'active' ? form.draft?.active !== false : form.draft?.[option.key] === true}
                onCheckedChange={(checked) => form.patch({ [option.key]: checked === true } as Draft)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </SettingsFormDialog>
    </div>
  );
}
