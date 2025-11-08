

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { SerialNumberConfig } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

const modules = [
    { id: 'site-fund-requisition', name: 'Site Fund Requisition' },
    { id: 'daily-requisition', name: 'Daily Requisition' },
    { id: 'store-stock-grn', name: 'Store Stock GRN' },
];

const initialConfigState: SerialNumberConfig = {
    prefix: '',
    format: '',
    suffix: '',
    startingIndex: 1,
};

export default function SerialNoConfigurationPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    const [selectedModule, setSelectedModule] = useState<string>(modules[0].id);
    const [config, setConfig] = useState<SerialNumberConfig>(initialConfigState);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    
    const canView = can('View', 'Settings.Serial No. Config');
    const canEdit = can('Edit', 'Settings.Serial No. Config');

    useEffect(() => {
        if (isAuthLoading) return;
        if (!canView) {
            setIsLoading(false);
            return;
        };

        const fetchConfig = async () => {
            if (!selectedModule) return;
            setIsLoading(true);
            try {
                const docRef = doc(db, 'serialNumberConfigs', selectedModule);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setConfig(docSnap.data() as SerialNumberConfig);
                } else {
                    let defaultConfig = { ...initialConfigState };
                    if (selectedModule === 'site-fund-requisition') {
                        defaultConfig = { prefix: 'SEL\\SFR\\', format: '2025-26\\', suffix: '', startingIndex: 10 };
                    } else if (selectedModule === 'daily-requisition') {
                        defaultConfig = { prefix: 'SEL\\REC\\', format: '2025-26\\', suffix: '', startingIndex: 7340 };
                    } else if (selectedModule === 'store-stock-grn') {
                        defaultConfig = { prefix: 'GRN-', format: 'yyyyMMdd-', suffix: '', startingIndex: 1 };
                    }
                    setConfig(defaultConfig);
                }
            } catch (error) {
                console.error("Error fetching serial number config: ", error);
                toast({
                    title: 'Error',
                    description: 'Failed to fetch configuration.',
                    variant: 'destructive',
                });
            }
            setIsLoading(false);
        };

        fetchConfig();
    }, [selectedModule, toast, canView, isAuthLoading]);

    const handleSave = async () => {
        if (!canEdit) {
            toast({ title: 'Permission Denied', description: 'You do not have permission to edit this configuration.', variant: 'destructive'});
            return;
        }
        if (!selectedModule || !user) {
            toast({ title: 'Error', description: 'Please select a module first.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            await setDoc(doc(db, 'serialNumberConfigs', selectedModule), config);
            await logUserActivity({
                userId: user.id,
                action: 'Update Serial No. Config',
                details: { module: selectedModule, newConfig: config }
            });
            toast({ title: 'Success', description: 'Configuration saved successfully.' });
        } catch (error) {
            console.error("Error saving configuration: ", error);
            toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleInputChange = (field: keyof SerialNumberConfig, value: string | number) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };
    
    if (isAuthLoading) {
        return (
             <div className="w-full max-w-4xl mx-auto">
                <div className="mb-6 flex items-center gap-4">
                    <Skeleton className="h-10 w-10" />
                    <Skeleton className="h-8 w-64" />
                </div>
                <Skeleton className="h-64 w-full" />
             </div>
        );
    }

    if (!canView) {
        return (
            <div className="w-full max-w-4xl mx-auto">
                <div className="mb-6 flex items-center gap-4">
                  <Link href="/settings">
                    <Button variant="ghost" size="icon">
                      <ArrowLeft className="h-6 w-6" />
                    </Button>
                  </Link>
                  <h1 className="text-xl font-bold">Serial No. Configuration</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page. Please contact an administrator.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }


    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Serial No. Configuration</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Sequence Number Format</CardTitle>
                    <CardDescription>
                        Select a module and configure the prefix, format, suffix, and starting index for its serial numbers.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                    <div className="space-y-2">
                        <Label htmlFor="module">Module</Label>
                        <Select value={selectedModule} onValueChange={setSelectedModule}>
                            <SelectTrigger id="module" className="w-full md:w-1/2">
                                <SelectValue placeholder="Select a module" />
                            </SelectTrigger>
                            <SelectContent>
                                {modules.map(module => (
                                    <SelectItem key={module.id} value={module.id}>{module.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {isLoading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-6 w-1/4" />
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                             <Label>Sequence No Format</Label>
                             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                                <div className="space-y-1">
                                    <Label htmlFor="prefix" className="text-sm font-normal text-muted-foreground">Prefix</Label>
                                    <Input 
                                        id="prefix" 
                                        value={config.prefix} 
                                        onChange={(e) => handleInputChange('prefix', e.target.value)}
                                        disabled={!canEdit}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="format" className="text-sm font-normal text-muted-foreground">Format</Label>
                                    <Input 
                                        id="format" 
                                        value={config.format}
                                        onChange={(e) => handleInputChange('format', e.target.value)} 
                                        disabled={!canEdit}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="suffix" className="text-sm font-normal text-muted-foreground">Suffix</Label>
                                    <Input 
                                        id="suffix"
                                        placeholder="e.g. /A"
                                        value={config.suffix}
                                        onChange={(e) => handleInputChange('suffix', e.target.value)} 
                                        disabled={!canEdit}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="index" className="text-sm font-normal text-muted-foreground">Index</Label>
                                    <Input 
                                        id="index" 
                                        type="number" 
                                        value={config.startingIndex}
                                        onChange={(e) => handleInputChange('startingIndex', parseInt(e.target.value, 10) || 1)}
                                        disabled={!canEdit}
                                    />
                                </div>
                             </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-4">
                        <Link href="/settings">
                            <Button variant="outline">Cancel</Button>
                        </Link>
                        <Button onClick={handleSave} disabled={isLoading || !canEdit || isSaving}>
                           {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                           Save
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
