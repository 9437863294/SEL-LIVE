'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * The landing page for the Windows Agent's embedded ERP window.
 *
 * The agent opens this, having injected a Firebase custom token into the page's script context
 * before navigation. This exchanges it for a real session and forwards to wherever the user was
 * going, so the embedded window arrives already signed in as the person who signed in to the
 * agent.
 *
 * ── Why the token arrives in `window`, not in the URL ──────────────────────────────────────────
 *
 * A custom token is a bearer credential for one hour. In a query string it would land in
 * browser history, in any `Referer` sent by the first outbound request, and in the access log of
 * anything between the agent and the server. `AddScriptToExecuteOnDocumentCreatedAsync` puts it
 * in the page's own JavaScript context before the document exists, which none of those observe.
 *
 * The query string is still read as a fallback, because a manually-opened browser tab has no
 * way to inject script — but the agent never uses it, and the token is stripped from the URL
 * the moment it is read so it does not survive in history.
 *
 * ── Nothing happens without a token ────────────────────────────────────────────────────────────
 *
 * Opened by hand with no token, this is an ordinary page that says so and offers the normal
 * login. It grants nothing on its own; the credential is the whole of the authority.
 */

declare global {
  interface Window {
    /** Injected by the agent's WebView before the document is created. */
    __SEL_AGENT_TOKEN__?: string;
    __SEL_AGENT_RETURN__?: string;
  }
}

/** Only same-origin paths, for the same reason the notification deep links are checked. */
function safeReturnPath(value: string | null | undefined): string {
  if (!value) return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return '/';
  if (trimmed.startsWith('//')) return '/';
  if (trimmed.includes('\\')) return '/';
  return trimmed;
}

function AgentSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [message, setMessage] = useState('Signing you in…');
  const [failed, setFailed] = useState(false);

  // Where to go once the session is genuinely established. Null until the token is exchanged.
  const [destination, setDestination] = useState<string | null>(null);

  // React runs effects twice in development's strict mode, and a custom token is single-use in
  // the sense that a second exchange is wasted work and a second redirect fights the first.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token =
      (typeof window !== 'undefined' ? window.__SEL_AGENT_TOKEN__ : undefined) ||
      searchParams?.get('t') ||
      '';

    const target = safeReturnPath(
      (typeof window !== 'undefined' ? window.__SEL_AGENT_RETURN__ : undefined) ||
        searchParams?.get('next'),
    );

    if (!token) {
      setFailed(true);
      setMessage('This page is opened by the SEL LIVE desktop agent. There is nothing to do here.');
      return;
    }

    // Remove it from the address bar before anything else can read it.
    if (typeof window !== 'undefined') {
      window.__SEL_AGENT_TOKEN__ = undefined;
      if (searchParams?.get('t')) {
        window.history.replaceState({}, '', '/auth/agent');
      }
    }

    signInWithCustomToken(auth, token)
      .then(() => {
        setMessage('Signed in. Opening SEL LIVE…');
        setDestination(target);
      })
      .catch((error: unknown) => {
        setFailed(true);
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        setMessage(
          code === 'auth/invalid-custom-token' || code === 'auth/custom-token-mismatch'
            ? 'The agent’s sign-in token was not accepted. Close this window and sign in again from the agent.'
            : 'Could not sign in automatically. Close this window and use the SEL LIVE website.',
        );
      });
  }, [router, searchParams]);

  /**
   * Leave only once the application agrees somebody is signed in.
   *
   * Navigating the moment `signInWithCustomToken` resolves is a race that visibly loses.
   * Firebase has a session at that point, but AuthProvider has not re-rendered with it yet, so
   * the guard on the destination page sees `user === null`, bounces to /login, and the employee
   * watches their brand-new agent flash a login screen at them — the precise impression this
   * whole feature exists to avoid.
   *
   * Waiting here costs a few hundred milliseconds on a page that is already a spinner, and
   * /auth/agent is a public route, so nothing bounces us while we wait.
   */
  useEffect(() => {
    if (!destination || loading || !user) return;
    router.replace(destination);
  }, [destination, loading, user, router]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#020617] p-6 text-slate-100">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-400/15">
          <span className="h-2 w-2 rounded-full bg-cyan-200" aria-hidden />
        </div>
        <p className="text-lg font-semibold tracking-[0.18em] text-cyan-100">SEL LIVE</p>
        <p className={`mt-4 text-sm ${failed ? 'text-rose-300' : 'text-slate-400'}`}>{message}</p>
        {!failed ? (
          <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AgentAuthPage() {
  // useSearchParams needs a Suspense boundary; without one the whole route opts out of static
  // rendering and Next complains at build time.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#020617]" />}>
      <AgentSignIn />
    </Suspense>
  );
}
