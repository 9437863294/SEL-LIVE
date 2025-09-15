
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const colors = [
  { name: 'Violet', value: 'violet', bg: 'bg-violet-500' },
  { name: 'Blue', value: 'blue', bg: 'bg-blue-500' },
  { name: 'Green', value: 'green', bg: 'bg-green-500' },
  { name: 'Orange', value: 'orange', bg: 'bg-orange-500' },
  { name: 'Red', value: 'red', bg: 'bg-red-500' },
];

const fonts = [
  { name: 'Inter', value: 'inter', className: 'font-inter' },
  { name: 'Roboto', value: 'roboto', className: 'font-roboto' },
  { name: 'Lato', value: 'lato', className: 'font-lato' },
];


export default function AppearancePage() {
  const { toast } = useToast();
  const { user, loading: authLoading, refreshUserData } = useAuth();
  
  const [selectedColor, setSelectedColor] = useState('violet');
  const [selectedFont, setSelectedFont] = useState('inter');

  useEffect(() => {
    if (user?.theme) {
      setSelectedColor(user.theme.color || 'violet');
      setSelectedFont(user.theme.font || 'inter');
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in to change theme.', variant: 'destructive' });
      return;
    }
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        theme: {
          color: selectedColor,
          font: selectedFont,
        },
      });
      await refreshUserData();
      toast({ title: 'Success', description: 'Appearance settings saved.' });
    } catch (error) {
      console.error('Error saving appearance settings: ', error);
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    }
  };
  
  if(authLoading) {
    return (
        <div className="w-full max-w-4xl mx-auto space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
        </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Appearance</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customize Appearance</CardTitle>
          <CardDescription>
            Personalize the look and feel of the application. Your settings are saved to your user profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="space-y-4">
            <Label>Color Scheme</Label>
            <div className="flex flex-wrap gap-4">
              {colors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  className={cn(
                    'flex items-center justify-center h-16 w-16 rounded-full border-4 transition-all',
                    selectedColor === color.value ? 'border-primary' : 'border-transparent hover:border-primary/50'
                  )}
                >
                  <div className={cn('h-12 w-12 rounded-full', color.bg)} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <Label htmlFor="font-select">Font Style</Label>
             <Select value={selectedFont} onValueChange={setSelectedFont}>
                <SelectTrigger id="font-select" className="w-full md:w-1/2">
                    <SelectValue placeholder="Select a font" />
                </SelectTrigger>
                <SelectContent>
                    {fonts.map(font => (
                        <SelectItem key={font.value} value={font.value} className={font.className}>
                            {font.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Link href="/settings">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
