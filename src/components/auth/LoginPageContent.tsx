"use client";

import { useEffect, useRef, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  type MultiFactorResolver,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAppearance } from "@/components/theme/ThemeProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SavedUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LoginDesignFrame } from "@/components/auth/login/designs";
import { GoogleIcon, IconInput, LoginSplash, OrDivider, PasswordInput } from "@/components/auth/login/parts";
import { LOGIN_TONES } from "@/components/auth/login/tones";

// ─── helpers ──────────────────────────────────────────────────────────────────

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const mapFirebaseError = (code: string) => {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Incorrect email or password. Please try again.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
      return "No account found with that email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    default:
      return "Sign in failed. Please try again.";
  }
};

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

// ─── main component ────────────────────────────────────────────────────────────

/**
 * The sign-in flow — profiles, email and password, reset, two-factor — drawn inside whichever
 * design the company chose in Settings → Appearance → Branding (see `login/designs.tsx`).
 */

export function LoginPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const emailRef = useRef<HTMLInputElement>(null);

  const { setShouldRemember, savedUsers, loadSavedUsers, loading: authLoading } = useAuth();
  // The company's published name and sign-in texts; today's wording until any are published.
  const { company, companyKnown } = useAppearance();
  const { branding } = company;
  // The company's chosen design decides the surface, so the form is drawn in that design's tone.
  const tone = LOGIN_TONES[branding.loginDesign] ?? LOGIN_TONES.horizon;

  // ── form state ──
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ── view state ──
  type View = "profiles" | "password" | "forgot" | "forgot-sent" | "mfa";
  const [view, setView] = useState<View>("profiles");
  const [activeUser, setActiveUser] = useState<SavedUser | null>(null);

  // ── google sign-in ──
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // ── MFA (two-factor auth) ──
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaCodeError, setMfaCodeError] = useState("");
  const [isMfaLoading, setIsMfaLoading] = useState(false);

  // ── forgot password ──
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotEmailError, setForgotEmailError] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);

  // ── reCAPTCHA v2 widget ──
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const recaptchaRef = useRef<ReCAPTCHA | null>(null);

  // ── init ──
  useEffect(() => { loadSavedUsers(); }, [loadSavedUsers]);
  useEffect(() => {
    if (!authLoading && savedUsers.length === 0) setView("password");
  }, [savedUsers, authLoading]);

  // Auto-focus email on password view
  useEffect(() => {
    if (view === "password" && !activeUser) {
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [view, activeUser, companyKnown]);

  // ── routing ──
  const resolvePostLoginPath = () => {
    const redirectParam = searchParams?.get("redirect");
    if (
      typeof redirectParam === "string" &&
      redirectParam.startsWith("/") &&
      !redirectParam.startsWith("//") &&
      !["/login", "/login/", "/driver-login", "/driver-login/"].includes(redirectParam)
    ) return redirectParam;

    const isDriverContext =
      searchParams?.get("app") === "driver" ||
      pathname === "/driver-login" ||
      pathname === "/driver-login/" ||
      (() => {
        if (typeof window === "undefined") return false;
        const cap = (window as any).Capacitor;
        if (typeof cap?.isNativePlatform === "function" && cap.isNativePlatform()) return true;
        const ua = navigator.userAgent || "";
        return /Android/i.test(ua) && /\bwv\b/i.test(ua);
      })();

    return isDriverContext ? "/driver-management" : "/";
  };

  // Handle Google redirect result (Capacitor fallback flow)
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          setShouldRemember(false);
          const nextPath = resolvePostLoginPath();
          router.replace(nextPath);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── handlers ──
  const validateSignInFields = (): boolean => {
    let ok = true;
    const finalEmail = (activeUser ? activeUser.email : email).trim().toLowerCase();
    if (!activeUser) {
      if (!finalEmail) { setEmailError("Email is required."); ok = false; }
      else if (!isValidEmail(finalEmail)) { setEmailError("Enter a valid email address."); ok = false; }
      else setEmailError("");
    }
    if (!password) { setPasswordError("Password is required."); ok = false; }
    else setPasswordError("");
    return ok;
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Android: native Google Sign-In dialog via Capacitor plugin
        // useCredentialManager: false → uses legacy GoogleSignIn intent (works on all devices)
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false } as any);
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("Google sign-in did not return an ID token.");
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } else {
        // Web browser: popup with redirect fallback
        // prompt: 'select_account' forces the Google account picker every time
        // so a user who was rejected can switch to a different account on retry.
        const makeProvider = () => {
          const p = new GoogleAuthProvider();
          p.setCustomParameters({ prompt: "select_account" });
          return p;
        };
        try {
          await signInWithPopup(auth, makeProvider());
        } catch (popupErr: any) {
          const code: string = popupErr?.code || "";
          if (code === "auth/multi-factor-auth-required") {
            const resolver = getMultiFactorResolver(auth, popupErr);
            setMfaResolver(resolver);
            setMfaCode("");
            setMfaCodeError("");
            setView("mfa");
            setIsGoogleLoading(false);
            return;
          }
          if (
            code === "auth/popup-blocked" ||
            code === "auth/operation-not-supported-in-this-environment"
          ) {
            await signInWithRedirect(auth, makeProvider());
            return;
          }
          if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
            setIsGoogleLoading(false);
            return;
          }
          throw popupErr;
        }
      }
      setShouldRemember(false);
      const nextPath = resolvePostLoginPath();
      router.replace(nextPath);
      window.setTimeout(() => {
        if ((window.location.pathname || "") === "/login") window.location.replace(nextPath);
      }, 350);
    } catch (err: any) {
      if (err?.code === "auth/multi-factor-auth-required") {
        const resolver = getMultiFactorResolver(auth, err);
        setMfaResolver(resolver);
        setMfaCode("");
        setMfaCodeError("");
        setView("mfa");
        setIsGoogleLoading(false);
        return;
      }
      console.error("[Google Sign-In] error:", err);
      // Ensure Firebase auth is fully cleared so the next attempt starts fresh.
      await signOut(auth).catch(() => {});
      const errDesc = err?.code
        ? `Error: ${err.code}`
        : err?.message
          ? err.message.slice(0, 120)
          : err?.toString?.()?.slice(0, 120) ?? "Please try again.";
      toast({ title: "Google sign-in failed", description: errDesc || "Unknown error — check console", variant: "destructive" });
      setIsGoogleLoading(false);
    }
  };

  const handleMfaSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaResolver) return;
    const code = mfaCode.trim();
    if (!code) { setMfaCodeError("Verification code is required."); return; }
    setIsMfaLoading(true);
    setMfaCodeError("");
    try {
      const hint = mfaResolver.hints[0];
      if (hint.factorId !== TotpMultiFactorGenerator.FACTOR_ID) {
        setMfaCodeError("Unsupported MFA type. Please contact your administrator.");
        return;
      }
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await mfaResolver.resolveSignIn(assertion);
      setShouldRemember(false);
      const nextPath = resolvePostLoginPath();
      router.replace(nextPath);
    } catch (err: any) {
      const errCode: string = err?.code ?? "";
      if (errCode === "auth/invalid-verification-code") {
        setMfaCodeError("Incorrect code. Check your authenticator app and try again.");
      } else if (errCode === "auth/code-expired") {
        setMfaCodeError("Code has expired. Please wait for the next code from your authenticator app.");
      } else {
        setMfaCodeError(err?.message ?? "Verification failed. Please try again.");
      }
    } finally {
      setIsMfaLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateSignInFields()) return;

    // Require reCAPTCHA checkbox to be completed
    if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
      setPasswordError("Please complete the reCAPTCHA verification.");
      return;
    }

    const finalEmail = (activeUser ? activeUser.email : email).trim().toLowerCase();
    setIsLoading(true);
    try {
      // Server-side reCAPTCHA token verification
      if (RECAPTCHA_SITE_KEY && recaptchaToken) {
        const verifyRes = await fetch('/api/verify-recaptcha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: recaptchaToken }),
        });
        const { success } = await verifyRes.json().catch(() => ({ success: false }));
        if (!success) {
          setPasswordError("reCAPTCHA verification failed. Please try again.");
          recaptchaRef.current?.reset();
          setRecaptchaToken('');
          setIsLoading(false);
          return;
        }
      }

      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, finalEmail, password);
      setShouldRemember(rememberMe);
      const nextPath = resolvePostLoginPath();
      router.replace(nextPath);
      window.setTimeout(() => {
        if ((window.location.pathname || "") !== nextPath) window.location.replace(nextPath);
      }, 80);
      window.setTimeout(() => {
        const livePath = window.location.pathname || "";
        if (livePath === "/login" || livePath === "/login/") window.location.replace(nextPath);
      }, 350);
    } catch (err: any) {
      setShouldRemember(false);
      const msg = mapFirebaseError(err?.code);
      setPasswordError(msg);
      // Reset reCAPTCHA so user can retry (tokens are single-use)
      recaptchaRef.current?.reset();
      setRecaptchaToken('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = forgotEmail.trim().toLowerCase();
    if (!normalized) { setForgotEmailError("Email is required."); return; }
    if (!isValidEmail(normalized)) { setForgotEmailError("Enter a valid email address."); return; }
    setForgotEmailError("");
    setIsForgotLoading(true);
    try {
      const res = await fetch("/api/send-password-reset-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setForgotEmailError(data?.error || "Failed to send reset email. Please try again.");
        return;
      }
    } catch {
      setForgotEmailError("Network error. Please check your connection and try again.");
      return;
    } finally {
      setIsForgotLoading(false);
    }
    setView("forgot-sent");
  };

  const handleProfileClick = (user: SavedUser) => {
    setActiveUser(user);
    setEmail(user.email || "");
    setForgotEmail(user.email || "");
    setPassword("");
    setPasswordError("");
    setView("password");
  };

  // ── views ──

  const renderProfiles = () => (
    <div className="text-center w-full space-y-6">
      <div>
        <h2 className={cn("text-xl font-semibold", tone.title)}>Who&apos;s signing in?</h2>
        <p className={cn("text-sm mt-1", tone.subtitle)}>Select your profile to continue</p>
      </div>
      <div className="flex justify-center flex-wrap gap-4">
        {savedUsers.map((u) => (
          <button
            key={u.id}
            onClick={() => handleProfileClick(u)}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 w-28 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              tone.profileCard
            )}
          >
            <Avatar className={cn("h-16 w-16 ring-2 transition-all", tone.avatarRing)}>
              <AvatarImage src={u.photoURL} alt={u.name} />
              <AvatarFallback className={cn("text-lg font-semibold", tone.avatarFallback)}>
                {getInitials(u.name)}
              </AvatarFallback>
            </Avatar>
            <p className={cn("text-sm font-medium text-center leading-tight line-clamp-2", tone.profileName)}>{u.name}</p>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className={cn("text-xs", tone.ghostButton)}
        onClick={() => { setActiveUser(null); setView("password"); }}>
        <Mail className="mr-1.5 h-3.5 w-3.5" /> Use email & password
      </Button>

      <OrDivider tone={tone} />

      <Button
        type="button"
        variant="outline"
        className={cn("w-full gap-2 transition-all", tone.outlineButton)}
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
      >
        {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>
    </div>
  );

  const renderPassword = () => (
    <div className="w-full space-y-6">
      <div className="text-center">
        {activeUser ? (
          <div className="space-y-2">
            <Avatar className={cn("h-16 w-16 mx-auto ring-2", tone.avatarRing)}>
              <AvatarImage src={activeUser.photoURL} alt={activeUser.name} />
              <AvatarFallback className={cn("text-xl font-semibold", tone.avatarFallback)}>
                {getInitials(activeUser.name)}
              </AvatarFallback>
            </Avatar>
            <h2 className={cn("text-lg font-semibold", tone.title)}>{activeUser.name}</h2>
            <p className={cn("text-xs", tone.subtitle)}>{activeUser.email}</p>
          </div>
        ) : (
          <div>
            <h2 className={cn("text-xl font-semibold", tone.title)}>Welcome back</h2>
            <p className={cn("text-sm mt-1", tone.subtitle)}>Sign in to your account</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSignIn} className="space-y-4 w-full" noValidate>
        {!activeUser && (
          <div className="space-y-1.5">
            <Label htmlFor="email" className={cn("text-sm font-medium", tone.label)}>Email</Label>
            <IconInput
              ref={emailRef}
              tone={tone}
              icon={Mail}
              id="email"
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value.toLowerCase()); if (emailError) setEmailError(""); }}
              onBlur={() => { if (email && !isValidEmail(email)) setEmailError("Enter a valid email address."); else setEmailError(""); }}
              invalid={!!emailError}
              autoComplete="email"
            />
            {emailError && <p className={cn("text-xs", tone.error)}>{emailError}</p>}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className={cn("text-sm font-medium", tone.label)}>Password</Label>
            <button
              type="button"
              onClick={() => { setForgotEmail((activeUser ? activeUser.email : email).trim().toLowerCase()); setView("forgot"); }}
              className={cn("text-xs transition-colors", tone.link)}
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            tone={tone}
            id="password"
            value={password}
            onChange={(v) => { setPassword(v); if (passwordError) setPasswordError(""); }}
            autoFocus={!!activeUser}
            error={passwordError}
          />
        </div>

        {/* reCAPTCHA v2 visible checkbox — a fixed 304px widget, so it lines up with the inputs' left edge */}
        {RECAPTCHA_SITE_KEY && (
          <div className="flex justify-start py-1">
            <ReCAPTCHA
              // A new widget when the design changes surface: the theme is read once, on mount.
              key={tone.recaptcha}
              ref={recaptchaRef}
              sitekey={RECAPTCHA_SITE_KEY}
              theme={tone.recaptcha}
              onChange={(token) => setRecaptchaToken(token ?? '')}
              onExpired={() => setRecaptchaToken('')}
              onError={() => setRecaptchaToken('')}
            />
          </div>
        )}

        {!activeUser && (
          <div className="flex items-center gap-2">
            <Checkbox id="remember" className={tone.checkbox} checked={rememberMe} onCheckedChange={(c) => setRememberMe(!!c)} />
            <label htmlFor="remember" className={cn("text-sm cursor-pointer select-none", tone.checkLabel)}>
              Keep me signed in
            </label>
          </div>
        )}

        <Button
          type="submit"
          className={cn("w-full transition-all duration-200 active:scale-[0.98]", tone.primaryButton)}
          disabled={isLoading}
        >
          {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : "Sign In"}
        </Button>

        <OrDivider tone={tone} />

        <Button
          type="button"
          variant="outline"
          className={cn("w-full gap-2 transition-all", tone.outlineButton)}
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading || isLoading}
        >
          {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </Button>

        {savedUsers.length > 0 && (
          <Button variant="ghost" type="button" size="sm"
            className={cn("w-full text-xs", tone.ghostButton)}
            onClick={() => { setView("profiles"); setActiveUser(null); setPassword(""); setPasswordError(""); }}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to profiles
          </Button>
        )}
      </form>
    </div>
  );

  const renderForgot = () => (
    <div className="w-full space-y-6">
      <div className="text-center">
        <h2 className={cn("text-xl font-semibold", tone.title)}>Reset Password</h2>
        <p className={cn("text-sm mt-1", tone.subtitle)}>
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form onSubmit={handleForgotPassword} className="space-y-4 w-full" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="forgot-email" className={cn("text-sm font-medium", tone.label)}>Email address</Label>
          <IconInput
            tone={tone}
            icon={Mail}
            id="forgot-email"
            type="email"
            placeholder="you@example.com"
            required
            value={forgotEmail}
            onChange={(e) => { setForgotEmail(e.target.value.toLowerCase()); if (forgotEmailError) setForgotEmailError(""); }}
            invalid={!!forgotEmailError}
            autoFocus
          />
          {forgotEmailError && <p className={cn("text-xs", tone.error)}>{forgotEmailError}</p>}
        </div>

        <Button type="submit" className={cn("w-full", tone.primaryButton)} disabled={isForgotLoading}>
          {isForgotLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : "Send Reset Link"}
        </Button>
        <Button variant="ghost" type="button" size="sm"
          className={cn("w-full text-xs", tone.ghostButton)}
          onClick={() => { setView("password"); setForgotEmailError(""); }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to sign in
        </Button>
      </form>
    </div>
  );

  const renderForgotSent = () => (
    <div className="w-full text-center space-y-6">
      <div className="flex flex-col items-center gap-4">
        <div className={cn("flex h-16 w-16 items-center justify-center rounded-full ring-2", tone.successBadge)}>
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <div>
          <h2 className={cn("text-xl font-semibold", tone.title)}>Check your inbox</h2>
          <p className={cn("text-sm mt-2 max-w-xs mx-auto", tone.subtitle)}>
            If <span className={tone.strong}>{forgotEmail}</span> is registered,
            a password reset link has been sent.
          </p>
        </div>
        <p className={cn("text-xs", tone.faint)}>Didn&apos;t receive it? Check spam or</p>
        <Button variant="ghost" size="sm"
          className={cn("gap-1.5 text-xs", tone.ghostButton)}
          onClick={() => { setView("forgot"); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
      <Button variant="ghost" size="sm"
        className={cn("text-xs", tone.ghostButton)}
        onClick={() => { setView("password"); setForgotEmailError(""); }}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to sign in
      </Button>
    </div>
  );

  const renderMfa = () => (
    <div className="w-full space-y-6">
      <div className="text-center">
        <div className="flex flex-col items-center gap-2">
          <div className={cn("flex h-14 w-14 items-center justify-center rounded-full ring-2", tone.infoBadge)}>
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className={cn("text-xl font-semibold", tone.title)}>Two-Factor Authentication</h2>
          <p className={cn("text-sm text-center max-w-xs", tone.subtitle)}>
            Open your authenticator app and enter the 6-digit code for this account.
          </p>
        </div>
      </div>

      <form onSubmit={handleMfaSignIn} className="space-y-4 w-full" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code" className={cn("text-sm font-medium", tone.label)}>
            Verification code
          </Label>
          <Input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000 000"
            required
            value={mfaCode}
            onChange={(e) => {
              setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              if (mfaCodeError) setMfaCodeError("");
            }}
            className={cn(
              "text-center font-mono text-2xl tracking-[0.5em] h-14 transition-colors",
              tone.input,
              mfaCodeError && tone.inputError
            )}
            autoFocus
            autoComplete="one-time-code"
          />
          {mfaCodeError && <p className={cn("text-xs", tone.error)}>{mfaCodeError}</p>}
        </div>

        <Button
          type="submit"
          className={cn("w-full", tone.primaryButton)}
          disabled={isMfaLoading || mfaCode.length < 6}
        >
          {isMfaLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
            : "Verify & Sign In"}
        </Button>

        <Button
          variant="ghost"
          type="button"
          size="sm"
          className={cn("w-full text-xs", tone.ghostButton)}
          onClick={() => {
            setView("password");
            setMfaResolver(null);
            setMfaCode("");
            setMfaCodeError("");
          }}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Cancel
        </Button>
      </form>
    </div>
  );

  const renderContent = () => {
    switch (view) {
      case "mfa": return renderMfa();
      case "forgot": return renderForgot();
      case "forgot-sent": return renderForgotSent();
      case "password": return renderPassword();
      default: return savedUsers.length > 0 ? renderProfiles() : renderPassword();
    }
  };

  // Until the company's design is known (first visit on this device), show a neutral screen
  // rather than one design that then turns into another.
  if (!companyKnown) return <LoginSplash />;

  return <LoginDesignFrame branding={branding}>{renderContent()}</LoginDesignFrame>;
}
