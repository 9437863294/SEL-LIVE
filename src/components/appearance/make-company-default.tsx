'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { callAppearanceApi } from '@/components/appearance/use-appearance-admin';
import { useToast } from '@/hooks/use-toast';
import type { DirectDefaultField } from '@/lib/appearance/model';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * "Make default for everyone" beside a setting on My Appearance. The page renders it only for
 * those who may publish the company theme (the route checks again): the administrator's own choice
 * goes live as the company default, as a new version Theme Management can restore. Shown only
 * while their choice differs from the company's.
 *
 * People who chose for themselves keep their choice unless the administrator ticks the box; the
 * administrator's own choice is dropped either way, since it now equals the default it follows.
 */
export function MakeCompanyDefault({
  field,
  value,
  companyDefault,
  setting,
  valueLabel,
  onDone,
}: {
  field: DirectDefaultField;
  value: string;
  companyDefault: string;
  /** The setting's name, e.g. "Home page design". */
  setting: string;
  /** The chosen option's name, e.g. "Aurora Glass". */
  valueLabel: string;
  onDone: () => void;
}) {
  const { refreshCompany } = useAppearance();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  // How many people chose this setting for themselves; null while asking, 'unknown' if that failed.
  const [chosen, setChosen] = useState<number | 'unknown' | null>(null);
  const [clearChoices, setClearChoices] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    callAppearanceApi<{ chosen: number }>(`/api/appearance/admin/default?field=${field}`)
      .then((body) => !cancelled && setChosen(body.chosen))
      .catch(() => !cancelled && setChosen('unknown'));
    return () => {
      cancelled = true;
    };
  }, [open, field]);

  if (value === companyDefault) return null;

  // The administrator is one of those who chose: that is why this button shows at all.
  const others = typeof chosen === 'number' ? Math.max(0, chosen - 1) : chosen;

  async function confirm() {
    try {
      const result = await callAppearanceApi<{ cleared: number }>('/api/appearance/admin/default', {
        method: 'POST',
        body: JSON.stringify({ field, value, clearChoices, note: `${setting} default set to ${valueLabel}` }),
      });
      onDone();
      await refreshCompany();
      const switched = Math.max(0, result.cleared - 1);
      toast({
        title: `${valueLabel} is now the company default`,
        description: switched
          ? `${people(switched)} who had chosen their own now follow it too.`
          : `${setting}: everyone who follows the company default sees it now.`,
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'The default was not changed', description: error instanceof Error ? error.message : undefined });
      throw error;
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:text-primary"
        onClick={() => {
          setChosen(null);
          setClearChoices(false);
          setOpen(true);
        }}
      >
        <Users className="h-3 w-3" aria-hidden="true" />
        Make default for everyone
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Make ${valueLabel} the company default?`}
        description={`${setting} becomes ${valueLabel} for everyone who follows the company default, straight away. It is published as a new version, which Theme Management can restore.`}
        confirmLabel="Make default"
        onConfirm={confirm}
      >
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          {others === null ? (
            <p className="text-muted-foreground">Checking who has chosen their own…</p>
          ) : others === 'unknown' ? (
            <p className="text-muted-foreground">Could not check who has chosen their own. Anyone who has keeps their choice.</p>
          ) : others === 0 ? (
            <p className="text-muted-foreground">Nobody else has chosen their own, so this reaches everyone.</p>
          ) : (
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox className="mt-0.5" checked={clearChoices} onCheckedChange={(next) => setClearChoices(next === true)} />
              <span>
                <span className="block font-medium">Switch the {people(others)} who chose their own too</span>
                <span className="block text-xs text-muted-foreground">
                  Unticked, they keep their choice. Ticked, their choice is removed and they follow the company default from now on.
                </span>
              </span>
            </label>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
