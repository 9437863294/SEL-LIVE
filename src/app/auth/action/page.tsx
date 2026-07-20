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
import {
  CheckCircle2, Eye, EyeOff, KeyRound, Loader2,
  Mail, ShieldCheck, XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────
type Mode   = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | 'verifyAndChangeEmail';
type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'error';

// ─── per-mode config ──────────────────────────────────────────────────────────
const MODES: Record<Mode, {
  icon: React.ElementType;
  color: string; bg: string; bar: string; ring: string;
  title: string; subtitle: string; successTitle: string; successSubtitle: string;
}> = {
  resetPassword: {
    icon: KeyRound,
    color: 'text-violet-600', bg: 'bg-violet-50', bar: 'from-violet-500 to-purple-500', ring: 'ring-violet-400/30',
    title: 'Reset Your Password',
    subtitle: 'Enter a new password for your account.',
    successTitle: 'Password Reset!',
    successSubtitle: 'Your password has been updated. You can now sign in.',
  },
  verifyEmail: {
    icon: Mail,
    color: 'text-emerald-600', bg: 'bg-emerald-50', bar: 'from-emerald-400 to-teal-500', ring: 'ring-emerald-400/30',
    title: 'Verify Email',
    subtitle: 'Confirming your email address…',
    successTitle: 'Email Verified!',
    successSubtitle: 'Your email address has been successfully verified.',
  },
  recoverEmail: {
    icon: ShieldCheck,
    color: 'text-blue-600', bg: 'bg-blue-50', bar: 'from-blue-400 to-sky-500', ring: 'ring-blue-400/30',
    title: 'Recover Email',
    subtitle: 'Restoring your previous email address…',
    successTitle: 'Email Recovered!',
    successSubtitle: 'Your original email address has been restored.',
  },
  verifyAndChangeEmail: {
    icon: Mail,
    color: 'text-teal-600', bg: 'bg-teal-50', bar: 'from-teal-400 to-cyan-500', ring: 'ring-teal-400/30',
    title: 'Confirm Email Change',
    subtitle: 'Applying your new email address…',
    successTitle: 'Email Updated!',
    successSubtitle: 'Your email address has been changed successfully.',
  },
};

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

// ─── loading fallback (used by Suspense) ──────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <Loader2 className="h-8 w-8 text-white/30 animate-spin" />
    </div>
  );
}

// ─── main content (needs useSearchParams → must be inside Suspense) ───────────
function ActionContent() {
  const params      = useSearchParams();
  const mode        = params?.get('mode') as Mode | null;
  // Fallback: some email gateways don't decode &amp; before wrapping links,
  // so params arrive as "amp;oobCode" instead of "oobCode".
  const oobCode     = params?.get('oobCode') ?? params?.get('amp;oobCode') ?? '';

  const [status,   setStatus]   = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [email,    setEmail]    = useState('');

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);
  const [pwError,  setPwError]  = useState('');

  const cfg = mode && MODES[mode] ? MODES[mode] : null;

  // ── verify / auto-apply the action code on mount ───────────────────────────
  useEffect(() => {
    if (!mode || !cfg) {
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
      // verifyEmail / recoverEmail / verifyAndChangeEmail — apply immediately
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

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">

      {/* background glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-60 -right-60 h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute -bottom-60 -left-60 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* card */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">

          {/* top colour bar */}
          <div className={cn('h-1.5 w-full bg-gradient-to-r', cfg?.bar ?? 'from-slate-400 to-slate-500')} />

          <div className="p-8">

            {/* brand mark */}
            <div className="mb-6 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
                <span className="text-[11px] font-bold text-white">SE</span>
              </div>
              <span className="text-sm font-semibold text-slate-600 tracking-wide">SEL Platform</span>
            </div>

            {/* ── LOADING ── */}
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <Loader2 className="h-10 w-10 animate-spin text-slate-300" />
                <p className="text-sm text-muted-foreground">Verifying your link…</p>
              </div>
            )}

            {/* ── ERROR ── */}
            {status === 'error' && (
              <div className="flex flex-col items-center gap-5 py-4 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 ring-4 ring-rose-100">
                  <XCircle className="h-10 w-10 text-rose-500" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-800">Link Invalid</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{errorMsg}</p>
                </div>
                <Link href="/login">
                  <Button variant="outline" className="mt-1 h-11 px-6">
                    ← Back to Login
                  </Button>
                </Link>
              </div>
            )}

            {/* ── SUCCESS ── */}
            {status === 'success' && cfg && (
              <div className="flex flex-col items-center gap-5 py-4 text-center">
                <div className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full ring-4',
                  cfg.bg, cfg.ring
                )}>
                  <CheckCircle2 className={cn('h-10 w-10', cfg.color)} />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-xl font-bold text-slate-800">{cfg.successTitle}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{cfg.successSubtitle}</p>
                  {email && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      <Mail className="h-3 w-3" />
                      {email}
                    </p>
                  )}
                </div>
                <Link href="/login">
                  <Button className="mt-1 h-11 bg-slate-900 px-8 text-white hover:bg-slate-800">
                    Continue to Login
                  </Button>
                </Link>
              </div>
            )}

            {/* ── RESET PASSWORD FORM ── */}
            {(status === 'ready' || status === 'submitting') && mode === 'resetPassword' && cfg && (
              <form onSubmit={handleReset} className="space-y-5">

                {/* heading */}
                <div className="space-y-3">
                  <div className={cn('inline-flex h-12 w-12 items-center justify-center rounded-xl border', cfg.bg, cfg.color.replace('text-', 'border-').replace('600', '200'))}>
                    <cfg.icon className={cn('h-5 w-5', cfg.color)} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{cfg.title}</h2>
                    <p className="text-sm text-muted-foreground">{cfg.subtitle}</p>
                  </div>
                  {email && (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm text-slate-600 truncate">{email}</span>
                    </div>
                  )}
                </div>

                {/* new password */}
                <div className="space-y-1.5">
                  <Label htmlFor="pw" className="text-sm font-medium">New Password</Label>
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
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 transition-colors"
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
                      <p className="text-[11px] text-muted-foreground">
                        {strength.label || 'Too short'}
                        {strength.level < 3 && password.length >= 8 && ' — add uppercase, numbers or symbols'}
                      </p>
                    </div>
                  )}
                </div>

                {/* confirm */}
                <div className="space-y-1.5">
                  <Label htmlFor="cf" className="text-sm font-medium">Confirm Password</Label>
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 transition-colors"
                    >
                      {showCf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {confirm && password && confirm !== password && (
                    <p className="text-[11px] text-rose-600">Passwords do not match</p>
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
                  className="w-full h-11 bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors"
                >
                  {status === 'submitting'
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting Password…</>
                    : 'Set New Password'}
                </Button>

                <div className="text-center">
                  <Link href="/login" className="text-sm text-muted-foreground hover:text-slate-700 transition-colors">
                    ← Back to Login
                  </Link>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* footer */}
        <p className="mt-5 text-center text-xs text-white/30">
          SEL Platform · Secure Action Handler
        </p>
      </div>
    </div>
  );
}

// ─── page export (Suspense required by Next.js for useSearchParams) ───────────
export default function AuthActionPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ActionContent />
    </Suspense>
  );
}
