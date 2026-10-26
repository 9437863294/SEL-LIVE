'use client';

/**
 * "Keep tracking alive" — the one-time steps for phones whose maker kills background apps
 * regardless of Android's rules (Xiaomi, Oppo, Vivo, Samsung and the rest; `oemGuideFor`). Shown
 * once before the first trip on such a phone, and again when a trip comes back with a gap of more
 * than ten minutes (the phone stopped the recorder). "Open settings" deep-links to the maker's
 * autostart / battery screen where one is known (BatteryOptimization.openOemSettings), else to the
 * app's info page.
 */

import { useEffect, useState } from 'react';
import { BatteryCharging, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/shared/form-dialog';
import { BatteryOptimization, batteryPluginAvailable } from '@/lib/trip-tracking/native';
import type { OemGuide } from '@/lib/trip-tracking/rules';

/** Per phone, in the WebView's storage: the guide is not repeated once done. */
export const OEM_GUIDE_KEY = 'sel-trip-tracking:oem-guide-shown';

export const oemGuideShown = (): boolean => {
  try {
    return window.localStorage.getItem(OEM_GUIDE_KEY) === '1';
  } catch {
    return false;
  }
};

export const setOemGuideShown = (shown: boolean) => {
  try {
    if (shown) window.localStorage.setItem(OEM_GUIDE_KEY, '1');
    else window.localStorage.removeItem(OEM_GUIDE_KEY);
  } catch {
    // Without storage the guide simply shows again next time.
  }
};

export function OemGuideDialog({ open, guide, reason, onDone }: { open: boolean; guide: OemGuide; /** Why it is showing: before the first trip, or after a gap. */ reason: 'first' | 'gap'; onDone: () => void }) {
  const [batteryIgnoring, setBatteryIgnoring] = useState<boolean | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !batteryPluginAvailable()) return;
    void BatteryOptimization.isIgnoring()
      .then((result) => setBatteryIgnoring(result.ignoring))
      .catch(() => setBatteryIgnoring(null));
  }, [open]);

  const openSettings = async () => {
    try {
      const result = await BatteryOptimization.openOemSettings();
      setOpened(result.opened === 'oem' ? 'The phone’s own settings opened — follow the steps, then come back.' : 'App info opened — look for Battery and Autostart there.');
    } catch {
      setOpened('Open Settings → Apps → SEL Driver yourself, then follow the steps.');
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setOemGuideShown(true);
          onDone();
        }
      }}
      size="md"
      sheet
      title="Keep tracking alive"
      description={reason === 'gap' ? `Your last trip stopped recording for a while — ${guide.brand} phones close apps in the background unless told not to.` : `${guide.brand} phones close apps in the background unless told not to. Do this once so trips record with the screen locked.`}
      footer={
        <Button
          type="button"
          onClick={() => {
            setOemGuideShown(true);
            onDone();
          }}
        >
          Done
        </Button>
      }
    >
      <ol className="space-y-2">
        {guide.steps.map((step, index) => (
          <li key={step} className="flex min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
      {batteryPluginAvailable() && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={() => void openSettings()}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
            Open settings
          </Button>
          {batteryIgnoring === false ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void BatteryOptimization.requestIgnore()
                  .then(() => BatteryOptimization.isIgnoring())
                  .then((result) => setBatteryIgnoring(result.ignoring))
                  .catch(() => undefined)
              }
            >
              <BatteryCharging className="mr-2 h-4 w-4" aria-hidden />
              Turn off battery optimisation
            </Button>
          ) : batteryIgnoring ? (
            <p className="flex items-center gap-1.5 self-center text-xs text-emerald-700">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Battery optimisation is off
            </p>
          ) : null}
        </div>
      )}
      {opened && <p className="text-xs text-muted-foreground">{opened}</p>}
    </FormDialog>
  );
}
