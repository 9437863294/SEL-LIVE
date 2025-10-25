
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { JmcEntry, JmcItem, ActionConfig } from '@/lib/types';
import { Loader2, Save } from 'lucide-react';

interface UpdateCertifiedQtyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  projectSlug: string;
  onSaveSuccess: () => void;
  onAction?: (taskId: string, action: string | ActionConfig, comment: string, updatedItems: JmcItem[]) => Promise<void>;
}

type EditableItem = JmcItem & { __certStr?: string; __error?: string | null };

export function UpdateCertifiedQtyDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  projectSlug,
  onSaveSuccess,
  onAction,
}: UpdateCertifiedQtyDialogProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<EditableItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // hydrate editable rows when dialog opens
  useEffect(() => {
    if (isOpen && jmcEntry) {
      const cloned: EditableItem[] = JSON.parse(JSON.stringify(jmcEntry.items || []));
      // keep the input as a string so users can clear/partially type
      cloned.forEach((it) => {
        it.__certStr = it.certifiedQty ?? it.certifiedQty === 0 ? String(it.certifiedQty) : '';
        it.__error = null;
      });
      setItems(cloned);
    }
  }, [isOpen, jmcEntry]);

  const hasErrors = useMemo(() => items.some((it) => it.__error), [items]);

  const handleCertifiedQtyChange = (index: number, raw: string) => {
    setItems((prev) => {
      const next = [...prev];
      const row = { ...next[index] };

      row.__certStr = raw;

      // Validate
      const parsed = raw.trim() === '' ? NaN : Number(raw);
      const executedQty = Number(row.executedQty) || 0;

      if (raw.trim() === '') {
        // allow empty while typing; treat as undefined
        row.__error = null;
        row.certifiedQty = undefined;
      } else if (Number.isNaN(parsed)) {
        row.__error = 'Enter a valid number';
      } else if (parsed < 0) {
        row.__error = 'Certified quantity cannot be negative';
        row.certifiedQty = 0;
      } else if (parsed > executedQty) {
        row.__error = `Cannot exceed executed qty (${executedQty})`;
        row.certifiedQty = executedQty;
        row.__certStr = String(executedQty);
      } else {
        row.__error = null;
        row.certifiedQty = parsed;
      }

      next[index] = row;
      return next;
    });
  };

  const handleSave = async () => {
    if (!jmcEntry) return;
    // quick guard: avoid saving if any invalid
    if (hasErrors) {
      toast({
        title: 'Fix validation errors',
        description: 'Please correct the highlighted certified quantities.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    const payloadItems: JmcItem[] = items.map(({ __certStr, __error, ...rest }) => ({
        ...rest,
        certifiedQty: rest.certifiedQty === undefined || rest.certifiedQty === null ? undefined : Number(rest.certifiedQty),
    }));

    if (onAction) {
        // This is the new workflow-aware save
        await onAction(jmcEntry.id, 'Verified', 'Verified with edits', payloadItems);
        setIsSaving(false);
        onOpenChange(false); // The parent will handle success toast
    } else {
        // This is the original direct-update logic (fallback)
        try {
            const jmcRef = doc(db, 'projects', projectSlug, 'jmcEntries', jmcEntry.id);
            await updateDoc(jmcRef, { items: payloadItems });

            toast({ title: 'Success', description: 'Certified quantities updated.' });
            onSaveSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error('Error updating certified quantities:', error);
            toast({ title: 'Error', description: 'Failed to update quantities.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Update Certified Quantities</DialogTitle>
          <DialogDescription>JMC No: {jmcEntry?.jmcNo}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Executed Qty</TableHead>
                <TableHead className="w-[180px]">Certified Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={`${item.boqSlNo}-${idx}`}>
                  <TableCell className="align-top">{item.description}</TableCell>
                  <TableCell className="text-right align-top">{item.executedQty}</TableCell>
                  <TableCell className="align-top">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      max={Number(item.executedQty) || undefined}
                      value={item.__certStr ?? ''}
                      onChange={(e) => handleCertifiedQtyChange(idx, e.target.value)}
                      aria-invalid={!!item.__error}
                      aria-describedby={item.__error ? `cert-error-${idx}` : undefined}
                    />
                    {item.__error && (
                      <p id={`cert-error-${idx}`} className="text-xs text-destructive mt-1">
                        {item.__error}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isSaving || hasErrors}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {onAction ? "Save & Verify" : "Save Quantities"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
