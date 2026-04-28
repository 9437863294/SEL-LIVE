
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
} from "firebase/auth";
import { Loader2, User as UserIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SavedUser } from "@/lib/types";
import { ElectricBackdrop } from "@/components/effects/ElectricBackdrop";

export function LoginPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const {
    setShouldRemember, 
    savedUsers,
    loadSavedUsers,
    loading: authLoading,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [activeUser, setActiveUser] = useState<SavedUser | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Optional PIN UI state (no longer used to reveal a stored password)
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Forgot Password state
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);

  const resolvePostLoginPath = () => {
    const redirectParam = searchParams?.get("redirect");
    if (
      typeof redirectParam === "string" &&
      redirectParam.startsWith("/") &&
      !redirectParam.startsWith("//") &&
      redirectParam !== "/login" &&
      redirectParam !== "/login/" &&
      redirectParam !== "/driver-login" &&
      redirectParam !== "/driver-login/"
    ) {
      return redirectParam;
    }

    const appParam = searchParams?.get("app");
    const isDriverContext =
      appParam === "driver" ||
      pathname === "/driver-login" ||
      pathname === "/driver-login/" ||
      (() => {
        if (typeof window === "undefined") return false;
        const maybeCapacitor = (window as any).Capacitor;
        if (typeof maybeCapacitor?.isNativePlatform === "function" && maybeCapacitor.isNativePlatform()) {
          return true;
        }
        const ua = navigator.userAgent || "";
        return /Android/i.test(ua) && /\bwv\b/i.test(ua);
      })();

    return isDriverContext ? "/driver-management" : "/";
  };

  // Load saved profiles once when login page mounts.
  useEffect(() => {
    loadSavedUsers();
  }, [loadSavedUsers]);

  // If no saved users, default to password form.
  useEffect(() => {
    if (!authLoading && savedUsers.length === 0 && !showPasswordForm) {
      setShowPasswordForm(true);
    }
  }, [savedUsers, showPasswordForm, authLoading]);

  const mapFirebaseError = (code: string) => {
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "Incorrect email or password.";
      case "auth/invalid-email":
        return "Please enter a valid email address.";
      case "auth/user-not-found":
        return "No account found with that email.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/too-many-requests":
        return "Too many attempts. Please try again later.";
      case "auth/network-request-failed":
        return "Network error. Check your connection.";
      default:
        return "Sign in failed. Please try again.";
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalEmail = (activeUser ? activeUser.email : email).trim().toLowerCase();
    if (!finalEmail || !password) {
      toast({
        title: "Error",
        description: "Please enter both email and password.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Map Remember me to Firebase persistence.
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
      
      // Let AuthProvider’s onAuthStateChanged handle nav after success
      await signInWithEmailAndPassword(auth, finalEmail, password);

      // Tell AuthProvider whether to remember non-sensitive profile prefs
      setShouldRemember(rememberMe);

      const nextPath = resolvePostLoginPath();
      router.replace(nextPath);
      window.setTimeout(() => {
        if ((window.location.pathname || "") !== nextPath) {
          window.location.replace(nextPath);
        }
      }, 80);
      window.setTimeout(() => {
        const livePath = window.location.pathname || "";
        if (livePath === "/login" || livePath === "/login/") {
          window.location.replace(nextPath);
        }
      }, 350);

      toast({
        title: "Success",
        description: "Signed in successfully.",
      });
    } catch (err: any) {
      const msg = mapFirebaseError(err?.code);
      setShouldRemember(false);
      toast({
        title: "Sign In Failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = forgotEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      toast({
        title: "Error",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setIsForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      toast({
        title: "Reset Link Sent",
        description: "If this email is registered, a reset link has been sent.",
      });
      setForgotEmail(normalizedEmail);
      setIsForgotPassword(false);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "auth/user-not-found") {
        toast({
          title: "Reset Link Sent",
          description: "If this email is registered, a reset link has been sent.",
        });
        setIsForgotPassword(false);
        return;
      }
      toast({
        title: "Error",
        description: mapFirebaseError(code || ""),
        variant: "destructive",
      });
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleProfileClick = (user: SavedUser) => {
    setActiveUser(user);
    setEmail(user.email || "");
    setForgotEmail(user.email || "");
    // Go straight to password sign-in for the selected profile.
    setShowPasswordForm(true);
    setPin("");
    setPinError("");
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();

  // --- PIN handling (UI only now) ---
  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, "");
    if (value.length <= 4) {
      setPin(value);
      setPinError("");
    }
  };

  const handlePinSubmit = async () => {
    // This no longer attempts to derive a password or sign in with secrets.
    // Use this as:
    //  - a quick “profile unlock” before revealing the email field,
    //  - OR trigger WebAuthn/passkey for this profile here.
    if (!activeUser) return;
    if (pin.length !== 4) {
      setPinError("PIN must be 4 digits.");
      return;
    }

    setIsLoading(true);

    try {
      // Example: future passkey flow
      // await signInWithPasskeyForEmail(activeUser.email)
      // router.push("/");

      // For now, just switch to password form with the profile’s email pre-selected.
      setShowPasswordForm(true);
      toast({
        title: "Profile unlocked",
        description: "Enter your password to continue.",
      });
    } finally {
      setIsLoading(false);
      setPin("");
    }
  };

  const renderProfileSelection = () => (
    <div className="text-center w-full">
      <div className="relative h-24 w-full max-w-[70%] mx-auto">
        <Image
          src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd"
          alt="Company Logo"
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          style={{ objectFit: "contain" }}
          priority
        />
      </div>
      <h2 className="text-2xl font-semibold mb-2 text-white">Who's signing in?</h2>
      <p className="text-slate-300/70 mb-8">Select a profile to continue.</p>
      <div className="flex justify-center flex-wrap gap-6">
        {savedUsers.map((user) => (
          <div
            key={user.id}
            onClick={() => handleProfileClick(user)}
            className="flex flex-col items-center gap-2 cursor-pointer p-4 rounded-xl border border-white/10 bg-slate-900/20 hover:bg-slate-800/40 transition-colors w-32"
          >
            <Avatar className="h-20 w-20">
              <AvatarImage src={user.photoURL} alt={user.name} />
              <AvatarFallback className="text-2xl">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <p className="font-medium text-center whitespace-nowrap text-slate-100">
              {user.name}
            </p>
          </div>
        ))}
      </div>
      <Button
        variant="link"
        className="mt-8"
        onClick={() => {
          setActiveUser(null);
          setShowPasswordForm(true);
        }}
      >
        Sign in with email and password
      </Button>
    </div>
  );

  const renderPasswordForm = () => (
    <div className="w-full text-center">
      <div className="relative h-24 w-full max-w-[70%] mx-auto">
        <Image
          src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd"
          alt="Company Logo"
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          style={{ objectFit: "contain" }}
          priority
        />
      </div>

      {activeUser && (
        <>
          <Avatar className="h-24 w-24 mx-auto mt-4">
            <AvatarImage src={activeUser.photoURL} alt={activeUser.name} />
            <AvatarFallback className="text-3xl">
              {getInitials(activeUser.name)}
            </AvatarFallback>
          </Avatar>
          <h2 className="text-2xl font-semibold mt-4">{activeUser.name}</h2>
        </>
      )}

      <p className="text-slate-300/70 mt-2 mb-8">
        Welcome! Please sign in to continue.
      </p>

      <form onSubmit={handleSignIn} className="space-y-6 w-full max-w-sm mx-auto">
        {!activeUser && (
          <div className="space-y-2 text-left">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="abc@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              className="bg-slate-900/40 border-white/10 focus-visible:ring-primary/60"
              autoComplete="email"
            />
          </div>
        )}
        <div className="space-y-2 text-left">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-slate-900/40 border-white/10 focus-visible:ring-primary/60"
            autoComplete="current-password"
            aria-invalid={false}
          />
        </div>

        <div className="flex items-center justify-between !mt-2">
          {!activeUser && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember-me"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(!!checked)}
              />
              <label
                htmlFor="remember-me"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                Remember me
              </label>
            </div>
          )}
          <Button
            type="button"
            variant="link"
            className="text-xs p-0 h-auto text-primary/80 hover:text-primary"
            onClick={() => {
              setIsForgotPassword(true);
              setForgotEmail((activeUser ? activeUser.email : email).trim().toLowerCase());
            }}
          >
            Forgot password?
          </Button>
        </div>

        <Button
          type="submit"
          className="w-full !mt-6 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
          disabled={isLoading}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>

        {savedUsers.length > 0 && (
          <Button
            variant="ghost"
            type="button"
            className="w-full text-slate-300 hover:text-slate-100 hover:bg-white/5"
            onClick={() => {
              setShowPasswordForm(false);
              setActiveUser(null);
            }}
          >
            <UserIcon className="mr-2 h-4 w-4" /> Sign in with a saved profile
          </Button>
        )}
      </form>
    </div>
  );

  const renderForgotPasswordForm = () => (
    <div className="w-full text-center space-y-6">
      <div className="relative h-24 w-full max-w-[60%] mx-auto">
        <Image
          src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd"
          alt="Company Logo"
          fill
          style={{ objectFit: "contain" }}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Reset Password</h2>
        <p className="text-slate-300/70 text-sm">
          Enter your email and we'll send you a link to reset your password.
        </p>
      </div>

      <form onSubmit={handleForgotPassword} className="space-y-4 w-full max-w-sm mx-auto">
        <div className="space-y-2 text-left">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            placeholder="name@example.com"
            required
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value.toLowerCase())}
            className="bg-slate-900/40 border-white/10 focus-visible:ring-primary/60"
          />
        </div>

        <Button type="submit" className="w-full" disabled={isForgotLoading}>
          {isForgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send Reset Link
        </Button>

        <Button
          variant="link"
          type="button"
          className="w-full text-xs"
          onClick={() => {
            setIsForgotPassword(false);
            setForgotEmail("");
          }}
        >
          Back to Login
        </Button>
      </form>
    </div>
  );

  const renderPinForm = () => {
    if (!activeUser) return null;
    return (
      <div className="w-full text-center">
        <div className="relative h-24 w-full max-w-[70%] mx-auto">
          <Image
            src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FUntitled-1.png?alt=media&token=02963da9-54c3-4aaa-91e0-ac5d38bd6412"
            alt="Company Logo"
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <Avatar className="h-24 w-24 mx-auto mt-4">
          <AvatarImage src={activeUser.photoURL} alt={activeUser.name} />
          <AvatarFallback className="text-3xl">
            {getInitials(activeUser.name)}
          </AvatarFallback>
        </Avatar>
        <h2 className="text-2xl font-semibold mt-4">{activeUser.name}</h2>

        <div className="w-full max-w-xs mx-auto mt-6">
          <Input
            type="password"
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
            placeholder="PIN"
            className="text-center text-2xl tracking-[1rem] h-14 bg-slate-900/40 border-white/10 focus-visible:ring-primary/60"
            autoComplete="one-time-code"
            inputMode="numeric"
            aria-invalid={!!pinError}
          />
          {pinError && (
            <p className="text-destructive text-sm mt-2" role="alert">
              {pinError}
            </p>
          )}
          <Button
            onClick={handlePinSubmit}
            disabled={isLoading || pin.length !== 4}
            className="w-full mt-4"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>

        <Button
          variant="link"
          className="mt-2 text-xs"
          onClick={() => {
            if (activeUser) {
              setShowPasswordForm(true);
            }
          }}
        >
          Sign in with password
        </Button>
        <Button variant="link" className="mt-4" onClick={() => setActiveUser(null)}>
          Not you? Select a different profile
        </Button>
      </div>
    );
  };

  const renderContent = () => {
    if (isForgotPassword) return renderForgotPasswordForm();
    if (showPasswordForm || savedUsers.length === 0) return renderPasswordForm();
    if (activeUser) return renderPinForm();
    return renderProfileSelection();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#020617] text-slate-100">
      <ElectricBackdrop />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-3xl border border-cyan-300/15 bg-slate-950/45 shadow-[0_30px_120px_-40px_rgba(14,116,255,0.8)] backdrop-blur-xl md:grid-cols-2">
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-gradient-to-br from-cyan-500/15 via-slate-900/85 to-blue-900/20 p-12 md:flex">
            <div className="absolute inset-0 bg-electric-grid opacity-15" />
            <div className="absolute left-[-9rem] top-[-6rem] h-72 w-72 rounded-full bg-cyan-300/15 blur-[90px]" />
            <div className="absolute bottom-[-9rem] right-[-8rem] h-80 w-80 rounded-full bg-blue-500/20 blur-[120px]" />
            <div className="relative z-10">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-400/20 shadow-lg shadow-cyan-500/30">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-200 animate-electric-flicker" />
                </div>
                <span className="text-xl font-semibold tracking-[0.2em] text-cyan-100">SEL LIVE</span>
              </div>

              <h1 className="mb-6 text-4xl font-bold leading-tight text-white lg:text-5xl">
                Powering every
                <br />
                project through
                <br />
                <span className="text-cyan-300">live electrical intelligence.</span>
              </h1>
              <p className="max-w-md text-base text-cyan-100/70">
                Monitor execution, approvals, and field operations from one control layer built for electrical engineering teams.
              </p>
            </div>

            <div className="relative z-10 mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="mb-2 h-1 w-24 rounded-full bg-cyan-300/60" />
              <p className="text-sm text-cyan-100/85">
                Voltage-safe workflows, faster approvals, and complete traceability across departments.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-cyan-200/70">
                <span className="h-2 w-2 rounded-full bg-cyan-300 animate-electric-flicker" />
                Live status synchronized
              </div>
            </div>
          </div>

          <div className="relative flex min-h-[620px] flex-col items-center justify-center bg-[#020617]/65 p-8 md:p-16">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-400/8 via-transparent to-blue-500/8" />
            <div className="w-full max-w-sm shrink-0">
              {renderContent()}
            </div>
            
            <div className="mt-12 text-center text-xs text-slate-400/70">
              &copy; {new Date().getFullYear()} Siddhartha Engineering Limited. All rights reserved.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
