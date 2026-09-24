'use client';

import { MailView } from '@/components/mail-hub/mail-view';
import { OutboundList } from '@/components/mail-hub/outbound-list';
import { PageHeader } from '@/components/mail-hub/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Drafts written in the ERP (editable here, and mirrored to the provider's Drafts folder where it
 * supports that), plus messages that could not be sent — and, on the second tab, the provider's
 * own Drafts folder, which also holds drafts started in Gmail or Outlook.
 */
export default function MailDraftsPage() {
  return (
    <Tabs defaultValue="erp">
      <PageHeader
        title="Drafts"
        actions={
          <TabsList>
            <TabsTrigger value="erp">Written here</TabsTrigger>
            <TabsTrigger value="provider">Mailbox drafts</TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="erp">
        <OutboundList statuses="draft,failed" emptyTitle="No drafts" emptyBody="Drafts you start in Mail Hub are saved automatically and appear here." />
      </TabsContent>
      <TabsContent value="provider">
        <MailView view="drafts" title="Mailbox drafts" description="Drafts in your provider's Drafts folder." />
      </TabsContent>
    </Tabs>
  );
}
