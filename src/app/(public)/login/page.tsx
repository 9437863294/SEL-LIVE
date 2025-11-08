
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
} from "firebase/auth";
import { Loader2, User as UserIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PinSetupDialog } from "@/components/auth/PinSetupDialog";
import type { SavedUser, User } from "@/lib/types";

export default function LoginPage() {
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

  // This effect is now primarily for users who are already logged in
  // and manually navigate to /login. The main post-login redirect is in AuthProvider.
  useEffect(() => {
    if (!authLoading && authenticatedUser) {
      const redirectUrl = searchParams.get('redirect') || '/';
      router.replace(redirectUrl);
    }
  }, [authenticatedUser, authLoading, router, searchParams]);

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

        {!activeUser && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(!!checked)}
            />
            <label
              htmlFor="remember-me"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Remember me on this device
            </label>
          </div>
        )}

        <Button type="submit" className="w-full !mt-8" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>

        {savedUsers.length > 0 && (
          <Button
            variant="link"
            className="w-full"
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
    if (showPasswordForm || savedUsers.length === 0) return renderPasswordForm();
    if (activeUser) return renderPinForm();
    return renderProfileSelection();
  };

  return (
    <>
      <div
        className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4"
        style={{
          backgroundImage:
            "url('https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Frm378-062.jpg?alt=media&token=91cf2e4f-e362-4a09-a283-a6ae2d64b55f')",
        }}
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative grid grid-cols-1 md:grid-cols-2 max-w-4xl w-full rounded-2xl shadow-2xl overflow-hidden bg-background/90">
          <div className="hidden md:flex items-center justify-center bg-primary/10 p-12 relative">
            <div className="absolute -top-16 -left-16 w-48 h-48 bg-primary/30 rounded-full blur-2xl" />
            <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-primary/30 rounded-full blur-2xl" />
            <Image
              src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Frm378-062.jpg?alt=media&token=91cf2e4f-e362-4a09-a283-a6ae2d64b55f"
              alt="Hot air balloon"
              width={800}
              height={1200}
              className="rounded-2xl object-cover"
              priority={false}
            />
          </div>
          <div className="p-8 md:p-12 flex flex-col justify-center items-center">
            {renderContent()}
          </div>
        </div>
      </div>

      {userForPinSetup && (
        <PinSetupDialog
          user={userForPinSetup}
          isOpen={isPinSetupOpen}
          onOpenChange={setIsPinSetupOpen}
          onPinSet={loadSavedUsers}
        />
      )}
    </>
  );
}
