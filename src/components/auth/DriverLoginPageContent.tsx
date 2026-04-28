'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { CarFront, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

const resolveDriverLoginRedirect = (redirectParam: string | null | undefined) => {
  if (
    typeof redirectParam === 'string' &&
    redirectParam.startsWith('/') &&
    !redirectParam.startsWith('//') &&
    redirectParam !== '/login' &&
    redirectParam !== '/driver-login'
  ) {
    return redirectParam;
  }
  return '/driver-management';
};

const mapFirebaseError = (code?: string) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      return 'No account found with that email.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Sign in failed. Please try again.';
  }
};

export default function DriverLoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { setShouldRemember } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('driver_app_mode', '1');
    window.localStorage.setItem('driver_app_mode', '1');
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalEmail = email.trim().toLowerCase();
    if (!finalEmail || !password) {
      toast({
        title: 'Error',
        description: 'Please enter both email and password.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, finalEmail, password);
      setShouldRemember(rememberMe);
      window.sessionStorage.setItem('driver_app_mode', '1');
      window.localStorage.setItem('driver_app_mode', '1');

      const nextPath = resolveDriverLoginRedirect(searchParams?.get('redirect'));
      router.replace(nextPath);
      window.setTimeout(() => {
        const currentPath = window.location.pathname || '';
        if (currentPath === '/driver-login' || currentPath === '/login') {
          window.location.replace(nextPath);
        }
      }, 250);

      toast({
        title: 'Welcome',
        description: 'Signed in successfully.',
      });
    } catch (error: any) {
      setShouldRemember(false);
      toast({
        title: 'Sign In Failed',
        description: mapFirebaseError(error?.code),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_10%,rgba(14,165,233,0.28),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(16,185,129,0.22),transparent_40%)]" />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-white/15 bg-slate-900/80 shadow-[0_30px_90px_-50px_rgba(6,182,212,0.8)] backdrop-blur-xl">
          <CardHeader className="space-y-2">
            <div className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/45 bg-cyan-400/20">
              <CarFront className="h-5 w-5 text-cyan-200" />
            </div>
            <CardTitle className="text-2xl tracking-tight text-white">Driver App Login</CardTitle>
            <CardDescription className="text-slate-300">
              Sign in to access trips, fuel, status and assigned vehicle details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="driver-email" className="text-slate-200">Email</Label>
                <Input
                  id="driver-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.toLowerCase())}
                  placeholder="driver@company.com"
                  className="border-slate-500/60 bg-slate-950/60 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-400 focus-visible:ring-offset-0"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="driver-password" className="text-slate-200">Password</Label>
                <Input
                  id="driver-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="border-slate-500/60 bg-slate-950/60 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-400 focus-visible:ring-offset-0"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="driver-remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(Boolean(checked))}
                />
                <Label htmlFor="driver-remember" className="cursor-pointer text-sm text-slate-300">
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign In
              </Button>

              <div className="text-center text-xs text-slate-400">
                Need web portal login?{' '}
                <Link href="/login" className="font-medium text-cyan-300 hover:text-cyan-200">
                  Open web login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
