'use client';

/**
 * The Mail Hub session: capabilities, mailboxes, folders, settings and signatures, loaded once from
 * `/api/mail-hub/bootstrap` and refreshed on a gentle poll so sync status stays current without a
 * realtime listener (Mail Hub's collections are server-only by design, so there is nothing for the
 * client SDK to listen to).
 *
 * Also owns the composer: any screen can call `openComposer(...)` and the one composer mounted by
 * the shell opens.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { mailApi, type Bootstrap } from '@/lib/mail-hub/client';
import type { MailComposeMode } from '@/lib/mail-hub/model';
import { NO_MAIL_HUB_CAPABILITIES } from '@/lib/mail-hub/permissions';

export interface ComposerRequest {
  mode: MailComposeMode;
  accountId?: string | null;
  sourceMessageId?: string | null;
  outboundId?: string | null;
  to?: string;
  subject?: string;
  bodyHtml?: string;
  aiAssisted?: boolean;
}

interface MailHubContextValue {
  data: Bootstrap | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  composer: ComposerRequest | null;
  openComposer: (request: ComposerRequest) => void;
  closeComposer: () => void;
  /** Bumped after anything that changes lists (send, action), so open lists reload. */
  version: number;
  bump: () => void;
}

const MailHubContext = createContext<MailHubContextValue | null>(null);

const POLL_MS = 45_000;

export function MailHubProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerRequest | null>(null);
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await mailApi.bootstrap();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Mail Hub could not load.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [authLoading, user, refresh]);

  const value = useMemo<MailHubContextValue>(
    () => ({
      data,
      loading: loading || authLoading,
      error,
      refresh,
      composer,
      openComposer: (request) => setComposer(request),
      closeComposer: () => setComposer(null),
      version,
      bump: () => setVersion((current) => current + 1),
    }),
    [data, loading, authLoading, error, refresh, composer, version],
  );
  return <MailHubContext.Provider value={value}>{children}</MailHubContext.Provider>;
}

export function useMailHub() {
  const value = useContext(MailHubContext);
  if (!value) throw new Error('useMailHub must be used inside MailHubProvider');
  return value;
}

export function useMailCapabilities() {
  return useMailHub().data?.capabilities ?? NO_MAIL_HUB_CAPABILITIES;
}

/** Load-on-mount with a reload function and error string — the pattern every page here uses. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setValue(await loadRef.current());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { value, setValue, loading, error, reload };
}
