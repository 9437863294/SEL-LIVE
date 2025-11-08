
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

// Helper to create a URL-friendly slug
const slugify = (str: string) => String(str).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

export default function SerialNoConfigPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [scopes, setScopes] = useState<Record<string, Record<string, string[]>>>({});
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
            const allScopes: Record<string, Record<string, string[]>> = {};

            for (const project of projectsData) {
                const boqQuery = query(collection(db, 'projects', project.id, 'boqItems'));
                const boqSnapshot = await getDocs(boqQuery);
                
                const projectScopes: Record<string, Set<string>> = {};

                boqSnapshot.docs.forEach(doc => {
                    const data = doc.data() as BoqItem;
                    const scope1 = data['Scope 1'];
                    const scope2 = data['Scope 2'];

                    if (scope1 && scope2) {
                        if (!projectScopes[scope2]) {
                            projectScopes[scope2] = new Set();
                        }
                        projectScopes[scope2].add(scope1);
                    }
                });

                allScopes[project.id] = {};
                for (const scope2 in projectScopes) {
                    allScopes[project.id][scope2] = Array.from(projectScopes[scope2]).sort();
                }

                for (const scope2 of Object.keys(allScopes[project.id])) {
                    for (const scope1 of allScopes[project.id][scope2]) {
                        const slug = `${project.id}_${slugify(scope2)}_${slugify(scope1)}`;
                        const configDocRef = doc(db, 'billingReconSerialConfigs', slug);
                        const configDocSnap = await getDoc(configDocRef);
                        if (configDocSnap.exists()) {
                            allConfigs[slug] = configDocSnap.data() as SerialNumberConfig;
                        } else {
                            const projectNameAbbr = project.projectName.substring(0, 3).toUpperCase();
                            const scope2Abbr = scope2.substring(0, 3).toUpperCase();
                            const scope1Abbr = scope1.substring(0, 3).toUpperCase();
                            allConfigs[slug] = { ...initialConfigState, prefix: `${projectNameAbbr}/${scope2Abbr}/${scope1Abbr}/` };
                        }
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

    const handleSaveConfig = async (slug: string, projectName: string, scope1: string, scope2: string) => {
        if (!user) return;
        setSavingStates(prev => ({ ...prev, [slug]: true }));
        try {
            await setDoc(doc(db, 'billingReconSerialConfigs', slug), configs[slug]);
            await logUserActivity({
                userId: user.id,
                action: 'Update JMC Serial No. Config',
                details: { project: projectName, scope1, scope2, config: configs[slug] }
            });
            toast({ title: 'Success', description: `Configuration for ${projectName} - ${scope2} - ${scope1} saved.` });
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
                                <Accordion type="multiple" className="w-full space-y-3">
                                {(scopes[project.id] && Object.keys(scopes[project.id]).length > 0) ? Object.entries(scopes[project.id]).map(([scope2, scope1s]) => (
                                    <AccordionItem value={scope2} key={scope2} className="border-none">
                                        <Card className="bg-muted/20">
                                            <AccordionTrigger className="px-4 py-3 hover:no-underline">
                                                <h4 className="font-semibold text-md">{scope2}</h4>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-4 pb-4">
                                                <div className="space-y-4">
                                                    {scope1s.map(scope1 => {
                                                        const slug = `${project.id}_${slugify(scope2)}_${slugify(scope1)}`;
                                                        const config = configs[slug] || initialConfigState;
                                                        
                                                        return (
                                                            <Card key={slug} className="bg-background">
                                                                <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
                                                                    <div><CardTitle className="text-base">{scope1}</CardTitle></div>
                                                                    <Button size="sm" onClick={() => handleSaveConfig(slug, project.projectName, scope1, scope2)} disabled={savingStates[slug]}>
                                                                        {savingStates[slug] ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                                                                        Save
                                                                    </Button>
                                                                </CardHeader>
                                                                <CardContent className="p-4 pt-0">
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
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </Card>
                                    </AccordionItem>
                                )) : <p className="text-center text-muted-foreground p-4">No 'Scope 1' or 'Scope 2' values found in BOQ for this project.</p>}
                                </Accordion>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    );
}
