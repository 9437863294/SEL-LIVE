'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { E_APPROVAL_COLLECTIONS, type EApprovalTemplateRecord, type EApprovalType } from '@/lib/e-approval';
import {
  deleteEApprovalConfigRecord,
  listEApprovalTemplates,
  listEApprovalTypes,
  saveEApprovalType,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { EApprovalEmptyState } from '../shared';

type Draft = Partial<EApprovalType> & { id?: string };

/**
 * Approval types (spec section 33).
 *
 * A type is what the matrix routes on and what decides whether the amount field is even shown — a
 * leave exception has no amount, and demanding one is how people learn to type 0 into fields that
 * then get used in reports.
 */
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
    if (!serviceActor || !draft?.name?.trim()) {
      toast({ variant: 'destructive', title: 'A name is required.' });
      return;
    }
    setBusy(true);
    try {
      await saveEApprovalType({ ...draft, name: draft.name.trim() }, serviceActor);
      toast({ title: 'Approval type saved' });
      setDraft(null);
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: EApprovalType) => {
    if (!serviceActor) return;
    await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.types, row.id, serviceActor);
    void load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div>
          <CardTitle className="text-sm">Approval Types</CardTitle>
          <CardDescription className="text-xs">
            Purchase, leave exception, site expense, vendor onboarding — whatever your organisation raises note-sheets
            for.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft({ active: true, requiresAmount: false })}>
            <Plus className="h-3.5 w-3.5" /> New type
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 sm:px-4">
        {draft && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={draft.name ?? ''}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Purchase Approval"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Code</Label>
                <Input
                  value={draft.code ?? ''}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
                  placeholder="PUR"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Default SLA per step (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.defaultSlaHours ?? ''}
                  onChange={(event) => setDraft({ ...draft, defaultSlaHours: Number(event.target.value) || undefined })}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                  value={draft.description ?? ''}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Default workflow</Label>
                <Select
                  value={draft.defaultTemplateId ?? 'NONE'}
                  onValueChange={(next) => setDraft({ ...draft, defaultTemplateId: next === 'NONE' ? undefined : next })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Use the approval matrix</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={draft.requiresAmount === true}
                  onCheckedChange={(checked) => setDraft({ ...draft, requiresAmount: checked === true })}
                />
                Amount is required
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={draft.confidentialByDefault === true}
                  onCheckedChange={(checked) => setDraft({ ...draft, confidentialByDefault: checked === true })}
                />
                Confidential by default
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={draft.active !== false}
                  onCheckedChange={(checked) => setDraft({ ...draft, active: checked === true })}
                />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="outline" className="h-8" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" className="h-8 gap-1.5" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EApprovalEmptyState title="No approval types yet" description="Add the first one to start routing." />
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {row.name}
                    {row.code ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{row.code}</span> : null}
                    {row.active === false && <span className="ml-1.5 text-[10px] text-muted-foreground">(inactive)</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {row.description || '—'}
                    {row.requiresAmount ? ' · amount required' : ''}
                    {row.confidentialByDefault ? ' · confidential' : ''}
                    {row.defaultTemplateId
                      ? ` · default: ${templates.find((template) => template.id === row.defaultTemplateId)?.name ?? 'template'}`
                      : ''}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDraft(row)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive"
                      onClick={() => void remove(row)}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
