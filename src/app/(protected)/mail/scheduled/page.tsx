'use client';

import { OutboundList } from '@/components/mail-hub/outbound-list';
import { PageHeader } from '@/components/mail-hub/ui';

export default function MailScheduledPage() {
  return (
    <>
      <PageHeader title="Scheduled" description="Messages waiting to be sent. Unscheduling returns one to your drafts; once sending has begun it can no longer be stopped." />
      <OutboundList statuses="scheduled" emptyTitle="Nothing scheduled" emptyBody="Use the clock beside Send in the composer to send a message later." />
    </>
  );
}
