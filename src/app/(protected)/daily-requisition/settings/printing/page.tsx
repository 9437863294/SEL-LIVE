'use client';

import { useState, useEffect } from 'react';
import { Save, Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import {
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

interface PrintingSettings {
  paperSize: string;
  orientation: 'portrait' | 'landscape';
  margins: {
    top: string;
    bottom: string;
    left: string;
    right: string;
  };
  marginUnit: 'mm' | 'cm' | 'in';
  headerText: string;
}

const initialSettings: PrintingSettings = {
  paperSize: 'a4',
  orientation: 'portrait',
  margins: { top: '20', bottom: '20', left: '20', right: '20' },
  marginUnit: 'mm',
  headerText: 'SIDDHARTHA ENGINEERING LIMITED',
};

/** One flat row per setting, so the audit log's `changes` names "marginTop" rather than a whole margins object. */
const flattenSettings = (s: PrintingSettings | null): Record<string, string> | null =>
  s
    ? {
        paperSize: s.paperSize ?? '',
        orientation: s.orientation ?? '',
        marginTop: s.margins?.top ?? '',
        marginBottom: s.margins?.bottom ?? '',
        marginLeft: s.margins?.left ?? '',
        marginRight: s.margins?.right ?? '',
        marginUnit: s.marginUnit ?? '',
        headerText: s.headerText ?? '',
      }
    : null;

export default function PrintingSetupPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  // The Settings page's "Printing Setup" card is gated on this, and so is the menu entry.
  const canViewPage = can('View', 'Daily Requisition.Settings');
  // Saving used to need only View. Any of the module's settings-edit rights now unlocks it;
  // everyone else sees the setup read-only.
  const canEdit =
    can('Edit Serial Nos', 'Daily Requisition.Settings') ||
    can('Edit Workflow', 'Daily Requisition.Settings') ||
    can('Edit User Rights', 'Daily Requisition.Settings') ||
    can('Edit', 'Daily Requisition.Data Control');
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [settings, setSettings] = useState<PrintingSettings>(initialSettings);
  // What is stored right now (null when the document does not exist yet) — the audit log's "before".
  const [savedSettings, setSavedSettings] = useState<PrintingSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const docRef = doc(db, 'settings', 'printing');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSettings(docSnap.data() as PrintingSettings);
          setSavedSettings(docSnap.data() as PrintingSettings);
        }
      } catch (e) {
        toast({ title: 'Error', description: 'Failed to load printing settings.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchSettings();
  }, [toast]);

  const handleMarginChange = (side: keyof typeof settings.margins, value: string) => {
    setSettings((prev) => ({ ...prev, margins: { ...prev.margins, [side]: value } }));
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'printing'), settings);
      const changes = diffFields(flattenSettings(savedSettings), flattenSettings(settings));
      void log(
        'Update Daily Requisition Printing Setup',
        { settingsDoc: 'settings/printing', created: savedSettings === null, changedCount: Object.keys(changes).length, changes },
        { recordRef: 'Printing Setup' },
      );
      setSavedSettings(settings);
      toast({
        title: 'Settings Saved',
        description: 'Your printing preferences have been updated.',
      });
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className={`${dailyPageContainerClass} mx-auto max-w-5xl`}>
        <Skeleton className="mb-6 h-10 w-full max-w-64" />
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={`${dailyPageContainerClass} mx-auto max-w-5xl`}>
        <PageHeader
          eyebrow="Daily Requisition"
          title="Printing Setup"
          description="Control page setup, margins, and header text for daily requisition print outputs."
          backHref="/daily-requisition/settings"
        />
        <Card className={dailySurfaceCardClass}>
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
    <div className={`${dailyPageContainerClass} mx-auto max-w-5xl`}>
      <PageHeader eyebrow="Daily Requisition"
        title="Printing Setup"
        description="Control page setup, margins, and header text for daily requisition print outputs."
        backHref="/daily-requisition/settings"
        actions={
          canEdit ? (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Settings
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Read-only — you need a Daily Requisition settings edit right to change this.</span>
          )
        }
      />

      {/* A disabled fieldset makes every input, select and radio below read-only in one place. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        <Card className={dailySurfaceCardClass}>
          <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
          <CardHeader>
            <CardTitle>Page Setup</CardTitle>
            <CardDescription>Configure the paper size and orientation for printed documents.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paper-size">Paper Size</Label>
              <Select value={settings.paperSize} onValueChange={(v) => setSettings((p) => ({ ...p, paperSize: v }))}>
                <SelectTrigger id="paper-size" className="border-white/70 bg-white/80">
                  <SelectValue placeholder="Select paper size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                  <SelectItem value="legal">Legal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Orientation</Label>
              <RadioGroup
                value={settings.orientation}
                onValueChange={(v) => setSettings((p) => ({ ...p, orientation: v as any }))}
                className="flex items-center gap-6 rounded-2xl border border-white/70 bg-white/60 px-4 py-3"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="portrait" id="portrait" />
                  <Label htmlFor="portrait">Portrait</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="landscape" id="landscape" />
                  <Label htmlFor="landscape">Landscape</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card className={dailySurfaceCardClass}>
          <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
          <CardHeader>
            <div className="flex items-end justify-between gap-4">
              <div>
                <CardTitle>Margin Setup</CardTitle>
                <CardDescription>Fine-tune spacing around the printed content.</CardDescription>
              </div>
              <div className="w-28">
                <Select value={settings.marginUnit} onValueChange={(v) => setSettings((p) => ({ ...p, marginUnit: v as any }))}>
                  <SelectTrigger className="border-white/70 bg-white/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mm">mm</SelectItem>
                    <SelectItem value="cm">cm</SelectItem>
                    <SelectItem value="in">in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="margin-top">Top</Label>
              <Input id="margin-top" type="number" value={settings.margins.top} onChange={(e) => handleMarginChange('top', e.target.value)} placeholder="e.g., 20" className="border-white/70 bg-white/80" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="margin-bottom">Bottom</Label>
              <Input id="margin-bottom" type="number" value={settings.margins.bottom} onChange={(e) => handleMarginChange('bottom', e.target.value)} placeholder="e.g., 20" className="border-white/70 bg-white/80" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="margin-left">Left</Label>
              <Input id="margin-left" type="number" value={settings.margins.left} onChange={(e) => handleMarginChange('left', e.target.value)} placeholder="e.g., 20" className="border-white/70 bg-white/80" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="margin-right">Right</Label>
              <Input id="margin-right" type="number" value={settings.margins.right} onChange={(e) => handleMarginChange('right', e.target.value)} placeholder="e.g., 20" className="border-white/70 bg-white/80" />
            </div>
          </CardContent>
        </Card>

        <Card className={dailySurfaceCardClass}>
          <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
          <CardHeader>
            <CardTitle>Header Setup</CardTitle>
            <CardDescription>Customize the text that appears at the top of the printed document.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="header-text">Header Text</Label>
              <Textarea id="header-text" value={settings.headerText} onChange={(e) => setSettings((p) => ({ ...p, headerText: e.target.value }))} className="min-h-28 border-white/70 bg-white/80" />
            </div>
          </CardContent>
        </Card>
      </fieldset>
    </div>
  );
}
