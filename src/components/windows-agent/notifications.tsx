'use client';

import { useMemo, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import { getAuth } from 'firebase/auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  hrDialog,
} from '@/components/hr/hr-ui';
import { hasPermission } from '@/lib/access-control';
import { WINDOWS_AGENT_RESOURCES, type AgentNotificationType } from '@/lib/windows-agent';
import { canBroadcastNotifications, canSendNotifications } from '@/lib/windows-agent-permissions';
import { fetchNotifications } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';
import { ClockTime } from './ui';

/**
 * §38's composer and §39's delivery report.
 *
 * The delivery numbers are read straight off each notification's `deliveryCounts`, which the
 * receipt writes keep current. That is what makes this page one read rather than a scan of every
 * receipt — and it is why those counters are incremented only when a receipt actually moves
 * forward, so a retried acknowledgement cannot inflate them.
 */

const NOTIFICATION_TYPES: AgentNotificationType[] = [
  'ANNOUNCEMENT',
  'TASK',
  'APPROVAL',
  'REMINDER',
  'MEETING',
  'HR',
  'FINANCE',
  'PROJECT',
  'DOCUMENT',
  'SYSTEM',
];

export function NotificationsPage() {
  const { viewer, loading } = useWindowsAgent();
  const [composing, setComposing] = useState(false);

  const allowed =
    canSendNotifications(viewer) ||
    hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.notifications, 'View');

  const notifications = useWindowsAgentQuery('Loading notifications', () => fetchNotifications(100), [], {
    enabled: allowed && !loading,
  });

  if (loading) return <HrLoader label="Loading notifications" />;
  if (!allowed) return <HrAccessDenied what="desktop notifications" />;

  const rows = notifications.data ?? [];

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Desktop notifications"
        description="Alerts pushed to the agent on people’s computers, and what happened to each one."
        actions={
          canSendNotifications(viewer) ? (
            <Button size="sm" onClick={() => setComposing(true)}>
              <Send className="mr-2 h-4 w-4" aria-hidden />
              Send a notification
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent</CardTitle>
          <CardDescription>
            <strong>Delivered</strong> means it reached the computer. <strong>Displayed</strong>
            {' '}means Windows showed it. <strong>Clicked</strong> means the person acted on it.
            Keeping them apart is what makes a PC that fetches alerts and never shows them
            findable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notifications.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              dense
              maxHeightClassName="sm:max-h-[36rem]"
              columns={[
                {
                  header: 'Notification',
                  mobile: 'title',
                  cell: (row) => (
                    <span>
                      <span className="block font-medium">{row.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{row.message}</span>
                    </span>
                  ),
                },
                { header: 'Type', mobile: 'aside', cell: (row) => <Badge variant="outline">{row.type.toLowerCase()}</Badge> },
                { header: 'Sent', mobile: 'detail', cell: (row) => <ClockTime value={row.createdAtIso} /> },
                {
                  header: 'Recipients',
                  align: 'right',
                  mobile: 'detail',
                  cell: (row) => row.deliveryCounts?.recipients ?? 0,
                },
                {
                  header: 'Delivered',
                  align: 'right',
                  mobile: 'detail',
                  cell: (row) => <Share part={row.deliveryCounts?.delivered ?? 0} whole={row.deliveryCounts?.recipients ?? 0} />,
                },
                {
                  header: 'Displayed',
                  align: 'right',
                  className: 'hidden lg:table-cell',
                  mobile: 'detail',
                  cell: (row) => <Share part={row.deliveryCounts?.displayed ?? 0} whole={row.deliveryCounts?.recipients ?? 0} />,
                },
                {
                  header: 'Clicked',
                  align: 'right',
                  mobile: 'detail',
                  cell: (row) => <Share part={row.deliveryCounts?.clicked ?? 0} whole={row.deliveryCounts?.recipients ?? 0} />,
                },
                {
                  header: 'Failed',
                  align: 'right',
                  mobile: 'footer',
                  cell: (row) => {
                    const failed = row.deliveryCounts?.failed ?? 0;
                    return failed > 0 ? (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                        {failed}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    );
                  },
                },
              ]}
              empty={
                <HrEmptyState
                  icon={BellRing}
                  title="Nothing sent yet"
                  description="Desktop notifications appear on people’s computers within one heartbeat — about 90 seconds."
                />
              }
            />
          )}
        </CardContent>
      </Card>

      {composing ? (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            notifications.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  if (!whole) return <span className="text-muted-foreground">—</span>;
  const percent = Math.round((part / whole) * 100);
  return (
    <span className="tabular-nums" title={`${part} of ${whole}`}>
      {part} <span className="text-xs text-muted-foreground">({percent}%)</span>
    </span>
  );
}

function ComposeDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { viewer, departments, directory } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<AgentNotificationType>('ANNOUNCEMENT');
  const [priority, setPriority] = useState('NORMAL');
  const [deepLink, setDeepLink] = useState('');
  const [requireAck, setRequireAck] = useState(false);
  const [targetKind, setTargetKind] = useState<'user' | 'department' | 'all'>('user');
  const [targetId, setTargetId] = useState('');

  const canBroadcast = canBroadcastNotifications(viewer);

  const deepLinkProblem = useMemo(() => {
    const value = deepLink.trim();
    if (!value) return null;
    if (!value.startsWith('/')) return 'Must be a path inside SEL LIVE, starting with a slash.';
    if (value.startsWith('//')) return 'A path starting with two slashes points at another site.';
    return null;
  }, [deepLink]);

  const send = async () => {
    const target =
      targetKind === 'all'
        ? { allEmployees: true }
        : targetKind === 'department'
          ? { departmentIds: [targetId] }
          : { userIds: [targetId] };

    const ok = await run('Notification sent', async () => {
      // The route verifies the permission again server-side; this token is how it knows who is
      // asking. Taken fresh rather than cached: a stale one would fail a send that looked fine.
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Your sign-in has expired. Reload the page and try again.');

      const response = await fetch('/api/windows-agent/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          message,
          type,
          priority,
          deepLink: deepLink.trim() || null,
          requireAcknowledgement: requireAck,
          target,
          module: 'Windows Agent',
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `The server returned ${response.status}.`);
      }
    });

    if (ok) onSent();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader>
          <DialogTitle>Send a desktop notification</DialogTitle>
          <DialogDescription>
            It appears on the recipient’s computer within one heartbeat — about 90 seconds — and
            stays in their tray until they act on it.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="space-y-1.5">
            <Label htmlFor="wa-title">Title</Label>
            <Input id="wa-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-message">Message</Label>
            <Textarea id="wa-message" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={1000} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as AgentNotificationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTIFICATION_TYPES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical — stays until acted on</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-link">Open this page when clicked</Label>
            <Input
              id="wa-link"
              value={deepLink}
              onChange={(event) => setDeepLink(event.target.value)}
              placeholder="/e-approval/PR-2026-0098"
            />
            <p className="text-xs text-muted-foreground">
              {deepLinkProblem ? (
                <span className="text-destructive">{deepLinkProblem}</span>
              ) : (
                'A path inside SEL LIVE. Point it at the exact record, not the dashboard — that is the whole value of the alert.'
              )}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Send to</Label>
              <Select
                value={targetKind}
                onValueChange={(value) => {
                  setTargetKind(value as typeof targetKind);
                  setTargetId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">One person</SelectItem>
                  <SelectItem value="department">A department</SelectItem>
                  {canBroadcast ? <SelectItem value="all">Everybody</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>

            {targetKind !== 'all' ? (
              <div className="space-y-1.5">
                <Label>Which</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {(targetKind === 'department' ? departments : directory).map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span className="text-sm">
              <span className="block font-medium">Require acknowledgement</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                The notification stays on screen until the person presses Acknowledge, and the
                delivery report counts who has.
              </span>
            </span>
            <Switch checked={requireAck} onCheckedChange={setRequireAck} />
          </label>

          {targetKind === 'all' ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              This appears on every enrolled computer in the company. It cannot be recalled once
              sent — only allowed to expire.
            </p>
          ) : null}
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={
              pending ||
              !title.trim() ||
              !message.trim() ||
              Boolean(deepLinkProblem) ||
              (targetKind !== 'all' && !targetId)
            }
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
