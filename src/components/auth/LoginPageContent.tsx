"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
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
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SavedUser } from "@/lib/types";
import { ElectricBackdrop } from "@/components/effects/ElectricBackdrop";
import { cn } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────

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

const LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd";

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// ─── Left panel feature highlights ────────────────────────────────────────────

const FEATURES = [
  { label: "Live workflows", desc: "Real-time approvals and status tracking" },
  { label: "Field operations", desc: "Monitor execution across all sites" },
  { label: "Smart finance", desc: "Requisitions, billing and loan management" },
];

// ─── sub-components ────────────────────────────────────────────────────────────

function LogoBlock() {
  return (
    <div className="relative mx-auto h-20 w-[65%]">
      <Image
        src={LOGO_URL}
        alt="SEL Logo"
        fill
        sizes="260px"
        style={{ objectFit: "contain" }}
        priority
      />
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder = "Enter your password",
  autoFocus,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          type={show ? "text" : "password"}
          required
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="current-password"
          aria-invalid={!!error}
          className={cn(
            "pl-9 pr-10 bg-slate-900/40 border-white/10 focus-visible:ring-primary/60 focus-visible:border-primary/50 transition-colors",
            error && "border-rose-500/60 focus-visible:ring-rose-500/30"
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export function LoginPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const emailRef = useRef<HTMLInputElement>(null);

  const { setShouldRemember, savedUsers, loadSavedUsers, loading: authLoading } = useAuth();

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
  }, [view, activeUser]);

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

    const finalEmail = (activeUser ? activeUser.email : email).trim().toLowerCase();
    setIsLoading(true);
    try {
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
      <LogoBlock />
      <div>
        <h2 className="text-xl font-semibold text-white">Who's signing in?</h2>
        <p className="text-sm text-slate-400 mt-1">Select your profile to continue</p>
      </div>
      <div className="flex justify-center flex-wrap gap-4">
        {savedUsers.map((u) => (
          <button
            key={u.id}
            onClick={() => handleProfileClick(u)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-slate-900/30 hover:bg-slate-800/50 hover:border-cyan-400/30 transition-all duration-200 w-28 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Avatar className="h-16 w-16 ring-2 ring-white/10 group-hover:ring-cyan-400/40 transition-all">
              <AvatarImage src={u.photoURL} alt={u.name} />
              <AvatarFallback className="text-lg font-semibold bg-slate-800 text-cyan-300">
                {getInitials(u.name)}
              </AvatarFallback>
            </Avatar>
            <p className="text-sm font-medium text-slate-100 text-center leading-tight line-clamp-2">{u.name}</p>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-100 hover:bg-white/5 text-xs"
        onClick={() => { setActiveUser(null); setView("password"); }}>
        <Mail className="mr-1.5 h-3.5 w-3.5" /> Use email & password
      </Button>

      <div className="relative flex items-center gap-3 w-full">
        <div className="flex-1 border-t border-white/10" />
        <span className="text-xs text-slate-500">or</span>
        <div className="flex-1 border-t border-white/10" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full border-white/10 bg-slate-900/40 text-slate-200 hover:bg-slate-800/60 hover:border-white/20 gap-2 transition-all"
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
        <LogoBlock />
        {activeUser ? (
          <div className="mt-4 space-y-2">
            <Avatar className="h-16 w-16 mx-auto ring-2 ring-cyan-400/30">
              <AvatarImage src={activeUser.photoURL} alt={activeUser.name} />
              <AvatarFallback className="text-xl font-semibold bg-slate-800 text-cyan-300">
                {getInitials(activeUser.name)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-lg font-semibold text-white">{activeUser.name}</h2>
            <p className="text-xs text-slate-400">{activeUser.email}</p>
          </div>
        ) : (
          <div className="mt-3">
            <h2 className="text-xl font-semibold text-white">Welcome back</h2>
            <p className="text-sm text-slate-400 mt-1">Sign in to your account</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSignIn} className="space-y-4 w-full" noValidate>
        {!activeUser && (
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-slate-300">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                ref={emailRef}
                id="email"
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value.toLowerCase()); if (emailError) setEmailError(""); }}
                onBlur={() => { if (email && !isValidEmail(email)) setEmailError("Enter a valid email address."); else setEmailError(""); }}
                className={cn(
                  "pl-9 bg-slate-900/40 border-white/10 focus-visible:ring-primary/60 focus-visible:border-primary/50 transition-colors",
                  emailError && "border-rose-500/60 focus-visible:ring-rose-500/30"
                )}
                autoComplete="email"
                aria-invalid={!!emailError}
              />
            </div>
            {emailError && <p className="text-xs text-rose-400">{emailError}</p>}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-slate-300">Password</Label>
            <button
              type="button"
              onClick={() => { setForgotEmail((activeUser ? activeUser.email : email).trim().toLowerCase()); setView("forgot"); }}
              className="text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            value={password}
            onChange={(v) => { setPassword(v); if (passwordError) setPasswordError(""); }}
            autoFocus={!!activeUser}
            error={passwordError}
          />
        </div>

        {!activeUser && (
          <div className="flex items-center gap-2">
            <Checkbox id="remember" checked={rememberMe} onCheckedChange={(c) => setRememberMe(!!c)} />
            <label htmlFor="remember" className="text-sm text-slate-300 cursor-pointer select-none">
              Keep me signed in
            </label>
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98]"
          disabled={isLoading}
        >
          {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : "Sign In"}
        </Button>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-white/10" />
          <span className="text-xs text-slate-500">or</span>
          <div className="flex-1 border-t border-white/10" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full border-white/10 bg-slate-900/40 text-slate-200 hover:bg-slate-800/60 hover:border-white/20 gap-2 transition-all"
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading || isLoading}
        >
          {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </Button>

        {savedUsers.length > 0 && (
          <Button variant="ghost" type="button" size="sm"
            className="w-full text-slate-400 hover:text-slate-100 hover:bg-white/5 text-xs"
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
        <LogoBlock />
        <div className="mt-4">
          <h2 className="text-xl font-semibold text-white">Reset Password</h2>
          <p className="text-sm text-slate-400 mt-1">
            Enter your email and we'll send you a reset link.
          </p>
        </div>
      </div>

      <form onSubmit={handleForgotPassword} className="space-y-4 w-full" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="forgot-email" className="text-sm font-medium text-slate-300">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              id="forgot-email"
              type="email"
              placeholder="you@example.com"
              required
              value={forgotEmail}
              onChange={(e) => { setForgotEmail(e.target.value.toLowerCase()); if (forgotEmailError) setForgotEmailError(""); }}
              className={cn(
                "pl-9 bg-slate-900/40 border-white/10 focus-visible:ring-primary/60 focus-visible:border-primary/50 transition-colors",
                forgotEmailError && "border-rose-500/60"
              )}
              autoFocus
            />
          </div>
          {forgotEmailError && <p className="text-xs text-rose-400">{forgotEmailError}</p>}
        </div>

        <Button type="submit" className="w-full" disabled={isForgotLoading}>
          {isForgotLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : "Send Reset Link"}
        </Button>
        <Button variant="ghost" type="button" size="sm"
          className="w-full text-slate-400 hover:text-slate-100 hover:bg-white/5 text-xs"
          onClick={() => { setView("password"); setForgotEmailError(""); }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to sign in
        </Button>
      </form>
    </div>
  );

  const renderForgotSent = () => (
    <div className="w-full text-center space-y-6">
      <LogoBlock />
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-400/30">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">Check your inbox</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto">
            If <span className="text-slate-200 font-medium">{forgotEmail}</span> is registered,
            a password reset link has been sent.
          </p>
        </div>
        <p className="text-xs text-slate-500">Didn't receive it? Check spam or</p>
        <Button variant="ghost" size="sm"
          className="gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-white/5"
          onClick={() => { setView("forgot"); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
      <Button variant="ghost" size="sm"
        className="text-slate-400 hover:text-slate-100 hover:bg-white/5 text-xs"
        onClick={() => { setView("password"); setForgotEmailError(""); }}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to sign in
      </Button>
    </div>
  );

  const renderMfa = () => (
    <div className="w-full space-y-6">
      <div className="text-center">
        <LogoBlock />
        <div className="mt-5 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500/15 ring-2 ring-cyan-400/30">
            <ShieldCheck className="h-7 w-7 text-cyan-400" />
          </div>
          <h2 className="text-xl font-semibold text-white">Two-Factor Authentication</h2>
          <p className="text-sm text-slate-400 text-center max-w-xs">
            Open your authenticator app and enter the 6-digit code for this account.
          </p>
        </div>
      </div>

      <form onSubmit={handleMfaSignIn} className="space-y-4 w-full" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code" className="text-sm font-medium text-slate-300">
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
              "text-center font-mono text-2xl tracking-[0.5em] bg-slate-900/40 border-white/10 focus-visible:ring-primary/60 focus-visible:border-primary/50 h-14 transition-colors",
              mfaCodeError && "border-rose-500/60 focus-visible:ring-rose-500/30"
            )}
            autoFocus
            autoComplete="one-time-code"
          />
          {mfaCodeError && <p className="text-xs text-rose-400">{mfaCodeError}</p>}
        </div>

        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25"
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
          className="w-full text-slate-400 hover:text-slate-100 hover:bg-white/5 text-xs"
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

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#020617] text-slate-100">
      <ElectricBackdrop />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-950/50 shadow-[0_30px_120px_-40px_rgba(14,116,255,0.7)] backdrop-blur-xl md:grid-cols-2">

          {/* ── Left: Branding panel ── */}
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-gradient-to-br from-cyan-500/12 via-slate-900/80 to-blue-900/20 p-10 md:flex">
            <div className="absolute inset-0 opacity-15"
              style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(100,200,255,0.25) 1px, transparent 0)', backgroundSize: '28px 28px' }} />
            <div className="absolute left-[-8rem] top-[-5rem] h-64 w-64 rounded-full bg-cyan-300/12 blur-[80px]" />
            <div className="absolute bottom-[-8rem] right-[-7rem] h-72 w-72 rounded-full bg-blue-500/15 blur-[100px]" />

            <div className="relative z-10">
              <div className="mb-6 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-400/15 shadow-lg shadow-cyan-500/20">
                  <div className="h-2 w-2 rounded-full bg-cyan-200 animate-electric-flicker" />
                </div>
                <span className="text-lg font-semibold tracking-[0.18em] text-cyan-100">SEL LIVE</span>
              </div>

              <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-white lg:text-4xl">
                Powering every project
                <br />
                through <span className="text-cyan-300">live intelligence</span>
              </h1>
              <p className="text-sm text-cyan-100/65 max-w-xs leading-relaxed">
                Monitor execution, approvals, and field operations from one control layer built for engineering teams.
              </p>
            </div>

            <div className="relative z-10 space-y-3">
              {FEATURES.map((f) => (
                <div key={f.label} className="flex items-start gap-3 rounded-xl border border-cyan-300/15 bg-cyan-500/8 px-4 py-3">
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 animate-electric-flicker" />
                  <div>
                    <p className="text-xs font-semibold text-cyan-100">{f.label}</p>
                    <p className="text-xs text-cyan-200/55">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: Auth panel ── */}
          <div className="relative flex min-h-[600px] flex-col items-center justify-center bg-[#020617]/60 px-8 py-10 md:px-12">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-400/6 via-transparent to-blue-500/6" />
            <div className="relative z-10 w-full max-w-sm">
              {renderContent()}
            </div>
            <p className="relative z-10 mt-8 text-center text-[11px] text-slate-500/70">
              &copy; {new Date().getFullYear()} Siddhartha Engineering Limited · All rights reserved
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
