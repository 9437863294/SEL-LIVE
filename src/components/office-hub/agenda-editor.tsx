'use client';

/**
 * The agenda editor (§17) and the live-mode agenda (§18).
 *
 * Reordering is by up/down buttons rather than drag-and-drop. The repository has
 * `@hello-pangea/dnd` available and the Kanban board uses it, but an agenda is a short, precisely
 * ordered list that is most often edited on a phone during or just before the meeting — and
 * drag-and-drop on a touch screen inside a scrolling dialog is the worst-performing interaction in
 * this application. Buttons are also keyboard-operable for free, which §55 asks for. Every move
 * writes the whole list's order through `reorderAgenda`, so no two items can end up tied.
 */

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ListOrdered,
  Pencil,
  Plus,
  Trash2,
  Check,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_PRIORITIES,
  agendaFitsMeeting,
  agendaItemsFromTemplate,
  formatDuration,
  reorderAgenda,
  sortAgenda,
  type OfficeHubAgendaItem,
  type OfficeHubAgendaTemplate,
  type OfficeHubMeeting,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import {
  deleteAgendaItem,
  markAgendaItemCovered,
  reorderAgendaItems,
  saveAgendaItem,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { UserSelector } from './selectors';
import { OfficeHubEmptyState, PriorityBadge, officeHubDialog } from './ui';

interface AgendaDraft {
  id?: string;
  title: string;
  description: string;
  expectedOutcome: string;
  presenterId: string | null;
  presenterName: string | null;
  priority: OfficeHubPriority;
  estimatedMinutes: string;
}

const emptyDraft = (): AgendaDraft => ({
  title: '',
  description: '',
  expectedOutcome: '',
  presenterId: null,
  presenterName: null,
  priority: 'Medium',
  estimatedMinutes: '',
});

export function AgendaEditor({
  meeting,
  items,
  canEdit,
  templates,
  onChanged,
  /** Live mode shows a "covered" tick per item and hides the reordering controls. */
  liveMode,
}: {
  meeting: OfficeHubMeeting;
  items: OfficeHubAgendaItem[];
  canEdit: boolean;
  templates?: OfficeHubAgendaTemplate[];
  onChanged: () => void;
  liveMode?: boolean;
}) {
  const { actor } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [draft, setDraft] = useState<AgendaDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => sortAgenda(items), [items]);
  const fit = useMemo(() => agendaFitsMeeting(sorted, meeting), [sorted, meeting]);

  const save = async () => {
    if (!draft || !actor) return;
    if (!draft.title.trim()) {
      setError('Give the agenda item a title.');
      return;
    }
    const minutes = draft.estimatedMinutes.trim() ? Number(draft.estimatedMinutes) : null;
    if (minutes != null && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480)) {
      setError('Estimated duration must be between 1 and 480 minutes.');
      return;
    }

    const result = await run(
      () =>
        saveAgendaItem(actor, meeting.id, {
          id: draft.id,
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          expectedOutcome: draft.expectedOutcome.trim() || null,
          presenterId: draft.presenterId,
          presenterName: draft.presenterName,
          priority: draft.priority,
          estimatedMinutes: minutes,
        }),
      { success: draft.id ? 'Agenda item updated' : 'Agenda item added', failure: 'Could not save the agenda item' },
    );
    if (result != null) {
      setDraft(null);
      setError(null);
      onChanged();
    }
  };

  const move = async (itemId: string, direction: -1 | 1) => {
    if (!actor) return;
    const index = sorted.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const order = reorderAgenda(sorted, itemId, index + direction);
    await run(() => reorderAgendaItems(actor, meeting.id, order), { failure: 'Could not reorder the agenda' });
    onChanged();
  };

  const remove = async (itemId: string) => {
    if (!actor) return;
    await run(() => deleteAgendaItem(actor, meeting.id, itemId), {
      success: 'Agenda item removed',
      failure: 'Could not remove the agenda item',
    });
    onChanged();
  };

  const toggleCovered = async (item: OfficeHubAgendaItem) => {
    if (!actor) return;
    await run(() => markAgendaItemCovered(actor, item.id, !item.covered), {
      failure: 'Could not update the agenda',
    });
    onChanged();
  };

  const applyTemplate = async (templateId: string) => {
    if (!actor) return;
    const template = templates?.find((entry) => entry.id === templateId);
    if (!template) return;
    const drafts = agendaItemsFromTemplate(template);
    await run(
      async () => {
        // Sequential rather than parallel: each `saveAgendaItem` reads the current list to work out
        // the next order number, and firing them together would give several items the same one.
        for (const item of drafts) {
          await saveAgendaItem(actor, meeting.id, {
            title: item.title,
            description: item.description,
            expectedOutcome: item.expectedOutcome,
            estimatedMinutes: item.estimatedMinutes,
            priority: item.priority,
          });
        }
      },
      { success: `Added ${drafts.length} items from "${template.name}"`, failure: 'Could not apply the template' },
    );
    onChanged();
  };

  return (
    <div className="space-y-3">
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListOrdered className="h-3.5 w-3.5" />
            {sorted.length} item{sorted.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(fit.estimated)} planned of {formatDuration(fit.available)}
          </span>
          {!fit.fits && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] text-amber-800">
              {formatDuration(fit.overBy)} over the booked slot
            </Badge>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        <OfficeHubEmptyState
          icon={ListOrdered}
          title="No agenda items yet."
          description={
            canEdit
              ? 'Add what the meeting will cover so participants can prepare.'
              : 'The organizer has not published an agenda for this meeting.'
          }
          action={
            canEdit ? (
              <Button size="sm" onClick={() => setDraft(emptyDraft())} className="gap-2">
                <Plus className="h-4 w-4" />
                Add the first item
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ol className="space-y-2">
          {sorted.map((item, index) => (
            <li
              key={item.id}
              className={cn(
                'rounded-lg border bg-white p-3',
                item.covered && 'border-emerald-200 bg-emerald-50/50',
              )}
            >
              <div className="flex items-start gap-2">
                {liveMode ? (
                  <Checkbox
                    checked={Boolean(item.covered)}
                    onCheckedChange={() => void toggleCovered(item)}
                    disabled={!canEdit || isBusy}
                    className="mt-0.5"
                    aria-label={`Mark "${item.title}" as covered`}
                  />
                ) : (
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {index + 1}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className={cn('min-w-0 break-words text-sm font-medium text-slate-800', item.covered && 'line-through opacity-70')}>
                      {item.title}
                    </p>
                    <PriorityBadge priority={item.priority} />
                    {item.estimatedMinutes ? (
                      <span className="text-[11px] text-muted-foreground">{formatDuration(item.estimatedMinutes)}</span>
                    ) : null}
                    {item.carriedFromMeetingId && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                        Carried forward
                      </Badge>
                    )}
                  </div>

                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {item.presenterName && <span>Presenter: {item.presenterName}</span>}
                    {item.expectedOutcome && <span>Outcome: {item.expectedOutcome}</span>}
                  </div>
                  {item.discussionNote && (
                    <p className="mt-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      {item.discussionNote}
                    </p>
                  )}
                </div>

                {canEdit && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {!liveMode && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={index === 0 || isBusy}
                          onClick={() => void move(item.id, -1)}
                          aria-label={`Move "${item.title}" up`}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={index === sorted.length - 1 || isBusy}
                          onClick={() => void move(item.id, 1)}
                          aria-label={`Move "${item.title}" down`}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={isBusy}
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          title: item.title,
                          description: item.description ?? '',
                          expectedOutcome: item.expectedOutcome ?? '',
                          presenterId: item.presenterId ?? null,
                          presenterName: item.presenterName ?? null,
                          priority: item.priority,
                          estimatedMinutes: item.estimatedMinutes ? String(item.estimatedMinutes) : '',
                        })
                      }
                      aria-label={`Edit "${item.title}"`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!liveMode && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        disabled={isBusy}
                        onClick={() => void remove(item.id)}
                        aria-label={`Remove "${item.title}"`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())} className="gap-2">
            <Plus className="h-4 w-4" />
            Add item
          </Button>
          {templates && templates.length > 0 && sorted.length === 0 && (
            <Select onValueChange={(value) => void applyTemplate(value)}>
              <SelectTrigger className="h-9 w-56 bg-white text-xs">
                <SelectValue placeholder="Use an agenda template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} ({template.items.length} items)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className={officeHubDialog.content}>
          <DialogHeader className={officeHubDialog.header}>
            <DialogTitle>{draft?.id ? 'Edit agenda item' : 'Add agenda item'}</DialogTitle>
            <DialogDescription>What will be covered, by whom, and what should come out of it.</DialogDescription>
          </DialogHeader>

          {draft && (
            <div className={officeHubDialog.body}>
              <div>
                <Label className="mb-1 block text-xs">
                  Title<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="e.g. Cash position and overdraft utilisation"
                  className="bg-white"
                  autoFocus
                />
              </div>

              <div>
                <Label className="mb-1 block text-xs">Description</Label>
                <Textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  rows={3}
                  className="bg-white"
                />
              </div>

              <div>
                <Label className="mb-1 block text-xs">Expected outcome</Label>
                <Input
                  value={draft.expectedOutcome}
                  onChange={(event) => setDraft({ ...draft, expectedOutcome: event.target.value })}
                  placeholder="e.g. Agree the limit to request"
                  className="bg-white"
                />
              </div>

              <UserSelector
                label="Presenter"
                value={draft.presenterId}
                onChange={(userId, person) =>
                  setDraft({ ...draft, presenterId: userId, presenterName: person?.name ?? null })
                }
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block text-xs">Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(value) => setDraft({ ...draft, priority: value as OfficeHubPriority })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OFFICE_HUB_PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {priority}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Estimated minutes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={480}
                    value={draft.estimatedMinutes}
                    onChange={(event) => setDraft({ ...draft, estimatedMinutes: event.target.value })}
                    placeholder="15"
                    className="bg-white"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter className={officeHubDialog.footer}>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={isBusy} className="gap-2">
              <Check className="h-4 w-4" />
              {draft?.id ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
