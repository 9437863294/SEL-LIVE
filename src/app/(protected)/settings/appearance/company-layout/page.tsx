'use client';

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
 */
export default function CompanyLayoutPage() {
  return (
    <Tabs defaultValue="layout" className="min-w-0">
      <div className="min-w-0 overflow-x-auto">
        <TabsList className="mb-4">
          <TabsTrigger value="layout" className="gap-1.5"><LayoutPanelLeft className="h-4 w-4" aria-hidden="true" />Sidebar, tables &amp; dialogs</TabsTrigger>
          <TabsTrigger value="labels" className="gap-1.5"><Type className="h-4 w-4" aria-hidden="true" />Text labels</TabsTrigger>
          <TabsTrigger value="animations" className="gap-1.5"><Sparkles className="h-4 w-4" aria-hidden="true" />Animations</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="layout" className="min-w-0">
        <CompanyLayoutSettings />
      </TabsContent>
      <TabsContent value="labels" className="min-w-0">
        <CompanyTextLabels />
      </TabsContent>
      <TabsContent value="animations" className="min-w-0">
        <ActionAnimationSettings scope="company" />
      </TabsContent>
    </Tabs>
  );
}
