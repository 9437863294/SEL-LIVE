'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { multiFactor, TotpMultiFactorGenerator, type TotpSecret } from 'firebase/auth';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Copy, CheckCheck, Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

type Step = 'intro' | 'qr' | 'success';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEnrolled: () => void;
}

export function MFASetupDialog({ open, onOpenChange, onEnrolled }: Props) {
  const [step, setStep]           = useState<Step>('intro');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [otp, setOtp]             = useState('');
  const [otpError, setOtpError]   = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied]       = useState(false);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep('intro');
        setQrDataUrl('');
        setSecretKey('');
        setTotpSecret(null);
        setOtp('');
        setOtpError('');
        setCopied(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const startSetup = async () => {
    setIsLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in.');
      const session = await multiFactor(user).getSession();
      const secret  = await TotpMultiFactorGenerator.generateSecret(session);
      const otpauthUrl = secret.generateQrCodeUrl(user.email ?? user.uid, 'SEL Platform');
      const dataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 2 });
      setTotpSecret(secret);
      setSecretKey(secret.secretKey);
      setQrDataUrl(dataUrl);
      setStep('qr');
    } catch (err: any) {
      console.error('[MFA setup]', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSecret) return;
    const code = otp.trim();
    if (code.length !== 6) { setOtpError('Enter the 6-digit code from your app.'); return; }
    setIsLoading(true);
    setOtpError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in.');
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
      await multiFactor(user).enroll(assertion, 'TOTP');
      setStep('success');
    } catch (err: any) {
      const errCode: string = err?.code ?? '';
      if (errCode === 'auth/invalid-verification-code') {
        setOtpError('Incorrect code. Wait for the next one and try again.');
      } else {
        setOtpError(err?.message ?? 'Enrollment failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDone = () => {
    onEnrolled();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={e => step === 'qr' && e.preventDefault()}
      >
        {/* ── STEP: Intro ── */}
        {step === 'intro' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                Set Up Two-Factor Authentication
              </DialogTitle>
              <DialogDescription>
                Protect your account with a one-time code from an authenticator app.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
                <p className="font-medium">You'll need an authenticator app:</p>
                <ul className="space-y-1 text-muted-foreground">
                  {['Google Authenticator', 'Microsoft Authenticator', 'Authy'].map(app => (
                    <li key={app} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      {app}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                After setup, you'll enter a 6-digit code from the app whenever you sign in with Google.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={startSetup} disabled={isLoading}>
                {isLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting up…</>
                  : 'Begin Setup →'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP: QR + OTP verify ── */}
        {step === 'qr' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                Scan QR Code
              </DialogTitle>
              <DialogDescription>
                Open your authenticator app, tap <strong>"+"</strong> or <strong>"Add account"</strong>, then scan the code below.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* QR Image */}
              {qrDataUrl && (
                <div className="flex justify-center">
                  <div className="rounded-2xl border-2 border-dashed border-border p-4 bg-white shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt="TOTP QR code" width={180} height={180} />
                  </div>
                </div>
              )}

              {/* Manual secret key fallback */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Can't scan? Enter this key manually:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono break-all">{secretKey}</code>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(secretKey);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied
                      ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* OTP verify form */}
              <form onSubmit={handleVerify} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-otp">Enter the 6-digit code to confirm</Label>
                  <Input
                    id="setup-otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={otp}
                    onChange={e => {
                      setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                      if (otpError) setOtpError('');
                    }}
                    className={cn(
                      'text-center font-mono text-xl tracking-[0.4em] h-12',
                      otpError && 'border-rose-400 focus-visible:ring-rose-400'
                    )}
                    autoFocus
                    autoComplete="one-time-code"
                  />
                  {otpError && <p className="text-xs text-rose-500">{otpError}</p>}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setStep('intro')}>Back</Button>
                  <Button type="submit" disabled={isLoading || otp.length < 6}>
                    {isLoading
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying…</>
                      : 'Enable 2FA'}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          </>
        )}

        {/* ── STEP: Success ── */}
        {step === 'success' && (
          <div className="py-6 text-center space-y-5">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100 dark:bg-emerald-950/30 dark:ring-emerald-900/40">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold">2FA Enabled!</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Your account is now protected. You'll need the authenticator app code each time you sign in with Google.
              </p>
            </div>
            <Button onClick={handleDone} className="w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
