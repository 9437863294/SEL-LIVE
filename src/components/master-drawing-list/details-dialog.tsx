'use client';

/**
 * Drawing Details — the one dialog that records everything about a drawing, as in Project
 * Management's register: the item's own drawing or one of its sub-drawings, its numbers and planned
 * window, every submission round to the client (date, status, comments and their date, the drawing
 * file), the approve date, the overall status and a remark. A new sub-drawing is just named here;
 * its rounds are filled in later from the same dialog.
 *
 * As in Project Management's, what the item is — its description, group, scope and schedule — is
 * shown here but not edited: recording a submission or a status never changes it. The register's
 * Edit item details does that (`EditItemDialog`).
 */

import { useMemo, useState } from 'react';
import { Loader2, Paperclip, Pencil, Plus } from 'lucide-react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { personOptionLabel } from '@/lib/people-directory';
import {
  OVERALL_STATUSES,
  REVISION_ROUNDS,
  REVISION_STATUSES,
  countVisibleRevisions,
  formRevisions,
  isApproved,
  isRevisionRejected,
  type DrawingItem,
  type DrawingRevision,
  type OverallStatus,
  type RevisionStatus,
  type SubDrawing,
} from '@/lib/master-drawing-list/drawings';
import { drawingFormError, type DrawingForm } from '@/lib/master-drawing-list/steps';
import { cn } from '@/lib/utils';

import { dateRuleFor, dateWindow, describeDateRule, fieldSetting, type FieldSetting } from '@/lib/master-drawing-list/settings';

import { mdlSendForm, openDrawingFile, useMdlSettings } from './mdl-client';

/** A field's label as Field Control names it, with the required mark or "(optional)". */
function Mark({ setting, required = setting.required }: { setting: FieldSetting; required?: boolean }) {
  return (
    <>
      {setting.label}
      {required ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
    </>
  );
}

/** The dialog edits an item's own drawing (sub === null) or one of its sub-drawings; `isNew` for one being added. */
export type DrawingTarget = { item: DrawingItem; sub: SubDrawing | null; isNew: boolean };

// The phone-sheet dialog classes the app's registers share (globals.css: .hr-mobile-dialog …).
const DIALOG = {
  content: 'hr-mobile-dialog sm:max-w-lg sm:gap-4',
  header: 'hr-dialog-header',
  body: 'hr-dialog-body space-y-3',
  footer: 'hr-dialog-footer sm:shrink-0',
};

// Radix Select cannot hold an empty string value.
const UNASSIGNED = 'none';
const NO_STATUS = 'none';

const dayGap = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);

/** How long the round took: the client to answer it, and SEL to resubmit after comments — or how long it has waited. */
function RoundTiming({ revision, next, approveDate, today }: { revision: DrawingRevision; next?: DrawingRevision; approveDate: string; today: string }) {
  if (!revision.submissionDate) return null;
  const answered = revision.commentsDate || (!next?.submissionDate && approveDate ? approveDate : '');
  const parts: string[] = [];
  if (answered && answered >= revision.submissionDate) parts.push('client took ' + dayGap(revision.submissionDate, answered) + ' d');
  else if (!answered) parts.push('with client ' + dayGap(revision.submissionDate, today) + ' d');
  if (revision.commentsDate && next?.submissionDate && next.submissionDate >= revision.commentsDate) parts.push('SEL resubmitted in ' + dayGap(revision.commentsDate, next.submissionDate) + ' d');
  else if (revision.commentsDate && !next?.submissionDate && !approveDate) parts.push('with SEL ' + dayGap(revision.commentsDate, today) + ' d');
  return parts.length ? <span className="text-[11px] text-muted-foreground">{parts.join(' · ')}</span> : null;
}

function formFor(target: DrawingTarget): DrawingForm {
  const source = target.sub ?? target.item;
  return {
    title: target.sub?.title ?? '',
    assignedToId: target.sub?.assignedToId ?? '',
    docNo: source.docNo ?? '',
    drawingNo: source.drawingNo ?? '',
    plannedStartDate: source.plannedStartDate ?? '',
    plannedEndDate: source.plannedEndDate ?? '',
    revisions: formRevisions(target.isNew ? [] : source.revisions),
    approveDate: source.approveDate ?? '',
    status: source.status ?? 'Pending',
    remark: source.remark ?? '',
  };
}

export function DrawingDialog({
  target,
  today,
  canEdit,
  onClose,
  onSaved,
}: {
  target: DrawingTarget | null;
  today: string;
  /** Drawings · Edit on this drawing list. Without it only an assignee reaches this dialog, for their own sub-drawing. */
  canEdit: boolean;
  onClose: () => void;
  onSaved: (item: DrawingItem) => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      {target ? <DrawingDialogBody key={`${target.item.id}-${target.sub?.id ?? 'item'}`} target={target} today={today} canEdit={canEdit} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function DrawingDialogBody({ target, today, canEdit, onClose, onSaved }: { target: DrawingTarget; today: string; canEdit: boolean; onClose: () => void; onSaved: (item: DrawingItem) => void }) {
  const { toast } = useToast();
  const { users } = useAuth();
  const [form, setForm] = useState<DrawingForm>(() => formFor(target));
  const [visibleRounds, setVisibleRounds] = useState(() => countVisibleRevisions(formFor(target).revisions));
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<string, File>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const { item, sub, isNew } = target;
  const previous = sub ?? item;
  const settings = useMdlSettings();
  // Field Control: each field's label, and whether it is shown and required.
  const fs = useMemo(() => {
    const at = (formKey: 'item' | 'drawing' | 'sub' | 'round', key: string) => fieldSetting(settings.fieldControl, formKey, key);
    return {
      description: at('item', 'description'),
      group: at('item', 'group'),
      title: at('sub', 'title'),
      assignedTo: at('sub', 'assignedTo'),
      docNo: at('drawing', 'docNo'),
      drawingNo: at('drawing', 'drawingNo'),
      plannedStartDate: at('drawing', 'plannedStartDate'),
      plannedEndDate: at('drawing', 'plannedEndDate'),
      approveDate: at('drawing', 'approveDate'),
      status: at('drawing', 'status'),
      remark: at('drawing', 'remark'),
      submissionDate: at('round', 'submissionDate'),
      transmittalNo: at('round', 'transmittalNo'),
      roundStatus: at('round', 'status'),
      commentsDate: at('round', 'commentsDate'),
      file: at('round', 'file'),
      comments: at('round', 'comments'),
    };
  }, [settings.fieldControl]);
  // Date Control: the window this drawing list allows, for the date pickers.
  const rule = dateRuleFor(settings.dateControl, item.projectCode);
  const windows = { submission: dateWindow(rule, 'submission', today), comments: dateWindow(rule, 'comments', today), approval: dateWindow(rule, 'approval', today) };

  // Only active users can be picked, but a sub-drawing assigned before someone left keeps them in
  // the list — dropping them would silently unassign it the next time anyone saved.
  const assigneeOptions = useMemo(() => {
    const options = users
      .filter((candidate) => candidate.status === 'Active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((candidate) => ({ id: candidate.id, label: personOptionLabel(candidate) }));
    if (sub?.assignedToId && !options.some((option) => option.id === sub.assignedToId)) {
      options.unshift({ id: sub.assignedToId, label: `${sub.assignedToName || 'Unknown user'} (inactive)` });
    }
    return options;
  }, [users, sub]);

  const updateRevision = (round: string, changes: Partial<DrawingRevision>) =>
    setForm((current) => ({ ...current, revisions: current.revisions.map((revision) => (revision.round === round ? { ...revision, ...changes } : revision)) }));

  const handleSave = async () => {
    const uploads = new Set(Object.keys(pendingFiles).filter((round) => pendingFiles[round]));
    const shown = { ...form, revisions: form.revisions.slice(0, visibleRounds) };
    const error = drawingFormError(shown, { isSub: Boolean(sub), isNew, previous: isNew ? null : previous, today, uploads, fields: settings.fieldControl, dateRule: rule });
    if (error) {
      toast({ title: 'Check the drawing details', description: error, variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const body = new FormData();
      body.set('payload', JSON.stringify({ target: sub ? { kind: 'sub', subId: sub.id, isNew } : { kind: 'item' }, form: shown }));
      for (const round of uploads) body.set(`file:${round}`, pendingFiles[round]!);
      const result = await mdlSendForm<{ item: DrawingItem }>(`items/${encodeURIComponent(item.id)}`, 'PUT', body);
      toast({ title: sub ? (isNew ? 'Sub-drawing added' : 'Sub-drawing updated') : 'Drawing record saved' });
      onSaved(result.item);
      onClose();
    } catch (caught) {
      toast({ title: 'Unable to save drawing record', description: caught instanceof Error ? caught.message : 'Try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const openFile = (path: string) =>
    void openDrawingFile(item.id, path).catch((caught: unknown) => toast({ title: 'Could not open the drawing', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' }));

  return (
    <DialogContent className={cn(DIALOG.content, 'sm:max-h-[90dvh] sm:max-w-3xl sm:overflow-y-auto')}>
      <DialogHeader className={DIALOG.header}>
        <DialogTitle>{isNew ? 'Add Sub-drawing' : sub ? 'Sub-drawing Details' : 'Drawing Details'}</DialogTitle>
        <DialogDescription>
          {item.slNo ? `Sl. No. ${item.slNo} · ` : ''}
          {item.description}
        </DialogDescription>
      </DialogHeader>

      <div className={cn(DIALOG.body, 'grid grid-cols-1 content-start gap-4 space-y-0 py-2')}>
        {!sub && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div className={cn('min-w-0', fs.group.visible ? 'sm:col-span-2' : 'sm:col-span-3')}>
              <dt className="text-xs text-muted-foreground">{fs.description.label}</dt>
              <dd className="whitespace-pre-line break-words font-medium">{item.description || '—'}</dd>
            </div>
            {fs.group.visible && (
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{fs.group.label}</dt>
                <dd className={cn('break-words', !item.group && 'italic text-muted-foreground')}>{item.group || 'Without a group'}</dd>
              </div>
            )}
            <div className="min-w-0 sm:col-span-3">
              <dt className="sr-only">Scope and schedule</dt>
              <dd className="text-[11px] text-muted-foreground">
                {item.scope} › {item.schedule}
                {canEdit ? ' · to change the item itself, use Edit item details on the register' : ''}
              </dd>
            </div>
          </dl>
        )}

        {sub && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <div className={cn('space-y-2', !fs.assignedTo.visible && 'sm:col-span-2')}>
              <Label htmlFor="sub-title">
                <Mark setting={fs.title} />
              </Label>
              <Input id="sub-title" value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="e.g. GA Drawing, Foundation Drawing" />
            </div>
            {fs.assignedTo.visible && (
              <div className="space-y-2">
                <Label htmlFor="sub-assignee">
                  <Mark setting={fs.assignedTo} />
                </Label>
                <Select value={form.assignedToId || UNASSIGNED} onValueChange={(value) => setForm((c) => ({ ...c, assignedToId: value === UNASSIGNED ? '' : value }))} disabled={!canEdit}>
                  <SelectTrigger id="sub-assignee" className="text-left">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {assigneeOptions.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">The assignee can update this sub-drawing even without Edit rights on the register.</p>
              </div>
            )}
          </div>
        )}

        {(fs.docNo.visible || fs.drawingNo.visible || fs.plannedStartDate.visible || fs.plannedEndDate.visible) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fs.docNo.visible && (
              <div className="space-y-2">
                <Label htmlFor="doc-no">
                  <Mark setting={fs.docNo} />
                </Label>
                <Input id="doc-no" value={form.docNo} onChange={(e) => setForm((c) => ({ ...c, docNo: e.target.value }))} />
              </div>
            )}
            {fs.drawingNo.visible && (
              <div className="space-y-2">
                <Label htmlFor="drawing-no">
                  <Mark setting={fs.drawingNo} />
                </Label>
                <Input id="drawing-no" value={form.drawingNo} onChange={(e) => setForm((c) => ({ ...c, drawingNo: e.target.value }))} />
              </div>
            )}
            {fs.plannedStartDate.visible && (
              <div className="space-y-2">
                <Label htmlFor="planned-start-date">
                  <Mark setting={fs.plannedStartDate} />
                </Label>
                <Input id="planned-start-date" type="date" value={form.plannedStartDate} onChange={(e) => setForm((c) => ({ ...c, plannedStartDate: e.target.value }))} />
              </div>
            )}
            {fs.plannedEndDate.visible && (
              <div className="space-y-2">
                <Label htmlFor="planned-end-date">
                  <Mark setting={fs.plannedEndDate} />
                </Label>
                <Input id="planned-end-date" type="date" min={form.plannedStartDate || undefined} value={form.plannedEndDate} onChange={(e) => setForm((c) => ({ ...c, plannedEndDate: e.target.value }))} />
              </div>
            )}
          </div>
        )}

        {isNew ? (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Just name the drawing for now. Its submission rounds, status and approval are recorded from this same dialog once it exists.
          </p>
        ) : (
          <>
            <div className="h-px bg-border" />
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Submission to Client</p>
                <p className="text-xs text-muted-foreground">
                  Optional while planning. Once you submit a round to the client{fs.file.visible ? ', attach the drawing that went with it' : ''}.{' '}
                  {rule.enabled ? describeDateRule(rule) : ''}
                </p>
              </div>
              {form.revisions.slice(0, visibleRounds).map((revision) => {
                const pendingFile = pendingFiles[revision.round];
                return (
                  <div key={revision.round} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{revision.round}</Badge>
                      <RoundTiming revision={revision} next={form.revisions[form.revisions.indexOf(revision) + 1]} approveDate={form.approveDate} today={today} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          <Mark setting={fs.submissionDate} />
                        </Label>
                        <Input type="date" min={windows.submission.min ?? undefined} max={windows.submission.max} value={revision.submissionDate ?? ''} onChange={(e) => updateRevision(revision.round, { submissionDate: e.target.value })} />
                      </div>
                      {fs.transmittalNo.visible && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            <Mark setting={fs.transmittalNo} />
                          </Label>
                          <Input value={revision.transmittalNo ?? ''} onChange={(e) => updateRevision(revision.round, { transmittalNo: e.target.value })} />
                        </div>
                      )}
                      {fs.roundStatus.visible && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            <Mark setting={fs.roundStatus} />
                          </Label>
                          <Select value={revision.status || NO_STATUS} onValueChange={(value) => updateRevision(revision.round, { status: value === NO_STATUS ? '' : (value as RevisionStatus) })}>
                            <SelectTrigger className="text-left">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_STATUS}>Select...</SelectItem>
                              {REVISION_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {fs.commentsDate.visible && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            <Mark setting={fs.commentsDate} />
                          </Label>
                          <Input
                            type="date"
                            max={windows.comments.max}
                            min={[revision.submissionDate, windows.comments.min].filter(Boolean).sort().pop() || undefined}
                            value={revision.commentsDate ?? ''}
                            onChange={(e) => updateRevision(revision.round, { commentsDate: e.target.value })}
                          />
                        </div>
                      )}
                      {fs.file.visible && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            <Mark setting={fs.file} />
                          </Label>
                          <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" onChange={(e) => setPendingFiles((current) => ({ ...current, [revision.round]: e.target.files?.[0] ?? undefined }))} />
                          {(pendingFile || revision.filePath) && (
                            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                              <Paperclip className="h-3 w-3 shrink-0" />
                              {pendingFile ? (
                                pendingFile.name
                              ) : (
                                <button type="button" onClick={() => openFile(revision.filePath!)} className="truncate text-left underline underline-offset-2">
                                  {revision.fileName || 'View drawing'}
                                </button>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                      {fs.comments.visible && (
                        <div className="space-y-1.5 sm:col-span-2 lg:col-span-5">
                          <Label className="text-xs">
                            <Mark setting={fs.comments} />
                          </Label>
                          <Input value={revision.comments ?? ''} onChange={(e) => updateRevision(revision.round, { comments: e.target.value })} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleRounds < REVISION_ROUNDS.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isRevisionRejected(form.revisions[visibleRounds - 1])}
                  onClick={() => {
                    const round = REVISION_ROUNDS[visibleRounds];
                    setForm((current) =>
                      current.revisions.some((revision) => revision.round === round)
                        ? current
                        : { ...current, revisions: [...current.revisions, { round, submissionDate: '', comments: '', commentsDate: '' }] },
                    );
                    setVisibleRounds((count) => Math.min(count + 1, REVISION_ROUNDS.length));
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Revision ({REVISION_ROUNDS[visibleRounds]})
                </Button>
              )}
              {visibleRounds < REVISION_ROUNDS.length && !isRevisionRejected(form.revisions[visibleRounds - 1]) && (
                <p className="text-xs text-muted-foreground">Mark {form.revisions[visibleRounds - 1]?.round} as Rejected or Resubmission Required to add the next revision.</p>
              )}
            </div>
            <div className="h-px bg-border" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fs.approveDate.visible && (
                <div className="space-y-2">
                  <Label htmlFor="approve-date">
                    <Mark setting={fs.approveDate} required={fs.approveDate.required && isApproved(form.status)} />
                  </Label>
                  <Input id="approve-date" type="date" min={windows.approval.min ?? undefined} max={windows.approval.max} value={form.approveDate} onChange={(e) => setForm((c) => ({ ...c, approveDate: e.target.value }))} />
                </div>
              )}
              <div className={cn('space-y-2', !fs.approveDate.visible && 'sm:col-span-2')}>
                <Label htmlFor="overall-status">
                  <Mark setting={fs.status} />
                </Label>
                <Select value={form.status} onValueChange={(status) => setForm((c) => ({ ...c, status: status as OverallStatus }))}>
                  <SelectTrigger id="overall-status" className="text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OVERALL_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {fs.remark.visible && (
              <div className="space-y-2">
                <Label htmlFor="remark">
                  <Mark setting={fs.remark} />
                </Label>
                <Textarea id="remark" value={form.remark} onChange={(e) => setForm((c) => ({ ...c, remark: e.target.value }))} />
              </div>
            )}
            {!sub && item.legacy && (
              <div className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                <p>
                  Imported from Excel{item.legacy.source ? ` · ${item.legacy.source}` : ''}
                  {item.legacy.status ? ` · workbook status “${item.legacy.status}”` : ''}
                </p>
                {item.legacy.issues.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-800">
                    {item.legacy.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <DialogFooter className={DIALOG.footer}>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : isNew ? <Plus className="mr-2 h-4 w-4" /> : <Pencil className="mr-2 h-4 w-4" />}
          {isNew ? 'Add Sub-drawing' : 'Save'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
