
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { PinSetupDialog } from "@/components/auth/PinSetupDialog";
import type { SavedUser, User } from "@/lib/types";

export function LoginPageContent() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const {
    user: authenticatedUser,
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

  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [userForPinSetup, setUserForPinSetup] = useState<User | null>(null);

  // Forgot Password state
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);

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
      case "auth/user-not-found":
        return "No account found with that email.";
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

    const finalEmail = activeUser ? activeUser.email : email;
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
    if (!forgotEmail) {
      toast({
        title: "Error",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setIsForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      toast({
        title: "Success",
        description: "Password reset link sent to your email.",
      });
      setIsForgotPassword(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: mapFirebaseError(err?.code),
        variant: "destructive",
      });
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleProfileClick = (user: SavedUser) => {
    setActiveUser(user);
    setShowPasswordForm(false);
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
      <div className="relative h-40 w-full max-w-[70%] mx-auto">
        <Image
          src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd"
          alt="Company Logo"
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          style={{ objectFit: "contain" }}
          priority
        />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Who's signing in?</h2>
      <p className="text-muted-foreground mb-8">Select a profile to continue.</p>
      <div className="flex justify-center flex-wrap gap-6">
        {savedUsers.map((user) => (
          <div
            key={user.id}
            onClick={() => handleProfileClick(user)}
            className="flex flex-col items-center gap-2 cursor-pointer p-4 rounded-lg hover:bg-muted transition-colors w-32"
          >
            <Avatar className="h-20 w-20">
              <AvatarImage src={user.photoURL} alt={user.name} />
              <AvatarFallback className="text-2xl">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <p className="font-medium text-center whitespace-nowrap">
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
      <div className="relative h-40 w-full max-w-[70%] mx-auto">
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

      <p className="text-muted-foreground mt-2 mb-8">
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
              onChange={(e) => setEmail(e.target.value)}
              className="bg-muted/50 border-0 focus:bg-background"
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
            className="bg-muted/50 border-0 focus:bg-background"
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
              setForgotEmail(activeUser ? activeUser.email : email);
            }}
          >
            Forgot password?
          </Button>
        </div>

        <Button type="submit" className="w-full !mt-6 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>

        {savedUsers.length > 0 && (
          <Button
            variant="ghost"
            type="button"
            className="w-full text-muted-foreground hover:text-foreground"
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
      <div className="relative h-32 w-full max-w-[60%] mx-auto">
        <Image
          src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fnew%20logo.png?alt=media&token=c5f1dbc2-10c5-4f36-9454-2b2a4b43b6dd"
          alt="Company Logo"
          fill
          style={{ objectFit: "contain" }}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Reset Password</h2>
        <p className="text-muted-foreground text-sm">
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
            onChange={(e) => setForgotEmail(e.target.value)}
            className="bg-background/50 border-white/10"
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
          onClick={() => setIsForgotPassword(false)}
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
        <div className="relative h-40 w-full max-w-[70%] mx-auto">
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
            className="text-center text-2xl tracking-[1rem] h-14"
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
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#020617]">
      {/* Dynamic Electrical Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-electric-grid opacity-20" />
        
        {/* Animated Orbs */}
        <div className="absolute top-[10%] left-[10%] w-[400px] h-[400px] bg-primary/20 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-[10%] right-[10%] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[150px] animate-pulse-glow" style={{ animationDelay: '-2s' }} />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] bg-purple-500/10 rounded-full blur-[100px] animate-float" />
        
        {/* Vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-[#020617] opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-transparent to-[#020617] opacity-80" />
      </div>

      <main className="relative z-10 w-full max-w-5xl px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 glass-dark rounded-3xl overflow-hidden border-white/5 shadow-2xl">
          {/* Left Decorative Side */}
          <div className="hidden md:flex flex-col justify-between p-12 bg-gradient-to-br from-primary/20 to-blue-500/10 relative overflow-hidden group">
            <div className="absolute inset-0 bg-electric-grid opacity-10 group-hover:opacity-20 transition-opacity" />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-8">
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                  <div className="w-5 h-5 border-2 border-white rounded-full border-t-transparent animate-spin" />
                </div>
                <span className="text-xl font-bold tracking-tight text-white">SEL Live</span>
              </div>
              
              <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
                Engineering the <br />
                <span className="text-primary italic">Future</span> of Power.
              </h1>
              <p className="text-blue-100/60 text-lg max-w-md">
                Streamlining electrical project management with state-of-the-art automation and real-time analytics.
              </p>
            </div>

            <div className="relative z-10 mt-auto pt-10">
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-[#1e293b] bg-muted flex items-center justify-center text-[10px] overflow-hidden">
                      <img 
                        src={`https://i.pravatar.cc/100?u=${i}`} 
                        alt="User" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-blue-100/80">
                  Trusted by <span className="text-white font-semibold">500+</span> engineers nationwide.
                </p>
              </div>
            </div>

            {/* Decorative Element */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gradient-radial from-primary/5 to-transparent pointer-events-none" />
          </div>

          {/* Right Form Side */}
          <div className="relative p-8 md:p-16 flex flex-col items-center justify-center min-h-[600px] bg-[#020617]/40 backdrop-blur-md">
            <div className="w-full max-w-sm shrink-0">
              {renderContent()}
            </div>
            
            <div className="mt-12 text-center text-xs text-muted-foreground/60">
              &copy; {new Date().getFullYear()} Siddhartha Engineering Limited. All rights reserved.
            </div>
          </div>
        </div>
      </main>

      {userForPinSetup && (
        <PinSetupDialog
          user={userForPinSetup}
          isOpen={isPinSetupOpen}
          onOpenChange={setIsPinSetupOpen}
          onPinSet={loadSavedUsers}
        />
      )}
    </div>
  );
}
