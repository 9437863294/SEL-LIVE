'use client';

import { MailView } from '@/components/mail-hub/mail-view';

export default function MailInboxPage() {
  return <MailView view="inbox" title="Inbox" description="Every connected mailbox, newest first." />;
}
