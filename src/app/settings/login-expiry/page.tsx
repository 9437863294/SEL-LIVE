
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

export default function LoginExpiryPage() {
    const { toast } = useToast();
    const { user, loading: authLoading, refreshUserData } = useAuth();
    const { can, isLoading: authzLoading } = useAuthorization();
    const [sessionDuration, setSessionDuration] = useState(60); // Default to 60 minutes
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const canViewPage = can('View', 'Settings.Login Expiry');
    const canEditPage = can('Edit', 'Settings.Login Expiry');

    useEffect(() => {
        if (user) {
            setSessionDuration(user.theme?.sessionDuration || 60);
        }
        setIsLoading(false);
    }, [user]);

    const handleSave = async () => {
        if (!user || !canEditPage) {
            toast({ title: "Permission Denied", description: "You don't have permission to save settings.", variant: "destructive" });
            return;
        }
        setIsSaving(true);
        try {
            const userRef = doc(db, 'users', user.id);
            await updateDoc(userRef, { 
                'theme.sessionDuration': sessionDuration 
            });
            await refreshUserData();
            toast({ title: "Success", description: "Login expiry setting saved. The new duration will apply on your next login." });
        } catch (error) {
            toast({ title: "Error", description: "Failed to save setting.", variant: "destructive" });
        }
        setIsSaving(false);
    };

    if (authLoading || authzLoading || isLoading) {
        return (
            <div className="w-full max-w-2xl mx-auto">
                <Skeleton className="h-10 w-64 mb-6" />
                <Skeleton className="h-48 w-full" />
            </div>
        );
    }

    if (!canViewPage) {
        return (
            <div className="w-full max-w-2xl mx-auto">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-xl font-bold">Login Expiry</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Login Expiry Settings</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Session Duration</CardTitle>
                    <CardDescription>
                        Set how long your session should last before you are automatically logged out. This setting will take effect on your next login.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="session-duration">Session Duration (in minutes)</Label>
                        <Input
                            id="session-duration"
                            type="number"
                            value={sessionDuration}
                            onChange={(e) => setSessionDuration(parseInt(e.target.value, 10))}
                            className="max-w-xs"
                            disabled={!canEditPage}
                        />
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={handleSave} disabled={isSaving || !canEditPage}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
