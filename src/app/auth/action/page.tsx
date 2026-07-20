'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

// ─── constants ────────────────────────────────────────────────────────────────
const BG_URL =
  "https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Frm378-062.jpg?alt=media&token=91cf2e4f-e362-4a09-a283-a6ae2d64b55f";
const LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FSEL%20%20logo2%20.png?alt=media&token=39b0f804-0610-4f3a-b26e-8ce334f94788";

// ─── types ────────────────────────────────────────────────────────────────────
type Mode   = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | 'verifyAndChangeEmail';
type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'error';

// ─── password strength ────────────────────────────────────────────────────────
function passwordStrength(pw: string): { level: number; label: string; color: string } {
  if (!pw) return { level: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw))    score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const level = Math.min(4, score);
  const labels  = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors  = ['', 'bg-rose-400', 'bg-amber-400', 'bg-blue-400', 'bg-emerald-400'];
  return { level, label: labels[level], color: colors[level] };
}

// ─── shared card shell ────────────────────────────────────────────────────────
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4"
      style={{ backgroundImage: `url('${BG_URL}')` }}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative w-full max-w-md">
        <div className="overflow-hidden rounded-2xl shadow-2xl">

          {/* ── Email-template–style header ── */}
          <div className="flex flex-col items-center gap-3 bg-gradient-to-br from-[#0f172a] via-[#1a2744] to-[#0f172a] px-8 py-7">
            {/* Logo */}
            <div className="relative h-14 w-40">
              <Image
                src={LOGO_URL}
                alt="SEL Logo"
                fill
                sizes="160px"
                style={{ objectFit: 'contain' }}
                priority
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold tracking-wide text-white">Siddhartha Engineering Limited</p>
              <p className="text-[10px] tracking-[0.22em] text-slate-500 uppercase mt-0.5">SEL PLATFORM</p>
            </div>
          </div>

          {/* ── Green accent bar ── */}
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />

          {/* ── White body ── */}
          <div className="bg-white px-7 py-7">
            {children}
          </div>

        </div>

        <p className="mt-4 text-center text-xs text-white/30">
          SEL Platform · Secure Action Handler
        </p>
      </div>
    </div>
  );
}

// ─── request details card (always visible) ────────────────────────────────────
function RequestCard({
  email,
  status,
  mode,
}: {
  email: string;
  status: Status;
  mode: Mode | null;
}) {
  const modeLabel: Record<string, string> = {
    resetPassword:        'Password Reset',
    verifyEmail:          'Email Verification',
    recoverEmail:         'Email Recovery',
    verifyAndChangeEmail: 'Email Change',
  };
  const label = mode ? (modeLabel[mode] ?? 'Secure Action') : 'Secure Action';

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label} Request</p>
      </div>
      <div className="divide-y divide-slate-200">
        <div className="flex items-start gap-3 px-4 py-3">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Account Email</p>
            {email ? (
              <p className="mt-0.5 font-mono text-sm font-semibold text-slate-800 break-all">{email}</p>
            ) : (
              <div className="mt-1 h-4 w-44 animate-pulse rounded bg-slate-200" />
            )}
          </div>
        </div>
        <div className="flex items-start gap-3 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Link Status</p>
            <p className={cn(
              'mt-0.5 text-sm font-semibold',
              status === 'error' ? 'text-rose-600' : 'text-emerald-600'
            )}>
              {status === 'error' ? 'Invalid or expired' : 'Secure • One-time use'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── loading fallback ─────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <CardShell>
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
        <p className="text-sm text-slate-400">Verifying your link…</p>
      </div>
    </CardShell>
  );
}

// ─── main content ─────────────────────────────────────────────────────────────
function ActionContent() {
  const params  = useSearchParams();
  const mode    = params?.get('mode') as Mode | null;
  const oobCode = params?.get('oobCode') ?? params?.get('amp;oobCode') ?? '';

  const [status,   setStatus]   = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [email,    setEmail]    = useState('');

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);
  const [pwError,  setPwError]  = useState('');

  // ── verify / auto-apply the action code on mount ───────────────────────────
  useEffect(() => {
    if (!mode || !['resetPassword', 'verifyEmail', 'recoverEmail', 'verifyAndChangeEmail'].includes(mode)) {
      setErrorMsg('Invalid or missing action link. Please request a new one.');
      setStatus('error');
      return;
    }

    if (mode === 'resetPassword') {
      if (!oobCode) {
        setErrorMsg('Invalid or missing action link. Please request a new one.');
        setStatus('error');
        return;
      }
      verifyPasswordResetCode(auth, oobCode)
        .then(e  => { setEmail(e); setStatus('ready'); })
        .catch((err: any) => {
          const code = err?.code ?? '';
          if (code === 'auth/expired-action-code') {
            setErrorMsg('This password reset link has expired (links are valid for 1 hour). Please request a new one.');
          } else if (code === 'auth/invalid-action-code') {
            setErrorMsg('This password reset link has already been used or is invalid. Please request a new one.');
          } else {
            setErrorMsg('Unable to verify this reset link. It may have expired or already been used. Please request a new one.');
          }
          console.error('[auth/action] verifyPasswordResetCode failed:', code, err?.message);
          setStatus('error');
        });
    } else {
      if (!oobCode) {
        setErrorMsg('Invalid or missing action link. Please request a new one.');
        setStatus('error');
        return;
      }
      checkActionCode(auth, oobCode)
        .then(info => {
          setEmail(info.data.email ?? info.data.previousEmail ?? '');
          return applyActionCode(auth, oobCode);
        })
        .then(()  => setStatus('success'))
        .catch(() => {
          setErrorMsg('This link has expired or has already been used.');
          setStatus('error');
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── password reset submit ─────────────────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (password.length < 8) { setPwError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setPwError('Passwords do not match.'); return; }
    setStatus('submitting');
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setStatus('success');
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/weak-password') {
        setPwError('Password is too weak. Use at least 8 characters with uppercase, numbers, or symbols.');
      } else if (code === 'auth/expired-action-code') {
        setPwError('This reset link has expired. Please go back and request a new password reset.');
      } else if (code === 'auth/invalid-action-code') {
        setPwError('This reset link has already been used. Please request a new password reset.');
      } else {
        setPwError('Failed to reset password. Please try again or request a new reset link.');
      }
      console.error('[auth/action] confirmPasswordReset failed:', code, err?.message);
      setStatus('ready');
    }
  }

  const strength = passwordStrength(password);

  const modeLabel: Record<string, string> = {
    resetPassword:        'Reset Your Password',
    verifyEmail:          'Verify Your Email',
    recoverEmail:         'Recover Your Email',
    verifyAndChangeEmail: 'Confirm Email Change',
  };
  const modeSubtitle: Record<string, string> = {
    resetPassword:        'Enter a new password for your account below.',
    verifyEmail:          'Confirming your email address…',
    recoverEmail:         'Restoring your previous email address…',
    verifyAndChangeEmail: 'Applying your new email address…',
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <CardShell>

      {/* Section title */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">
          {mode ? (modeLabel[mode] ?? 'Secure Action') : 'Secure Action'}
        </h1>
        {status !== 'error' && status !== 'success' && (
          <p className="mt-1 text-sm text-slate-500">
            {mode ? (modeSubtitle[mode] ?? '') : ''}
          </p>
        )}
      </div>

      {/* Request details card — always visible */}
      <RequestCard email={email} status={status} mode={mode} />

      {/* ── LOADING ── */}
      {status === 'loading' && (
        <div className="flex items-center justify-center gap-3 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          <p className="text-sm text-slate-400">Verifying your link…</p>
        </div>
      )}

      {/* ── ERROR ── */}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 ring-4 ring-rose-100">
            <XCircle className="h-8 w-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">Link Invalid</h2>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">{errorMsg}</p>
          </div>
          <Link href="/login">
            <Button variant="outline" className="h-10 px-6 text-sm">
              ← Back to Login
            </Button>
          </Link>
        </div>
      )}

      {/* ── SUCCESS ── */}
      {status === 'success' && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {mode === 'resetPassword' ? 'Password Updated!' :
               mode === 'verifyEmail'   ? 'Email Verified!'   :
               mode === 'recoverEmail'  ? 'Email Recovered!'  : 'Done!'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">
              {mode === 'resetPassword'
                ? 'Your password has been updated. You can now sign in with your new password.'
                : 'Your email address has been successfully updated.'}
            </p>
          </div>
          <Link href="/login">
            <Button className="h-10 bg-slate-900 px-8 text-white hover:bg-slate-800">
              Continue to Login
            </Button>
          </Link>
        </div>
      )}

      {/* ── RESET PASSWORD FORM ── */}
      {(status === 'ready' || status === 'submitting') && mode === 'resetPassword' && (
        <form onSubmit={handleReset} className="space-y-4">

          {/* new password */}
          <div className="space-y-1.5">
            <Label htmlFor="pw" className="text-sm font-semibold text-slate-700">New Password</Label>
            <div className="relative">
              <Input
                id="pw"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="h-11 pr-10"
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* strength bar */}
            {password.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex gap-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-1 flex-1 rounded-full transition-all duration-300',
                        i < strength.level ? strength.color : 'bg-slate-200'
                      )}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  {strength.label || 'Too short'}
                  {strength.level < 3 && password.length >= 8 && ' — add uppercase, numbers or symbols'}
                </p>
              </div>
            )}
          </div>

          {/* confirm */}
          <div className="space-y-1.5">
            <Label htmlFor="cf" className="text-sm font-semibold text-slate-700">Confirm Password</Label>
            <div className="relative">
              <Input
                id="cf"
                type={showCf ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                className={cn(
                  'h-11 pr-10',
                  confirm && password && confirm !== password && 'border-rose-400 focus-visible:ring-rose-400'
                )}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowCf(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showCf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirm && password && confirm !== password && (
              <p className="text-[11px] text-rose-500">Passwords do not match</p>
            )}
          </div>

          {/* error banner */}
          {pwError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-sm text-rose-700">{pwError}</p>
            </div>
          )}

          {/* submit */}
          <Button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full h-11 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:from-emerald-700 hover:to-teal-700 transition-all"
          >
            {status === 'submitting'
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting Password…</>
              : 'Set New Password'}
          </Button>

          <div className="text-center">
            <Link href="/login" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
              ← Back to Login
            </Link>
          </div>
        </form>
      )}

    </CardShell>
  );
}

// ─── page export ──────────────────────────────────────────────────────────────
export default function AuthActionPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ActionContent />
    </Suspense>
  );
}
