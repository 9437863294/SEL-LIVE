'use client';

import { useMemo, useRef, useState } from 'react';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { multiFactor } from 'firebase/auth';
import { BadgeCheck, Camera, CheckCircle2, Circle, ContactRound, Loader2, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { auth, db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { cn } from '@/lib/utils';
import { PhotoError, initialsOf, prepareProfilePhoto, type PreparedPhoto } from './profile-photo';

interface CompletenessItem {
  label: string;
  done: boolean;
  /** Where the person can fix it, if they can. */
  action?: { label: string; onClick: () => void };
}

/**
 * The top of the profile: who this is at a glance, their photo, and how complete the profile is.
 *
 * A new photo is shown for confirmation before anything is uploaded, then stored under the
 * person's own auth uid (the Storage rule allows only that) as a 512px JPEG — see profile-photo.ts.
 */
export function ProfileHero({ onJumpToSecurity }: { onJumpToSecurity?: () => void }) {
  const { user, isImpersonating, refreshUserData } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger('Settings');
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PreparedPhoto | null>(null);
  const [busy, setBusy] = useState<'preparing' | 'uploading' | 'removing' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const firebaseUser = auth.currentUser;
  const mfaOn = firebaseUser ? multiFactor(firebaseUser).enrolledFactors.length > 0 : false;
  const emailVerified = firebaseUser?.emailVerified ?? false;

  const items: CompletenessItem[] = useMemo(
    () => [
      { label: 'Profile photo', done: Boolean(user?.photoURL), action: isImpersonating ? undefined : { label: 'Add photo', onClick: () => fileInput.current?.click() } },
      { label: 'Full name', done: (user?.name ?? '').trim().length >= 2 },
      { label: 'Mobile number on file', done: Boolean(user?.mobile) },
      { label: 'Linked to your HR record', done: Boolean(user?.employeeId) },
      { label: 'Email verified', done: emailVerified, action: onJumpToSecurity ? { label: 'Verify', onClick: onJumpToSecurity } : undefined },
      { label: 'Two-factor authentication', done: mfaOn, action: onJumpToSecurity ? { label: 'Turn on', onClick: onJumpToSecurity } : undefined },
    ],
    [user?.photoURL, user?.name, user?.mobile, user?.employeeId, emailVerified, mfaOn, isImpersonating, onJumpToSecurity],
  );
  const doneCount = items.filter((i) => i.done).length;
  const percent = Math.round((doneCount / items.length) * 100);

  if (!user) return null;

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy('preparing');
    try {
      setPending(await prepareProfilePhoto(file));
    } catch (error) {
      toast({
        title: 'That photo can’t be used',
        description: error instanceof PhotoError ? error.message : 'Try a different image.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function discardPending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  async function savePhoto() {
    const uid = auth.currentUser?.uid;
    if (!pending || !uid || !user) return;
    setBusy('uploading');
    try {
      // Keyed by auth uid — not the users document id — because that is what the Storage rule checks.
      const photoRef = ref(storage, `profile-photos/${uid}/avatar-${Date.now()}.jpg`);
      const result = await uploadBytes(photoRef, pending.blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
      const photoURL = await getDownloadURL(result.ref);
      await updateDoc(doc(db, 'users', user.id), { photoURL });
      await refreshUserData();
      void log('Update profile photo');
      toast({ title: 'Photo updated', description: 'Your new photo shows everywhere you appear in SEL Live.' });
      discardPending();
    } catch (error) {
      console.error('Profile photo upload failed:', error);
      toast({ title: 'Photo not saved', description: 'The upload failed. Check your connection and try again.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    if (!user) return;
    setBusy('removing');
    try {
      await updateDoc(doc(db, 'users', user.id), { photoURL: deleteField() });
      await refreshUserData();
      void log('Remove profile photo');
      toast({ title: 'Photo removed', description: 'Your initials are shown instead.' });
    } catch (error) {
      console.error('Removing the profile photo failed:', error);
      toast({ title: 'Photo not removed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  const subtitle = [user.designation, user.department].filter(Boolean).join(' · ');

  return (
    <Card className="overflow-hidden">
      <div className="h-24 bg-[image:var(--sel-tab-gradient)] opacity-90 sm:h-28" aria-hidden="true" />
      <CardContent className="relative pb-5">
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-end sm:text-left">
            <div className="relative">
              <Avatar className="h-24 w-24 ring-4 ring-background sm:h-28 sm:w-28">
                <AvatarImage src={user.photoURL || undefined} alt="" />
                <AvatarFallback className="bg-primary/10 text-3xl font-bold text-primary">{initialsOf(user.name)}</AvatarFallback>
              </Avatar>
              {!isImpersonating && (
                <Button
                  type="button"
                  size="icon"
                  className="absolute bottom-1 right-1 h-8 w-8 rounded-full shadow-md"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy !== null}
                  aria-label={user.photoURL ? 'Change profile photo' : 'Add a profile photo'}
                >
                  {busy === 'preparing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void choose(event.target.files?.[0])}
              />
            </div>
            <div className="min-w-0 pb-1">
              <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{user.name || 'Your name'}</h2>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {user.role && (
                  <Badge variant="secondary" className="gap-1">
                    <UserRound className="h-3 w-3" aria-hidden="true" /> {user.role}
                  </Badge>
                )}
                <Badge variant="outline" className={cn('gap-1', user.status === 'Active' ? 'border-success/40 text-success' : 'border-danger/40 text-danger')}>
                  {user.status === 'Active' ? <BadgeCheck className="h-3 w-3" aria-hidden="true" /> : <ShieldAlert className="h-3 w-3" aria-hidden="true" />}
                  {user.status === 'Active' ? 'Active' : 'Inactive'}
                </Badge>
                {user.employeeNo && (
                  <Badge variant="outline" className="gap-1">
                    <ContactRound className="h-3 w-3" aria-hidden="true" /> Emp. {user.employeeNo}
                  </Badge>
                )}
                {isImpersonating && (
                  <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Viewing as this user
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {user.photoURL && !isImpersonating && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 self-center sm:self-end" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove photo
            </Button>
          )}
        </div>

        {/* Completeness */}
        <div className="mt-5 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="font-semibold">Profile {percent}% complete</p>
            <p className="text-xs text-muted-foreground">
              {doneCount} of {items.length}
            </p>
          </div>
          <Progress value={percent} className="mt-2 h-2" aria-label={`Profile ${percent}% complete`} />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs">
                {item.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className={cn(item.done ? 'text-foreground' : 'text-muted-foreground')}>
                  {item.label}
                  <span className="sr-only">{item.done ? ' — done' : ' — not done'}</span>
                </span>
                {!item.done && item.action && (
                  <button type="button" onClick={item.action.onClick} className="ml-auto font-medium text-primary underline-offset-2 hover:underline">
                    {item.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      {/* Confirm a new photo before uploading it */}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && busy === null && discardPending()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this photo?</AlertDialogTitle>
            <AlertDialogDescription>It is cropped to a square and shown to colleagues wherever your name appears.</AlertDialogDescription>
          </AlertDialogHeader>
          {pending && (
            <div className="flex justify-center py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL preview */}
              <img src={pending.previewUrl} alt="Preview of your new profile photo" className="h-40 w-40 rounded-full object-cover ring-4 ring-muted" />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                void savePhoto();
              }}
            >
              {busy === 'uploading' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={(open) => busy === null && setConfirmRemove(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your photo?</AlertDialogTitle>
            <AlertDialogDescription>Your initials are shown instead. You can add a photo again at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Keep photo</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                void removePhoto();
              }}
            >
              {busy === 'removing' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
