'use client';

import * as React from 'react';
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
import { buttonVariants } from '@/components/ui/button';
import { useUiText } from '@/hooks/use-company-profile';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to the company's "confirmDeleteTitle" text when `destructive`, else "confirm". */
  title?: React.ReactNode;
  /**
   * Rendered in a <p>: plain text and inline elements only — a Badge (a div) here is a hydration
   * error. Put block content in `children`. Defaults to "confirmDeleteDescription" when
   * `destructive`.
   */
  description?: React.ReactNode;
  /** Extra block content between the description and the buttons. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A red confirm button, and delete wording for any title/description/label not given. */
  destructive?: boolean;
  /** Disables both buttons and shows a spinner; the dialog cannot be dismissed meanwhile. */
  loading?: boolean;
  /**
   * Runs on confirm. The dialog closes once it finishes (awaited when it returns a promise); if
   * it throws or rejects, the dialog stays open so the caller can show the error.
   */
  onConfirm: () => void | Promise<unknown>;
  className?: string;
}

/** The one "are you sure?" dialog. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  className,
}: ConfirmDialogProps) {
  const t = useUiText();
  const [running, setRunning] = React.useState(false);
  const busy = loading || running;

  const resolvedTitle = title ?? (destructive ? t('confirmDeleteTitle') : t('confirm'));
  const resolvedDescription = description ?? (destructive ? t('confirmDeleteDescription') : undefined);
  const resolvedConfirm = confirmLabel ?? (destructive ? t('delete') : t('confirm'));
  const resolvedCancel = cancelLabel ?? t('cancel');

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Radix closes an AlertDialog on Action click; hold it open until onConfirm settles.
    event.preventDefault();
    if (busy) return;
    setRunning(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller reports the error (toast); the dialog stays open for a retry.
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <AlertDialogContent className={cn('max-w-[calc(100vw-2rem)] rounded-lg sm:max-w-md', className)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolvedTitle}</AlertDialogTitle>
          {resolvedDescription ? <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={busy} className="mt-0">
            {resolvedCancel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={handleConfirm}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {resolvedConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
