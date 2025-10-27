
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc, query, where } from 'firebase/firestore';
import type { Project, BoqItem, SerialNumberConfig } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const initialConfigState: SerialNumberConfig = {
    prefix: '',
    format: '',
    suffix: '',
    startingIndex: 1,
};

export default function SerialNoConfigPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [scopes, setScopes] = useState<Record<string, string[]>>({});
    const [configs, setConfigs] = useState<Record<string, SerialNumberConfig>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const projectsSnap = await getDocs(collection(db, 'projects'));
            const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);

            const allConfigs: Record<string, SerialNumberConfig> = {};
            const allScopes: Record<string, string[]> = {};

            for (const project of projectsData) {
                const boqQuery = query(collection(db, 'boqItems'), where('projectSlug', '==', project.id));
                const boqSnapshot = await getDocs(boqQuery);
                const projectScopes = [...new Set(boqSnapshot.docs.map(doc => doc.data()['Scope 1']).filter(Boolean))];
                allScopes[project.id] = projectScopes as string[];
                
                for (const scope of projectScopes) {
                    const slug = `${project.id}_${String(scope).replace(/\s+/g, '-')}`;
                    const configDocRef = doc(db, 'billingReconSerialConfigs', slug);
                    const configDocSnap = await getDoc(configDocRef);
                    if (configDocSnap.exists()) {
                        allConfigs[slug] = configDocSnap.data() as SerialNumberConfig;
                    } else {
                        allConfigs[slug] = { ...initialConfigState, prefix: `${project.projectName.substring(0,3).toUpperCase()}/${scope.substring(0,3).toUpperCase()}/` };
                    }
                }
            }
            setScopes(allScopes);
            setConfigs(allConfigs);

        } catch (error) {
            console.error("Error fetching data:", error);
            toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
        }
        setIsLoading(false);
    }, [toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleConfigChange = (slug: string, field: keyof SerialNumberConfig, value: string | number) => {
        setConfigs(prev => ({
            ...prev,
            [slug]: {
                ...(prev[slug] || initialConfigState),
                [field]: value,
            },
        }));
    };

    const handleSaveConfig = async (slug: string, projectName: string, scope: string) => {
        if (!user) return;
        setSavingStates(prev => ({ ...prev, [slug]: true }));
        try {
            await setDoc(doc(db, 'billingReconSerialConfigs', slug), configs[slug]);
            await logUserActivity({
                userId: user.id,
                action: 'Update JMC Serial No. Config',
                details: { project: projectName, scope: scope, config: configs[slug] }
            });
            toast({ title: 'Success', description: `Configuration for ${projectName} - ${scope} saved.` });
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
        } finally {
            setSavingStates(prev => ({ ...prev, [slug]: false }));
        }
    };
    
    return (
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/billing-recon/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">JMC Serial Number Configuration</h1>
            </div>
            
            <Accordion type="multiple" className="w-full space-y-4">
                {isLoading ? <Skeleton className="h-48 w-full" /> : projects.map(project => (
                    <AccordionItem value={project.id} key={project.id} className="border-none">
                        <Card>
                            <AccordionTrigger className="p-4 hover:no-underline">
                                <CardTitle>{project.projectName}</CardTitle>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-4">
                                <div className="space-y-4">
                                {(scopes[project.id] || []).length > 0 ? (scopes[project.id] || []).map(scope => {
                                    const slug = `${project.id}_${String(scope).replace(/\s+/g, '-')}`;
                                    const config = configs[slug] || initialConfigState;
                                    
                                    return (
                                        <Card key={slug} className="bg-muted/30">
                                            <CardHeader className="flex flex-row items-center justify-between">
                                                <div>
                                                    <CardTitle className="text-base">{scope}</CardTitle>
                                                </div>
                                                <Button size="sm" onClick={() => handleSaveConfig(slug, project.projectName, scope)} disabled={savingStates[slug]}>
                                                    {savingStates[slug] ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                                                    Save
                                                </Button>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Prefix</Label>
                                                        <Input value={config.prefix} onChange={(e) => handleConfigChange(slug, 'prefix', e.target.value)} />
                                                    </div>
                                                     <div className="space-y-1">
                                                        <Label className="text-xs">Format</Label>
                                                        <Input value={config.format} onChange={(e) => handleConfigChange(slug, 'format', e.target.value)} />
                                                    </div>
                                                     <div className="space-y-1">
                                                        <Label className="text-xs">Suffix</Label>
                                                        <Input value={config.suffix} onChange={(e) => handleConfigChange(slug, 'suffix', e.target.value)} />
                                                    </div>
                                                     <div className="space-y-1">
                                                        <Label className="text-xs">Index</Label>
                                                        <Input type="number" value={config.startingIndex} onChange={(e) => handleConfigChange(slug, 'startingIndex', parseInt(e.target.value, 10) || 1)} />
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )
                                }) : <p className="text-center text-muted-foreground p-4">No 'Scope 1' values found in BOQ for this project.</p>}
                                </div>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    );
}
