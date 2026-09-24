'use client';

import { useState } from 'react';
import { LayoutTemplate, Loader2, Plus, Trash2 } from 'lucide-react';

import { EApprovalRichTextEditor } from '@/components/e-approval/rich-text-editor';
import { useLoader, useMailCapabilities, useMailHub } from '@/components/mail-hub/hooks';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '@/components/mail-hub/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/mail-hub/client';
import type { MailContentScope, MailTemplate } from '@/lib/mail-hub/model';

const PLACEHOLDERS = ['{{recipient.name}}', '{{recipient.email}}', '{{sender.name}}', '{{sender.email}}', '{{subject}}', '{{date}}'];

export default function MailTemplatesPage() {
  const { toast } = useToast();
  const caps = useMailCapabilities();
  const { data } = useMailHub();
  const { value, loading, error, reload } = useLoader(() => mailApi.templates(), []);
  const [editing, setEditing] = useState<Partial<MailTemplate> | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await mailApi.saveTemplate(editing);
      toast({ title: 'Template saved' });
      setEditing(null);
      void reload();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const templates = value?.templates ?? [];
  return (
    <div className="space-y-3">
      <PageHeader
        title="Templates"
        description="Reusable messages. Insert one from the composer's Templates menu; placeholders fill in from the recipient and you."
        actions={<Button onClick={() => setEditing({ name: '', subject: '', html: '', scope: 'personal' })}><Plus className="mr-2 h-4 w-4" /> New template</Button>}
      />
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !value && <Spinner />}
      {value && templates.length === 0 && <EmptyState icon={<LayoutTemplate className="h-9 w-9" />} title="No templates yet" />}
      <ul className="grid gap-2 md:grid-cols-2">
        {templates.map((template) => (
          <li key={template.id} className="flex items-start gap-2 rounded-xl border bg-white p-3">
            <button type="button" className="min-w-0 flex-1 text-left" disabled={!template.editable} onClick={() => setEditing(template)}>
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{template.name}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{template.scope === 'department' ? template.departmentName ?? 'Department' : template.scope}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{template.subject || 'No subject'}</p>
            </button>
            {template.editable && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${template.name}`}
                onClick={async () => {
                  if (!window.confirm(`Delete the template "${template.name}"?`)) return;
                  await mailApi.deleteTemplate(template.id).catch((caught) => toast({ variant: 'destructive', title: 'Not deleted', description: caught instanceof Error ? caught.message : undefined }));
                  void reload();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>Placeholders: {PLACEHOLDERS.join(' ')}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
                <div className="space-y-1">
                  <Label>Who can use it</Label>
                  <Select value={editing.scope ?? 'personal'} onValueChange={(scope) => setEditing({ ...editing, scope: scope as MailContentScope })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Only me</SelectItem>
                      {caps.canManageTemplates && data?.user.departmentIds.length ? <SelectItem value="department">My department</SelectItem> : null}
                      {caps.canManageTemplates && <SelectItem value="global">Everyone</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editing.scope === 'department' && (
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Select value={editing.departmentId ?? ''} onValueChange={(departmentId) => setEditing({ ...editing, departmentId, departmentName: departmentId })}>
                    <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{(data?.user.departmentIds ?? []).map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1"><Label htmlFor="tpl-subject">Subject</Label><Input id="tpl-subject" value={editing.subject ?? ''} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} /></div>
              <div className="space-y-1">
                <Label>Body</Label>
                <EApprovalRichTextEditor value={editing.html ?? ''} onChange={(html) => setEditing((current) => (current ? { ...current, html } : current))} ariaLabel="Template body" className="min-h-[200px]" />
              </div>
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
