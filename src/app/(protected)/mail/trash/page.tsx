'use client';

import { MailView } from '@/components/mail-hub/mail-view';

export default function MailTrashPage() {
  return <MailView view="trash" title="Trash" description="Your provider empties Trash on its own schedule." />;
}
