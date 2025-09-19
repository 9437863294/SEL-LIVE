
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2, User } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/components/auth/AuthProvider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PinDialog } from '@/components/auth/PinDialog';
import type { SavedUser } from '@/lib/types';


export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setShouldRemember, savedUsers, clearSavedUsers } = useAuth();

  const [activeUser, setActiveUser] = useState<SavedUser | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);

  useEffect(() => {
    // If there are no saved users, default to the password form.
    if (savedUsers.length === 0) {
      setShowPasswordForm(true);
    }
  }, [savedUsers]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: 'Error',
        description: 'Please enter both email and password.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    if (rememberMe) {
        sessionStorage.setItem('tempPassword', password);
    }
    setShouldRemember(rememberMe); // Tell AuthProvider to handle saving if login is successful
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast({
        title: 'Success',
        description: 'Signed in successfully.',
      });
      router.push('/');
    } catch (error: any) {
      console.error('Error signing in:', error);
      setShouldRemember(false); // Reset on failure
      sessionStorage.removeItem('tempPassword');
      toast({
        title: 'Sign In Failed',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileClick = (user: SavedUser) => {
    setActiveUser(user);
    setIsPinDialogOpen(true);
  };
  
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  const renderProfileSelection = () => (
    <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">Who's signing in?</h2>
        <p className="text-muted-foreground mb-8">Select a profile to continue.</p>
        <div className="grid grid-cols-2 justify-center gap-6">
            {savedUsers.map(user => (
                <div key={user.id} onClick={() => handleProfileClick(user)} className="flex flex-col items-center gap-2 cursor-pointer p-4 rounded-lg hover:bg-muted transition-colors">
                    <Avatar className="h-20 w-20">
                        <AvatarImage src={user.photoURL} alt={user.name}/>
                        <AvatarFallback className="text-2xl">{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                    <p className="font-medium">{user.name}</p>
                </div>
            ))}
        </div>
        <Button variant="link" className="mt-8" onClick={() => setShowPasswordForm(true)}>Sign in with password</Button>
    </div>
  );
  
  const renderPasswordForm = () => (
     <div className="w-full">
        <div className="relative h-40 w-full max-w-[70%] mx-auto">
            <Image
                src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FUntitled-1.png?alt=media&token=02963da9-54c3-4aaa-91e0-ac5d38bd6412"
                alt="Company Logo"
                fill
                style={{ objectFit: 'contain' }}
                priority
            />
        </div>
        <p className="text-muted-foreground text-center mt-2 mb-8">Welcome! Please sign in to continue.</p>

        <form onSubmit={handleSignIn} className="space-y-6 w-full max-w-sm mx-auto">
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
                />
            </div>
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
                />
            </div>
            <div className="flex items-center space-x-2">
                <Checkbox id="remember-me" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked as boolean)} />
                <label
                  htmlFor="remember-me"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Remember me on this device
                </label>
            </div>
            <Button type="submit" className="w-full !mt-8" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
            </Button>
            {savedUsers.length > 0 && (
                 <Button variant="link" className="w-full" onClick={() => setShowPasswordForm(false)}>
                    <User className="mr-2 h-4 w-4" /> Sign in with a saved profile
                 </Button>
            )}
        </form>
     </div>
  );

  return (
    <>
    <div 
      className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4"
      style={{ backgroundImage: `url('https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2F1744115358081.jpg?alt=media&token=3352f270-d899-4d18-bd83-b40a052e3061')` }}
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
            data-ai-hint="hot air balloon"
          />
        </div>
        <div className="p-8 md:p-12 flex flex-col justify-center items-center">
            {showPasswordForm ? renderPasswordForm() : renderProfileSelection()}
        </div>
      </div>
    </div>
    {activeUser && (
      <PinDialog
        user={activeUser}
        isOpen={isPinDialogOpen}
        onOpenChange={setIsPinDialogOpen}
      />
    )}
    </>
  );
}
