'use client';

/**
 * Whether this phone may start a trip, asked once at the moment a trip is started (Fleet Trip's
 * own-vehicle and company-vehicle starts): `ensureReady()` opens the permissions gate when anything
 * required is missing and resolves when the driver has granted it (or false when they back out),
 * then shows the maker's "keep tracking alive" steps once on phones that need them.
 *
 * Without the native recorder (an older APK, the browser) it resolves true at once: those builds
 * start trips as they always have.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Device } from '@capacitor/device';
import { oemGuideFor, type OemGuide } from '@/lib/trip-tracking/rules';
import { checkTrackingPermissions, nativeTrackingAvailable } from '@/lib/trip-tracking/tracking';
import { OemGuideDialog, oemGuideShown, setOemGuideShown } from './oem-guide';
import { PermissionsGate } from './permissions-gate';

interface Readiness {
  /** Resolves true when a trip may start. */
  ensureReady: () => Promise<boolean>;
  /** Opens the gate on its own — the status chip's "Permission needed → Fix". */
  openGate: () => void;
  /** A trip came back with a long gap: the phone stopped the recorder; show its steps again. */
  showGuideAfterGap: () => void;
}

const ReadinessContext = createContext<Readiness | null>(null);

const ALWAYS_READY: Readiness = { ensureReady: async () => true, openGate: () => undefined, showGuideAfterGap: () => undefined };

export function useTrackingReadiness(): Readiness {
  return useContext(ReadinessContext) ?? ALWAYS_READY;
}

export function TrackingReadinessProvider({ children }: { children: ReactNode }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [guide, setGuide] = useState<{ guide: OemGuide; reason: 'first' | 'gap' } | null>(null);
  const gateAnswer = useRef<((ready: boolean) => void) | null>(null);
  const guideAnswer = useRef<(() => void) | null>(null);
  const maker = useRef<Promise<OemGuide | null> | null>(null);

  const makerGuide = useCallback(() => {
    maker.current ??= Device.getInfo()
      .then((info) => oemGuideFor(info.manufacturer))
      .catch(() => null);
    return maker.current;
  }, []);

  const ensureReady = useCallback(async () => {
    if (!nativeTrackingAvailable()) return true;
    let missing: string[];
    try {
      missing = (await checkTrackingPermissions()).missing;
    } catch {
      // Unreadable: let the start go ahead; the recorder refuses for itself if it must.
      return true;
    }
    if (missing.length) {
      const granted = await new Promise<boolean>((resolve) => {
        gateAnswer.current = resolve;
        setGateOpen(true);
      });
      if (!granted) return false;
    }
    const steps = await makerGuide();
    if (steps && !oemGuideShown()) {
      await new Promise<void>((resolve) => {
        guideAnswer.current = resolve;
        setGuide({ guide: steps, reason: 'first' });
      });
    }
    return true;
  }, [makerGuide]);

  const openGate = useCallback(() => {
    gateAnswer.current = null;
    setGateOpen(true);
  }, []);

  const showGuideAfterGap = useCallback(() => {
    void makerGuide().then((steps) => {
      if (!steps) return;
      setOemGuideShown(false);
      guideAnswer.current = null;
      setGuide({ guide: steps, reason: 'gap' });
    });
  }, [makerGuide]);

  const value = useMemo(() => ({ ensureReady, openGate, showGuideAfterGap }), [ensureReady, openGate, showGuideAfterGap]);

  return (
    <ReadinessContext.Provider value={value}>
      {children}
      {gateOpen && (
        <PermissionsGate
          open
          onDone={(ready) => {
            setGateOpen(false);
            gateAnswer.current?.(ready);
            gateAnswer.current = null;
          }}
        />
      )}
      {guide && (
        <OemGuideDialog
          open
          guide={guide.guide}
          reason={guide.reason}
          onDone={() => {
            setGuide(null);
            guideAnswer.current?.();
            guideAnswer.current = null;
          }}
        />
      )}
    </ReadinessContext.Provider>
  );
}
