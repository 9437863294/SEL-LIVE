'use client';

import { useState } from 'react';
import { LayoutPanelLeft, Sparkles, Type } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionAnimationSettings } from '@/components/appearance/action-animation-settings';
import { CompanyLayoutSettings } from '@/components/appearance/company-layout-settings';
import { CompanyTextLabels } from '@/components/appearance/company-text-labels';

/**
 * Company design for everyone: the layout of sidebars, tables and dialogs, the shared text labels
 * (both parts of the company profile, `Settings.Company Profile` View to open, Edit to save) and
 * the company's action animations. Each part saves on its own; branding and themes have their own
 * sections beside this one.
 *
 * A tab stays mounted once it has been opened, only hidden while another is shown: switching back
 * neither reads the company profile again (two seconds or so from the office) nor throws away an
 * edit that has not been saved yet.
 */
export default function CompanyLayoutPage() {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(['layout']));
  const open = (value: string) => setOpened((current) => (current.has(value) ? current : new Set(current).add(value)));
  const panel = 'min-w-0 data-[state=inactive]:hidden';
  return (
    <Tabs defaultValue="layout" onValueChange={open} className="min-w-0">
      <div className="min-w-0 overflow-x-auto">
        <TabsList className="mb-4">
          <TabsTrigger value="layout" className="gap-1.5"><LayoutPanelLeft className="h-4 w-4" aria-hidden="true" />Sidebar, tables &amp; dialogs</TabsTrigger>
          <TabsTrigger value="labels" className="gap-1.5"><Type className="h-4 w-4" aria-hidden="true" />Text labels</TabsTrigger>
          <TabsTrigger value="animations" className="gap-1.5"><Sparkles className="h-4 w-4" aria-hidden="true" />Animations</TabsTrigger>
        </TabsList>
      </div>
      {opened.has('layout') && (
        <TabsContent value="layout" forceMount className={panel}>
          <CompanyLayoutSettings />
        </TabsContent>
      )}
      {opened.has('labels') && (
        <TabsContent value="labels" forceMount className={panel}>
          <CompanyTextLabels />
        </TabsContent>
      )}
      {opened.has('animations') && (
        <TabsContent value="animations" forceMount className={panel}>
          <ActionAnimationSettings />
        </TabsContent>
      )}
    </Tabs>
  );
}
