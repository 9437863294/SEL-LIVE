
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Palette, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const colors = [
  { name: 'Violet', value: 'violet', bg: 'bg-violet-500', ring: 'ring-violet-400', preview: 'from-violet-500 to-purple-600' },
  { name: 'Blue', value: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-400', preview: 'from-blue-500 to-indigo-600' },
  { name: 'Green', value: 'green', bg: 'bg-green-500', ring: 'ring-green-400', preview: 'from-green-500 to-emerald-600' },
  { name: 'Orange', value: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-400', preview: 'from-orange-500 to-amber-600' },
  { name: 'Red', value: 'red', bg: 'bg-red-500', ring: 'ring-red-400', preview: 'from-red-500 to-rose-600' },
];

const fonts = [
  { name: 'Inter', value: 'inter', sample: 'The quick brown fox jumps over the lazy dog.' },
  { name: 'Roboto', value: 'roboto', sample: 'The quick brown fox jumps over the lazy dog.' },
];

export default function AppearancePage() {
  const { toast } = useToast();
  const { user, loading: authLoading, refreshUserData } = useAuth();

  const [selectedColor, setSelectedColor] = useState('violet');
  const [selectedFont, setSelectedFont] = useState('inter');
  const [isSaving, setIsSaving] = useState(false);

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
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.id), {
        theme: { color: selectedColor, font: selectedFont },
      });
      await refreshUserData();
      toast({ title: 'Success', description: 'Appearance settings saved.' });
    } catch (error) {
      console.error('Error saving appearance settings: ', error);
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const activeColor = colors.find(c => c.value === selectedColor);

  return (
    <>
      {/* ── Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-50/60 via-background to-violet-50/40 dark:from-pink-950/20 dark:via-background dark:to-violet-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-pink-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[40vw] h-[40vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(236,72,153,0.10) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-pink-50 dark:hover:bg-pink-950/30">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-pink-500" />
                <h1 className="text-xl font-bold tracking-tight">Appearance</h1>
              </div>
              <p className="text-xs text-muted-foreground">Personalize your experience</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings">
              <Button variant="outline" className="rounded-full" size="sm">Cancel</Button>
            </Link>
            <Button onClick={handleSave} disabled={isSaving} className="rounded-full shadow-md shadow-primary/20" size="sm">
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* Color Scheme Card */}
        <Card className="mb-4 overflow-hidden">
          {/* Preview bar */}
          {activeColor && (
            <div className={cn('h-2 w-full bg-gradient-to-r', activeColor.preview)} />
          )}
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Color Scheme</CardTitle>
            </div>
            <CardDescription>Choose your preferred accent color.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {colors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  className="group flex flex-col items-center gap-2"
                  title={color.name}
                >
                  <div className={cn(
                    'relative flex items-center justify-center h-14 w-14 rounded-2xl border-2 transition-all duration-200',
                    selectedColor === color.value
                      ? `border-foreground shadow-lg scale-105`
                      : 'border-transparent hover:scale-105',
                  )}>
                    <div className={cn('h-10 w-10 rounded-xl shadow-sm transition-all duration-200', color.bg)} />
                    {selectedColor === color.value && (
                      <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-foreground flex items-center justify-center">
                        <Check className="h-3 w-3 text-background" />
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    'text-xs font-medium transition-colors',
                    selectedColor === color.value ? 'text-foreground' : 'text-muted-foreground',
                  )}>{color.name}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Font Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Font Style</CardTitle>
            </div>
            <CardDescription>Select your preferred typeface.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fonts.map((font) => (
                <button
                  key={font.value}
                  onClick={() => setSelectedFont(font.value)}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left transition-all duration-200',
                    selectedFont === font.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border/60 hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">{font.name}</span>
                    {selectedFont === font.value && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{font.sample}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
