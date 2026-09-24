'use client';

import { useState } from 'react';
import { Loader2, Plus, Signature, Trash2 } from 'lucide-react';

import { EApprovalRichTextEditor } from '@/components/e-approval/rich-text-editor';
import { useMailCapabilities, useMailHub } from '@/components/mail-hub/hooks';
import { EmptyState, PageHeader } from '@/components/mail-hub/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/mail-hub/client';
import type { MailSignature } from '@/lib/mail-hub/model';

/**
 * Personal signatures (with a default per mailbox) and department signatures. Department ones need
 * Mail Hub › Templates › Manage; everybody in the department can choose them in the composer.
 */
export default function MailSignaturesPage() {
  const { toast } = useToast();
  const caps = useMailCapabilities();
  const { data, refresh } = useMailHub();
  const [editing, setEditing] = useState<Partial<MailSignature> | null>(null);
  const [saving, setSaving] = useState(false);
  if (!data) return null;
  const personal = data.accounts.filter((account) => account.kind === 'personal');

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await mailApi.saveSignature(editing);
      toast({ title: 'Signature saved' });
      setEditing(null);
      await refresh();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Signatures" actions={<Button onClick={() => setEditing({ name: '', html: '', scope: 'personal', defaultForAccountId: '*' })}><Plus className="mr-2 h-4 w-4" /> New signature</Button>} />
      {data.signatures.length === 0 && <EmptyState icon={<Signature className="h-9 w-9" />} title="No signatures yet" body="A signature is added below your message and above any quoted text." />}
      <ul className="grid gap-2 md:grid-cols-2">
        {data.signatures.map((signature) => (
          <li key={signature.id} className="flex items-start gap-2 rounded-xl border bg-white p-3">
            <button type="button" className="min-w-0 flex-1 text-left" disabled={!signature.editable} onClick={() => setEditing(signature)}>
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{signature.name}</span>
                <Badge variant="outline" className="text-[10px]">{signature.scope === 'department' ? signature.departmentName ?? 'Department' : 'Personal'}</Badge>
                {signature.defaultForAccountId && <Badge variant="secondary" className="text-[10px]">Default{signature.defaultForAccountId === '*' ? '' : ` · ${personal.find((account) => account.id === signature.defaultForAccountId)?.emailAddress ?? ''}`}</Badge>}
              </div>
            </button>
            {signature.editable && (
              <Button size="icon" variant="ghost" aria-label={`Delete ${signature.name}`} onClick={async () => { await mailApi.deleteSignature(signature.id).catch(() => {}); await refresh(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit signature' : 'New signature'}</DialogTitle>
            <DialogDescription>Remote images in signatures are shown to your recipients by their own mail client.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="sig-name">Name</Label><Input id="sig-name" value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={editing.scope ?? 'personal'} onValueChange={(scope) => setEditing({ ...editing, scope: scope as 'personal' | 'department' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Personal</SelectItem>
                      {caps.canManageTemplates && data.user.departmentIds.length > 0 && <SelectItem value="department">Department</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editing.scope === 'personal' ? (
                <div className="space-y-1">
                  <Label>Use by default for</Label>
                  <Select value={editing.defaultForAccountId ?? 'none'} onValueChange={(value) => setEditing({ ...editing, defaultForAccountId: value === 'none' ? null : value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not a default</SelectItem>
                      <SelectItem value="*">Every mailbox</SelectItem>
                      {personal.map((account) => <SelectItem key={account.id} value={account.id}>{account.emailAddress}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Select value={editing.departmentId ?? ''} onValueChange={(departmentId) => setEditing({ ...editing, departmentId, departmentName: departmentId })}>
                    <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{data.user.departmentIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <EApprovalRichTextEditor value={editing.html ?? ''} onChange={(html) => setEditing((current) => (current ? { ...current, html } : current))} ariaLabel="Signature" className="min-h-[140px]" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
