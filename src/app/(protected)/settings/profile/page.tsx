
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Camera, User as UserIcon, Lock, KeyRound, Mail, Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { auth, db, storage } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { multiFactor } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { PinSetupDialog } from '@/components/auth/PinSetupDialog';
import { MFASetupDialog } from '@/components/auth/MFASetupDialog';
import { cn } from '@/lib/utils';

export default function ProfilePage() {
  const { toast } = useToast();
  const { user, loading: authLoading, refreshUserData, loadSavedUsers } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [isMfaSetupOpen, setIsMfaSetupOpen] = useState(false);
  const [isMfaEnabled, setIsMfaEnabled] = useState(false);
  const [isMfaDisabling, setIsMfaDisabling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.name);
      setPhotoPreview(user.photoURL || null);
    }
    // Check MFA enrollment status from the live Firebase Auth user
    if (auth.currentUser) {
      setIsMfaEnabled(multiFactor(auth.currentUser).enrolledFactors.length > 0);
    }
  }, [user]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setNewPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDisableMfa = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) return;
    setIsMfaDisabling(true);
    try {
      const mf = multiFactor(fbUser);
      for (const factor of mf.enrolledFactors) {
        await mf.unenroll(factor);
      }
      setIsMfaEnabled(false);
      toast({ title: '2FA Disabled', description: 'Two-factor authentication has been turned off.' });
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code === 'auth/requires-recent-login') {
        toast({ title: 'Re-authentication required', description: 'Please sign out and sign back in, then try disabling 2FA.', variant: 'destructive' });
      } else {
        toast({ title: 'Error', description: err?.message ?? 'Failed to disable 2FA.', variant: 'destructive' });
      }
    } finally {
      setIsMfaDisabling(false);
    }
  };

  const handleSave = async () => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    const userRef = doc(db, 'users', user.id);
    let photoURL = user.photoURL;
    try {
      if (newPhoto) {
        const photoRef = ref(storage, `profile-photos/${user.id}/${newPhoto.name}`);
        const uploadResult = await uploadBytes(photoRef, newPhoto);
        photoURL = await getDownloadURL(uploadResult.ref);
      }
      await updateDoc(userRef, { name: displayName, photoURL });
      await refreshUserData();
      toast({ title: 'Success', description: 'Profile updated successfully.' });
    } catch (error) {
      console.error('Error updating profile: ', error);
      toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
      setNewPhoto(null);
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  if (authLoading) {
    return (
      <div className=" space-y-4">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <>
      {/* ── Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50/60 via-background to-purple-50/40 dark:from-violet-950/20 dark:via-background dark:to-purple-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[40vw] h-[40vw] rounded-full bg-purple-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className=" px-4 sm:px-5 py-3">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-violet-50 dark:hover:bg-violet-950/30">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Your Profile</h1>
              <p className="text-xs text-muted-foreground">Manage your account details and security</p>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="sm"
            className="rounded-full shadow-md shadow-primary/20 shrink-0"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            <span className="hidden xs:inline">Save Changes</span>
            <span className="xs:hidden">Save</span>
          </Button>
        </div>

        {/* Avatar Card */}
        <Card className="mb-4 border-violet-200/60 dark:border-violet-800/30 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-r from-violet-500/20 via-purple-500/15 to-pink-500/10" />
          <CardContent className="relative pt-8 pb-5">
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                {/* Gradient ring */}
                <div className="rounded-full p-1 bg-gradient-to-br from-violet-400 via-purple-400 to-pink-400 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
                  <div className="rounded-full p-0.5 bg-background">
                    <Avatar className="h-28 w-28">
                      <AvatarImage src={photoPreview || undefined} alt={displayName} />
                      <AvatarFallback className="text-3xl font-bold bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40 text-violet-700 dark:text-violet-300">
                        {getInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                <Button
                  size="icon"
                  className="absolute bottom-0 right-0 rounded-full h-8 w-8 shadow-md"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4" />
                  <span className="sr-only">Change photo</span>
                </Button>
                <Input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoChange}
                />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">{displayName || 'Your Name'}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              {newPhoto && (
                <p className="text-xs text-primary bg-primary/10 px-3 py-1 rounded-full">
                  New photo selected — save to apply
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profile Info Card */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Profile Information</CardTitle>
            <CardDescription>Update your display name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-9"
                  placeholder="Enter your display name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={user?.email || ''}
                  readOnly
                  disabled
                  className="pl-9 bg-muted/40"
                />
              </div>
              <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
            </div>
          </CardContent>
        </Card>

        {/* Security Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary/70" />
              <CardTitle className="text-base">Security</CardTitle>
            </div>
            <CardDescription>Manage your password and PIN for secure access.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setIsChangePasswordOpen(true)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-background hover:bg-muted/40 hover:border-primary/30 transition-all duration-200 text-left group"
              >
                <div className="rounded-lg bg-orange-100 dark:bg-orange-900/40 p-2 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Lock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Change Password</p>
                  <p className="text-xs text-muted-foreground">Update your account password</p>
                </div>
              </button>
              <button
                onClick={() => setIsPinSetupOpen(true)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-background hover:bg-muted/40 hover:border-primary/30 transition-all duration-200 text-left group"
              >
                <div className="rounded-lg bg-blue-100 dark:bg-blue-900/40 p-2 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Manage PIN</p>
                  <p className="text-xs text-muted-foreground">Set up or change your PIN</p>
                </div>
              </button>
            </div>

            {/* ── MFA row ── */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-border/60 bg-background p-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'rounded-lg p-2 shrink-0',
                  isMfaEnabled
                    ? 'bg-emerald-100 dark:bg-emerald-900/40'
                    : 'bg-slate-100 dark:bg-slate-800/40'
                )}>
                  {isMfaEnabled
                    ? <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    : <ShieldOff className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Two-Factor Authentication</p>
                    {isMfaEnabled && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        ON
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isMfaEnabled
                      ? 'Your account is protected with an authenticator app.'
                      : 'Add a second layer of security with an authenticator app.'}
                  </p>
                </div>
              </div>
              {isMfaEnabled ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/50 dark:hover:bg-rose-950/20"
                  onClick={handleDisableMfa}
                  disabled={isMfaDisabling}
                >
                  {isMfaDisabling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disable'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-900/50 dark:hover:bg-emerald-950/20"
                  onClick={() => setIsMfaSetupOpen(true)}
                >
                  Enable
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <ChangePasswordDialog isOpen={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
      {user && (
        <PinSetupDialog
          user={user}
          isOpen={isPinSetupOpen}
          onOpenChange={setIsPinSetupOpen}
          onPinSet={loadSavedUsers}
        />
      )}
      <MFASetupDialog
        open={isMfaSetupOpen}
        onOpenChange={setIsMfaSetupOpen}
        onEnrolled={() => setIsMfaEnabled(true)}
      />
    </>
  );
}
