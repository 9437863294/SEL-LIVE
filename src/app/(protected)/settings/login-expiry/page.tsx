

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ShieldAlert, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

export default function LoginExpiryPage() {
  const { toast } = useToast();
  const { user, loading: authLoading, refreshUserData } = useAuth();
  const { can, isLoading: authzLoading } = useAuthorization();
  const [sessionDuration, setSessionDuration] = useState(60);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const canViewPage = can('View', 'Settings.Login Expiry');
  const canEditPage = can('Edit', 'Settings.Login Expiry');

  useEffect(() => {
    if (user) setSessionDuration(user.theme?.sessionDuration || 60);
    setIsLoading(false);
  }, [user]);

  const handleSave = async () => {
    if (!user || !canEditPage) {
      toast({ title: 'Permission Denied', description: "You don't have permission to save settings.", variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.id), { 'theme.sessionDuration': sessionDuration });
      await refreshUserData();
      toast({ title: 'Success', description: 'Login expiry setting saved. Takes effect on next login.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save setting.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  if (authLoading || authzLoading || isLoading) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Login Expiry</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50/60 via-background to-amber-50/40 dark:from-orange-950/20 dark:via-background dark:to-amber-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[35vw] h-[35vw] rounded-full bg-orange-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[35vw] h-[35vw] rounded-full bg-amber-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(249,115,22,0.10) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-orange-50 dark:hover:bg-orange-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              <h1 className="text-xl font-bold tracking-tight">Login Expiry</h1>
            </div>
            <p className="text-xs text-muted-foreground">Session timeout configuration</p>
          </div>
        </div>

        <Card className="border-orange-200/60 dark:border-orange-800/30 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-amber-400" />
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-orange-100 dark:bg-orange-900/40 p-2">
                <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-base">Session Duration</CardTitle>
                <CardDescription className="text-xs">Auto-logout after inactivity</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="session-duration" className="text-sm font-medium">
                Duration (in minutes)
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="session-duration"
                  type="number"
                  value={sessionDuration}
                  onChange={(e) => setSessionDuration(parseInt(e.target.value, 10))}
                  className="max-w-[140px] text-center text-lg font-semibold"
                  disabled={!canEditPage}
                  min={5}
                  max={1440}
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
              <p className="text-xs text-muted-foreground">
                = {Math.floor(sessionDuration / 60)} hr {sessionDuration % 60} min
              </p>
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Quick Presets</Label>
              <div className="flex flex-wrap gap-2">
                {[30, 60, 120, 240, 480].map(mins => (
                  <button
                    key={mins}
                    onClick={() => setSessionDuration(mins)}
                    disabled={!canEditPage}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      sessionDuration === mins
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-border/60 hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20 text-muted-foreground disabled:opacity-40'
                    }`}
                  >
                    {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                  </button>
                ))}
              </div>
            </div>

            {/* Info box */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border/40">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                This setting takes effect on your <strong>next login</strong>. You will be automatically logged out after the specified period of inactivity.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSaving || !canEditPage} className="rounded-full shadow-md">
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
