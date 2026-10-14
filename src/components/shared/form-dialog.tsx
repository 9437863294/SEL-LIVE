'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCompanyDesign, useUiText } from '@/hooks/use-company-profile';
import { cn } from '@/lib/utils';

type FormDialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Rendered in a <p>: no Badge or other block elements. */
  description?: React.ReactNode;
  /** Defaults to the company's default dialog size. */
  size?: FormDialogSize;
  children: React.ReactNode;
  /** Replaces the Cancel / Save buttons (still inside the pinned footer). */
  footer?: React.ReactNode;
  /** When given, the dialog is a <form>: Enter submits, and Save is its submit button. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void | Promise<unknown>;
  submitLabel?: string;
  cancelLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  className?: string;
  bodyClassName?: string;
}

/**
 * The standard form dialog: a fixed header, a body that scrolls within the viewport, and a footer
 * pinned below it — Cancel and Save side by side on a desktop, stacked full-width on a phone.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size,
  children,
  footer,
  onSubmit,
  submitLabel,
  cancelLabel,
  submitting = false,
  submitDisabled = false,
  className,
  bodyClassName,
}: FormDialogProps) {
  const t = useUiText();
  const design = useCompanyDesign();
  // "Automatic" means each dialog's own size; a form dialog's own size is md.
  const companySize = design.dialogs.defaultSize;
  const resolvedSize = size ?? (companySize === 'auto' ? 'md' : companySize);

  const actions =
    footer ?? (
      <>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={submitting}>
            {cancelLabel ?? t('cancel')}
          </Button>
        </DialogClose>
        {onSubmit ? (
          <Button type="submit" disabled={submitting || submitDisabled}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitLabel ?? t('save')}
          </Button>
        ) : null}
      </>
    );

  const inner = (
    <>
      <DialogHeader className="shrink-0 pr-6">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody className={cn('space-y-4', bodyClassName)}>{children}</DialogBody>
      <DialogFooter>{actions}</DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting && !next ? undefined : onOpenChange(next))}>
      <DialogContent size={resolvedSize} className={cn('gap-4', className)}>
        {onSubmit ? (
          <form
            className="flex min-h-0 flex-1 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (submitting || submitDisabled) return;
              void onSubmit(event);
            }}
          >
            {inner}
          </form>
        ) : (
          inner
        )}
      </DialogContent>
    </Dialog>
  );
}
