
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast({
        title: 'Success',
        description: 'Signed in successfully.',
      });
      router.push('/');
    } catch (error: any) {
      console.error('Error signing in:', error);
      toast({
        title: 'Sign In Failed',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary/20 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 max-w-4xl w-full rounded-2xl shadow-2xl overflow-hidden bg-background">
        <div className="hidden md:flex items-center justify-center bg-primary/10 p-12 relative">
           <div className="absolute -top-16 -left-16 w-48 h-48 bg-primary/30 rounded-full blur-2xl" />
           <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-primary/30 rounded-full blur-2xl" />
          <Image 
            src="https://picsum.photos/800/1200"
            alt="Hot air balloon"
            width={800}
            height={1200}
            className="rounded-2xl object-cover"
            data-ai-hint="hot air balloon"
          />
        </div>
        <div className="p-8 md:p-12 flex flex-col justify-center">
            <div className="relative h-24 w-96">
                <Image
                    src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FUntitled-1.png?alt=media&token=f2a38849-6c50-420c-8c5b-8f2b9efc3517"
                    alt="Company Logo"
                    fill
                    style={{ objectFit: 'contain' }}
                    priority
                />
            </div>
            <p className="text-muted-foreground mt-2 mb-8">Welcome! Please sign in to continue.</p>

            <form onSubmit={handleSignIn} className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-muted/50 border-0 focus:bg-background"
                    />
                </div>
                <div className="space-y-2">
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
                <Button type="submit" className="w-full !mt-8" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                </Button>
            </form>
        </div>
      </div>
    </div>
  );
}
