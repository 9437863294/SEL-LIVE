

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Camera, User as UserIcon, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';

export default function ProfilePage() {
  const { toast } = useToast();
  const { user, loading: authLoading, refreshUserData } = useAuth();
  
  const [displayName, setDisplayName] = useState('');
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.name);
      setPhotoPreview(user.photoURL || null);
    }
  }, [user]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setNewPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
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
  
      await updateDoc(userRef, {
        name: displayName,
        photoURL: photoURL,
      });
  
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

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  if (authLoading) {
      return (
        <div className="w-full max-w-2xl mx-auto">
             <Skeleton className="h-8 w-48 mb-6" />
             <Skeleton className="h-96 w-full" />
        </div>
      )
  }

  return (
    <>
      <div className="w-full max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/settings">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-6 w-6" />
                </Button>
              </Link>
              <h1 className="text-xl font-bold">Your Profile</h1>
            </div>
             <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
            </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your photo and display name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
             <div className="flex flex-col items-center gap-4">
                 <div className="relative">
                    <Avatar className="h-32 w-32">
                        <AvatarImage src={photoPreview || undefined} alt={displayName} />
                        <AvatarFallback className="text-4xl">{getInitials(displayName)}</AvatarFallback>
                    </Avatar>
                    <Button 
                        size="icon" 
                        className="absolute bottom-1 right-1 rounded-full h-9 w-9"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Camera className="h-5 w-5" />
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
             </div>
             <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                 <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="pl-9"
                    />
                 </div>
             </div>
              <div className="space-y-2">
                <Label>Email</Label>
                 <div className="relative">
                    <Input value={user?.email || ''} readOnly disabled className="pl-9"/>
                 </div>
             </div>
             <div className="space-y-2">
                <Label>Password</Label>
                 <Button variant="outline" className="w-full justify-start" onClick={() => setIsChangePasswordOpen(true)}>
                    <Lock className="mr-2 h-4 w-4"/>
                    Change Password
                 </Button>
             </div>
          </CardContent>
        </Card>
      </div>
      <ChangePasswordDialog isOpen={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
    </>
  );
}
