'use client';

/**
 * The register's two confirmations, as in Project Management's: remove a sub-drawing, and remove an
 * item from the register (here the item itself is deleted — there is no BOQ item behind it).
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import type { DrawingItem, SubDrawing } from '@/lib/master-drawing-list/drawings';

import { mdlFetch } from './mdl-client';

export type SubDrawingRef = { item: DrawingItem; sub: SubDrawing };

export function RemoveSubDrawingDialog({ target, onClose, onRemoved }: { target: SubDrawingRef | null; onClose: () => void; onRemoved: (item: DrawingItem) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await mdlFetch(`items/${encodeURIComponent(target.item.id)}/sub-drawings/${encodeURIComponent(target.sub.id)}`, { method: 'DELETE' });
      toast({ title: 'Sub-drawing removed' });
      onRemoved({ ...target.item, subDrawings: target.item.subDrawings.filter((sub) => sub.id !== target.sub.id) });
      onClose();
    } catch (error) {
      toast({ title: 'Unable to remove sub-drawing', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this sub-drawing?</AlertDialogTitle>
          <AlertDialogDescription>
            “{target?.sub.title || 'Untitled drawing'}” and its submission history will be removed from {target?.item.description}. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteItemDialog({ target, onClose, onDeleted }: { target: DrawingItem | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await mdlFetch(`items/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      toast({ title: 'Item removed from the register' });
      onDeleted(target.id);
      onClose();
    } catch (error) {
      toast({ title: 'Unable to remove item', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this item from the MDL register?</AlertDialogTitle>
          <AlertDialogDescription>
            {target?.slNo ? `Sl. No. ${target.slNo} · ` : ''}
            {target?.description} — with its drawing record, every sub-drawing and their submission history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
