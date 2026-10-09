'use client';

/**
 * Change the signed-in user's password: re-verify with the current one (plus the authenticator code
 * when two-factor is on), then set the new one.
 *
 * Opened from the header's account menu and from the Security card on the Profile page. The form
 * lives in `ChangePasswordPanel`, inside `DialogContent`, so Radix unmounts it on close and every
 * opening starts empty — the Security card keeps this dialog mounted, and a successful change used
 * to reopen with the old and new passwords still filled in.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  EmailAuthProvider,
  getMultiFactorResolver,
  reauthenticateWithCredential,
  TotpMultiFactorGenerator,
  updatePassword,
  type MultiFactorError,
  type MultiFactorResolver,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  ArrowLeft,
  Circle,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth/AuthProvider';
import { auth } from '@/lib/firebase';
import type { SavedUser } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ───────────────────────────── constants ───────────────────────────── */

/** The password-reset page (`app/auth/action`) asks for 8 too; this dialog used to accept 6. */
const MIN_LENGTH = 8;
const PROVIDER_PASSWORD = 'password';
const PROVIDER_GOOGLE = 'google.com';
const GOOGLE_SECURITY_URL = 'https://myaccount.google.com/security';
const SAVED_USERS_KEY = 'savedUsers';
const SIGNED_OUT_MESSAGE = 'Your sign-in has ended. Sign out, sign back in, then try again.';

/** Index = strength level. Theme tokens, so the meter reads the same in dark mode. */
const STRENGTH = [
  { label: '', bar: '' },
  { label: 'Weak', bar: 'bg-destructive' },
  { label: 'Fair', bar: 'bg-warning' },
  { label: 'Good', bar: 'bg-primary' },
  { label: 'Strong', bar: 'bg-success' },
] as const;

/* ─────────────────────────────── helpers ───────────────────────────── */

type Step = 'form' | 'code' | 'done';

interface FieldErrors {
  current?: string;
  next?: string;
  code?: string;
}

interface AccountInfo {
  email: string | null;
  hasPassword: boolean;
  usesGoogle: boolean;
}

function readAccount(): AccountInfo {
  const fbUser = auth.currentUser;
  const providers = fbUser?.providerData.map((p) => p.providerId) ?? [];
  return {
    email: fbUser?.email ?? null,
    // With no Firebase user (not expected behind the login) show the form and let submit say so.
    hasPassword: !fbUser || providers.includes(PROVIDER_PASSWORD),
    usesGoogle: providers.includes(PROVIDER_GOOGLE),
  };
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/** Same scoring as the password-reset page, so the two meters agree. */
function strengthOf(password: string): { level: number; label: string } {
  if (!password) return { level: 0, label: '' };
  if (password.length < MIN_LENGTH) return { level: 1, label: 'Too short' };
  let score = 0;
  if (password.length >= MIN_LENGTH) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const level = Math.min(4, score);
  return { level, label: STRENGTH[level].label };
}

/** A project password policy rejects with its unmet rules in brackets at the end of the message. */
function policyMessage(err: unknown): string {
  const detail = err instanceof Error ? /\[(.+)\]/.exec(err.message)?.[1] : undefined;
  return detail
    ? `This password doesn’t meet your organisation’s rules: ${detail}`
    : 'This password is too easy to guess. Use a longer one with a mix of letters, numbers and symbols.';
}

/**
 * The PIN sign-in keeps an encoded copy of the password in this browser (`PinSetupDialog` writes it,
 * `SessionExpiryDialog` signs in with it). Left alone it goes stale here, and the next PIN unlock
 * fails with "Could not extend session", so carry the new password over. Returns whether it did.
 */
function updateSavedPinPassword(userId: string | null, email: string | null, password: string): boolean {
  try {
    const raw = localStorage.getItem(SAVED_USERS_KEY);
    if (!raw) return false;
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return false;
    const target = email?.toLowerCase();
    let changed = false;
    const next = (saved as SavedUser[]).map((entry) => {
      const mine = (userId && entry?.id === userId) || (target && entry?.email?.toLowerCase() === target);
      if (!mine || !entry.password) return entry;
      changed = true;
      return { ...entry, password: btoa(password) };
    });
    if (changed) localStorage.setItem(SAVED_USERS_KEY, JSON.stringify(next));
    return changed;
  } catch (err) {
    // `btoa` rejects characters outside Latin-1. The PIN unlock then falls back to the password.
    console.warn('[ChangePasswordDialog] could not update the saved PIN sign-in', err);
    return false;
  }
}

/* ─────────────────────────────── fields ────────────────────────────── */

function FieldMessage({ id, tone, children }: { id: string; tone: 'error' | 'warning'; children: ReactNode }) {
  return (
    <p
      id={id}
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'error' ? 'font-medium text-destructive' : 'text-warning',
      )}
    >
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function PasswordField({
  id,
  label,
  value,
  onValueChange,
  autoComplete,
  error,
  inputRef,
  autoFocus,
  readOnly,
  labelAction,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  readOnly?: boolean;
  labelAction?: ReactNode;
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const errorId = `${id}-error`;
  const capsId = `${id}-caps`;
  const describedBy = [error ? errorId : null, capsLock ? capsId : null].filter(Boolean).join(' ') || undefined;
  const trackCapsLock = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          // 16px on phones so iOS does not zoom the page when the field takes focus.
          className={cn(
            'h-10 pr-11 text-base sm:text-sm',
            error && 'border-destructive focus-visible:ring-destructive',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {capsLock && (
        <FieldMessage id={capsId} tone="warning">
          Caps Lock is on
        </FieldMessage>
      )}
      {error && (
        <FieldMessage id={errorId} tone="error">
          {error}
        </FieldMessage>
      )}
      {children}
    </div>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const { level, label } = strengthOf(password);
  return (
    <div className="flex items-center gap-3 pt-0.5">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1.5 flex-1 rounded-full bg-muted transition-colors duration-300',
              step <= level && STRENGTH[level].bar,
            )}
          />
        ))}
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-medium text-muted-foreground" aria-live="polite">
        <span className="sr-only">Strength: </span>
        {label}
      </span>
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: ReactNode }) {
  const Icon = met ? CircleCheck : Circle;
  return (
    <li className={cn('flex items-start gap-1.5 text-xs transition-colors', met ? 'text-success' : 'text-muted-foreground')}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {children}
        <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
      </span>
    </li>
  );
}

/* ──────────────────────────────── dialog ────────────────────────────── */

interface ChangePasswordDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function ChangePasswordDialog({ isOpen, onOpenChange }: ChangePasswordDialogProps) {
  // Held here so the dialog cannot be dismissed mid-request, leaving the change with nobody to
  // report it to.
  const [busy, setBusy] = useState(false);
  const descriptionId = useId();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && busy) return;
        onOpenChange(open);
      }}
    >
      <DialogContent
        // The shared content clears `aria-describedby`; point it back at the description.
        aria-describedby={descriptionId}
        className="gap-0 p-0 sm:max-w-md"
        // The shared `stable both-edges` gutter would inset the tinted header from the edges.
        style={{ scrollbarGutter: 'auto' }}
      >
        <ChangePasswordPanel descriptionId={descriptionId} busy={busy} setBusy={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordPanel({
  descriptionId,
  busy,
  setBusy,
}: {
  descriptionId: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { user, isImpersonating, loadSavedUsers } = useAuth();
  const [account] = useState(readAccount);
  const email = account.email ?? user?.email ?? null;

  const [step, setStep] = useState<Step>('form');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [pinUpdated, setPinUpdated] = useState(false);
  const [resetLink, setResetLink] = useState<'idle' | 'sending' | 'sent'>('idle');

  const baseId = useId();
  const ids = {
    current: `${baseId}-current`,
    next: `${baseId}-new`,
    confirm: `${baseId}-confirm`,
    code: `${baseId}-code`,
  };
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Put the cursor on whatever was rejected. An effect rather than a direct call, because a
  // rejection can also switch steps and the field is not mounted yet.
  useEffect(() => {
    const target = errors.current ? currentRef : errors.next ? nextRef : errors.code ? codeRef : null;
    target?.current?.focus();
    target?.current?.select();
  }, [errors, step]);

  const meetsLength = next.length >= MIN_LENGTH;
  const differs = next.length > 0 && current.length > 0 && next !== current;
  const sameAsCurrent = next.length > 0 && next === current;
  const matches = confirm.length > 0 && confirm === next;
  const mismatch = confirm.length > 0 && !next.startsWith(confirm) && confirm !== next;
  const canSubmit = current.length > 0 && meetsLength && !sameAsCurrent && matches && !busy;

  const showError = (err: unknown) => {
    const code = errorCode(err);
    console.error('[ChangePasswordDialog] password change failed', code || err);
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/missing-password':
        setStep('form');
        setErrors({ current: 'That isn’t your current password.' });
        return;
      case 'auth/weak-password':
      case 'auth/password-does-not-meet-requirements':
        setStep('form');
        setErrors({ next: policyMessage(err) });
        return;
      case 'auth/invalid-verification-code':
        setErrors({ code: 'That code didn’t work. Check your authenticator app and try again.' });
        return;
      case 'auth/code-expired':
      case 'auth/invalid-multi-factor-session':
      case 'auth/missing-multi-factor-session':
        setStep('form');
        setResolver(null);
        setFormError('The verification timed out. Choose “Change password” to start again.');
        return;
      case 'auth/too-many-requests':
        setFormError('Too many attempts. Wait a few minutes, then try again.');
        return;
      case 'auth/network-request-failed':
        setFormError('You appear to be offline. Check your connection and try again.');
        return;
      case 'auth/user-mismatch':
      case 'auth/user-token-expired':
      case 'auth/user-disabled':
      case 'auth/requires-recent-login':
        setFormError(SIGNED_OUT_MESSAGE);
        return;
      default:
        setFormError('Your password could not be changed. Please try again.');
    }
  };

  const finish = async (fbUser: FirebaseUser) => {
    await updatePassword(fbUser, next);
    setPinUpdated(updateSavedPinPassword(user?.id ?? null, fbUser.email, next));
    loadSavedUsers();
    setCurrent('');
    setNext('');
    setConfirm('');
    setCode('');
    setResolver(null);
    setStep('done');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const fbUser = auth.currentUser;
    setErrors({});
    setFormError(null);
    if (!fbUser?.email) {
      setFormError(SIGNED_OUT_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      try {
        await reauthenticateWithCredential(fbUser, EmailAuthProvider.credential(fbUser.email, current));
      } catch (err) {
        // Two-factor accounts are re-verified in two steps; this used to end in a generic error.
        if (errorCode(err) !== 'auth/multi-factor-auth-required') throw err;
        const mfa = getMultiFactorResolver(auth, err as MultiFactorError);
        if (!mfa.hints.some((hint) => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID)) {
          setFormError('Your account’s second factor is not supported here. Contact your administrator.');
          return;
        }
        setResolver(mfa);
        setCode('');
        setStep('code');
        return;
      }
      await finish(fbUser);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    const hint = resolver?.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    const fbUser = auth.currentUser;
    if (!resolver || !hint || code.length !== 6 || busy) return;
    setErrors({});
    setFormError(null);
    if (!fbUser) {
      setFormError(SIGNED_OUT_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
      await finish(fbUser);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const sendResetLink = async () => {
    if (!email || resetLink !== 'idle') return;
    setResetLink('sending');
    setFormError(null);
    try {
      const res = await fetch('/api/send-password-reset-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResetLink('sent');
    } catch (err) {
      console.error('[ChangePasswordDialog] reset email failed', err);
      setResetLink('idle');
      setFormError('The reset email could not be sent. Check your connection and try again.');
    }
  };

  const header = (
    <DialogHeader className="space-y-0 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-background px-5 py-4 text-left">
      <div className="flex items-start gap-3 pr-8">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <KeyRound className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-base sm:text-lg">Change password</DialogTitle>
          <DialogDescription className="break-words text-xs sm:text-sm">
            {/* Our own id on an inner span: replacing Radix's id on the description itself makes
                Radix warn that the description is missing. */}
            <span id={descriptionId}>
              {email ? (
                <>
                  Signed in as <span className="font-medium text-foreground">{email}</span>
                </>
              ) : (
                'Update the password you sign in with.'
              )}
            </span>
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  );

  const closeFooter = (label: string) => (
    <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-4 sm:space-x-0">
      <DialogClose asChild>
        <Button type="button" className="sm:min-w-[6rem]">
          {label}
        </Button>
      </DialogClose>
    </DialogFooter>
  );

  /* ── Accounts this dialog cannot change ── */

  // Firebase stays signed in as the administrator while they view as someone else, so a change here
  // would silently change the administrator's own password.
  if (isImpersonating) {
    return (
      <>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <Notice icon={ShieldAlert} title="Not available while switched">
            You’re viewing the app as <span className="font-medium text-foreground">{user?.name ?? 'another user'}</span>.
            A change here would apply to your own administrator password, so switch back to your account first.
          </Notice>
        </div>
        {closeFooter('Close')}
      </>
    );
  }

  if (!account.hasPassword) {
    return (
      <>
        {header}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Notice icon={ShieldCheck} title="This account has no password">
            {account.usesGoogle
              ? 'You sign in with Google, so there is no password to change here. Your Google account’s password is managed by Google.'
              : 'You sign in with an external provider, so there is no password to change here. Contact your administrator to enable password sign-in.'}
          </Notice>
          {account.usesGoogle && (
            <a
              href={GOOGLE_SECURITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full gap-2')}
            >
              Open Google account security
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
        {closeFooter('Close')}
      </>
    );
  }

  /* ── Done ── */

  if (step === 'done') {
    return (
      <>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
          <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 ring-4 ring-success/20">
              <CircleCheck className="h-7 w-7 text-success" aria-hidden />
            </span>
            <div className="space-y-1.5" role="status">
              <h3 className="text-base font-semibold">Password updated</h3>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                Use your new password the next time you sign in. Other devices signed in to your account will need to
                sign in again, usually within the hour.
              </p>
              {pinUpdated && (
                <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                  Your PIN sign-in on this device has been updated too.
                </p>
              )}
            </div>
          </div>
        </div>
        {closeFooter('Done')}
      </>
    );
  }

  const errorBanner = formError ? (
    <Alert variant="destructive" className="py-3 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <CircleAlert className="h-4 w-4" />
      <AlertDescription>{formError}</AlertDescription>
    </Alert>
  ) : null;

  /* ── Authenticator code ── */

  if (step === 'code') {
    return (
      <>
        {header}
        <form onSubmit={handleVerifyCode} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Two-factor authentication is on. Enter the 6-digit code from your authenticator app to confirm it’s you.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.code}>Authenticator code</Label>
              <Input
                ref={codeRef}
                id={ids.code}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (errors.code) setErrors({});
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                autoFocus
                readOnly={busy}
                aria-invalid={errors.code ? true : undefined}
                aria-describedby={errors.code ? `${ids.code}-error` : undefined}
                className={cn(
                  'h-12 text-center font-mono text-xl tracking-[0.4em]',
                  errors.code && 'border-destructive focus-visible:ring-destructive',
                )}
              />
              {errors.code && (
                <FieldMessage id={`${ids.code}-error`} tone="error">
                  {errors.code}
                </FieldMessage>
              )}
            </div>
            {errorBanner}
          </div>
          <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-4 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setStep('form');
                setResolver(null);
                setCode('');
                setErrors({});
                setFormError(null);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button type="submit" disabled={busy || code.length !== 6} className="sm:min-w-[10rem]">
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Verifying…
                </>
              ) : (
                'Verify and change'
              )}
            </Button>
          </DialogFooter>
        </form>
      </>
    );
  }

  /* ── Passwords ── */

  return (
    <>
      {header}
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Lets password managers file the new password under the right account. */}
          {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}

          <PasswordField
            id={ids.current}
            label="Current password"
            value={current}
            onValueChange={(value) => {
              setCurrent(value);
              if (errors.current) setErrors({});
            }}
            autoComplete="current-password"
            error={errors.current}
            inputRef={currentRef}
            autoFocus
            readOnly={busy}
            labelAction={
              email ? (
                resetLink === 'sent' ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                    Reset link sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={sendResetLink}
                    disabled={resetLink === 'sending' || busy}
                    className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {resetLink === 'sending' ? 'Sending…' : 'Forgot it?'}
                  </button>
                )
              ) : null
            }
          >
            {resetLink === 'sent' && (
              <p className="text-xs text-muted-foreground" role="status">
                Check <span className="font-medium text-foreground">{email}</span> for a link to set a new password
                without the current one.
              </p>
            )}
          </PasswordField>

          <div className="border-t" aria-hidden />

          <PasswordField
            id={ids.next}
            label="New password"
            value={next}
            onValueChange={(value) => {
              setNext(value);
              if (errors.next) setErrors({});
            }}
            autoComplete="new-password"
            error={errors.next}
            inputRef={nextRef}
            readOnly={busy}
          >
            {next.length > 0 && <StrengthMeter password={next} />}
            <ul className="space-y-1 pt-0.5" aria-label="Password requirements">
              <Requirement met={meetsLength}>At least {MIN_LENGTH} characters</Requirement>
              <Requirement met={differs}>Different from your current password</Requirement>
            </ul>
          </PasswordField>

          <PasswordField
            id={ids.confirm}
            label="Confirm new password"
            value={confirm}
            onValueChange={setConfirm}
            autoComplete="new-password"
            error={mismatch ? 'Doesn’t match the new password' : undefined}
            readOnly={busy}
          >
            {matches && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Passwords match
              </p>
            )}
          </PasswordField>

          {errorBanner}
        </div>

        <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-4 sm:space-x-0">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={!canSubmit} className="sm:min-w-[10rem]">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Updating…
              </>
            ) : (
              'Change password'
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function Notice({ icon: Icon, title, children }: { icon: typeof ShieldAlert; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
