'use client';

/**
 * Meeting and agenda templates (§43, §44).
 *
 * A template is the answer to "we have this meeting every month and it takes four minutes to set
 * up every time". It stores the *selection* — the teams and departments, not a flattened roster —
 * so a meeting created from it next quarter invites whoever is in those groups then (§84).
 *
 * Archived rather than deleted, like everything else in the module: a meeting created from a
 * template keeps its `templateId`, and deleting the template would leave that pointing at nothing.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  Archive,
  CalendarPlus,
  LayoutTemplate,
  ListOrdered,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_PARTICIPANT_SELECTION,
  MEETING_MODES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  formatDuration,
  type AgendaTemplateItem,
  type MeetingMode,
  type OfficeHubAgendaTemplate,
  type OfficeHubMeetingTemplate,
  type OfficeHubPriority,
  type ParticipantSelection,
} from '@/lib/office-hub';
import {
  archiveTemplate,
  listAgendaTemplates,
  listMeetingTemplates,
  saveAgendaTemplate,
  saveMeetingTemplate,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubEmptyState,
  OfficeHubPageHeader,
  officeHubDialog,
} from '@/components/office-hub/ui';
import { ParticipantSelector, TimeField } from '@/components/office-hub/selectors';

interface MeetingTemplateDraft {
  id?: string;
  name: string;
  description: string;
  meetingType: string;
  durationMinutes: number;
  mode: MeetingMode;
  location: string;
  meetingUrl: string;
  priority: OfficeHubPriority;
  defaultStartTime: string;
  reminderOffsets: number[];
  selection: ParticipantSelection;
}

interface AgendaTemplateDraft {
  id?: string;
  name: string;
  description: string;
  meetingType: string;
  items: AgendaTemplateItem[];
}

export default function TemplatesPage() {
  const { actor, viewer, capabilities, settings, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const meetingTemplatesQuery = useOfficeHubQuery(() => listMeetingTemplates(), [], {
    enabled: capabilities.canViewTemplates,
    initial: [],
  });
  const agendaTemplatesQuery = useOfficeHubQuery(() => listAgendaTemplates(), [], {
    enabled: capabilities.canViewTemplates,
    initial: [],
  });

  const [meetingDraft, setMeetingDraft] = useState<MeetingTemplateDraft | null>(null);
  const [agendaDraft, setAgendaDraft] = useState<AgendaTemplateDraft | null>(null);
  const [newItem, setNewItem] = useState('');

  const emptyMeetingDraft = (): MeetingTemplateDraft => ({
    name: '',
    description: '',
    meetingType: settings.meetingTypes[0] ?? 'Review',
    durationMinutes: settings.defaultMeetingDurationMinutes,
    mode: 'Offline',
    location: '',
    meetingUrl: '',
    priority: 'Medium',
    defaultStartTime: settings.workingHoursStart,
    reminderOffsets: settings.defaultReminderOffsets,
    selection: { ...EMPTY_PARTICIPANT_SELECTION, userIds: viewer.userId ? [viewer.userId] : [] },
  });

  const saveMeeting = async () => {
    if (!meetingDraft || !actor || !meetingDraft.name.trim()) return;
    const result = await run(
      () =>
        saveMeetingTemplate(actor, {
          id: meetingDraft.id,
          name: meetingDraft.name.trim(),
          description: meetingDraft.description.trim() || null,
          meetingType: meetingDraft.meetingType,
          durationMinutes: Math.max(5, Math.min(480, meetingDraft.durationMinutes)),
          mode: meetingDraft.mode,
          location: meetingDraft.location.trim() || null,
          meetingUrl: meetingDraft.meetingUrl.trim() || null,
          priority: meetingDraft.priority,
          defaultStartTime: meetingDraft.defaultStartTime,
          reminderOffsets: meetingDraft.reminderOffsets,
          participantUserIds: meetingDraft.selection.userIds,
          participantTeamIds: meetingDraft.selection.teamIds,
          participantDepartmentIds: meetingDraft.selection.departmentIds,
          optionalUserIds: meetingDraft.selection.optionalUserIds ?? [],
          status: 'Active',
        }),
      { success: meetingDraft.id ? 'Template updated' : 'Template created', failure: 'Could not save the template' },
    );
    if (result) {
      setMeetingDraft(null);
      meetingTemplatesQuery.reload();
    }
  };

  const saveAgenda = async () => {
    if (!agendaDraft || !actor || !agendaDraft.name.trim()) return;
    const result = await run(
      () =>
        saveAgendaTemplate(actor, {
          id: agendaDraft.id,
          name: agendaDraft.name.trim(),
          description: agendaDraft.description.trim() || null,
          meetingType: agendaDraft.meetingType || null,
          items: agendaDraft.items.map((item, index) => ({ ...item, order: index + 1 })),
          status: 'Active',
        }),
      { success: agendaDraft.id ? 'Agenda template updated' : 'Agenda template created', failure: 'Could not save the template' },
    );
    if (result) {
      setAgendaDraft(null);
      agendaTemplatesQuery.reload();
    }
  };

  const archive = async (kind: 'meeting' | 'agenda', templateId: string) => {
    if (!actor) return;
    await run(() => archiveTemplate(actor, kind, templateId), {
      success: 'Template archived',
      failure: 'Could not archive the template',
    });
    if (kind === 'meeting') meetingTemplatesQuery.reload();
    else agendaTemplatesQuery.reload();
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewTemplates) return <OfficeHubAccessDenied what="templates" />;

  const meetingTemplates = meetingTemplatesQuery.data ?? [];
  const agendaTemplates = agendaTemplatesQuery.data ?? [];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Templates"
        description="Set a recurring meeting up once. Everything is still editable when you use it."
      />

      <Tabs defaultValue="meetings">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="meetings" className="gap-1.5 text-xs">
            <LayoutTemplate className="h-3.5 w-3.5" />
            Meeting templates ({meetingTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="agendas" className="gap-1.5 text-xs">
            <ListOrdered className="h-3.5 w-3.5" />
            Agenda templates ({agendaTemplates.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="meetings" className="mt-3 space-y-3">
          {capabilities.canManageTemplates && (
            <Button onClick={() => setMeetingDraft(emptyMeetingDraft())} className="gap-2">
              <Plus className="h-4 w-4" />
              New meeting template
            </Button>
          )}

          {meetingTemplatesQuery.isLoading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : meetingTemplates.length === 0 ? (
            <OfficeHubEmptyState
              icon={LayoutTemplate}
              title="No meeting templates yet."
              description='A template stores the type, duration, invitees and reminders — so "Monthly Finance Review" takes one click instead of four minutes.'
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {meetingTemplates.map((template) => (
                <MeetingTemplateCard
                  key={template.id}
                  template={template}
                  canManage={capabilities.canManageTemplates}
                  canCreateMeeting={capabilities.canCreateMeeting}
                  onEdit={() =>
                    setMeetingDraft({
                      id: template.id,
                      name: template.name,
                      description: template.description ?? '',
                      meetingType: template.meetingType,
                      durationMinutes: template.durationMinutes,
                      mode: template.mode,
                      location: template.location ?? '',
                      meetingUrl: template.meetingUrl ?? '',
                      priority: template.priority,
                      defaultStartTime: template.defaultStartTime ?? settings.workingHoursStart,
                      reminderOffsets: [...(template.reminderOffsets ?? [])],
                      selection: {
                        userIds: [...(template.participantUserIds ?? [])],
                        teamIds: [...(template.participantTeamIds ?? [])],
                        departmentIds: [...(template.participantDepartmentIds ?? [])],
                        optionalUserIds: [...(template.optionalUserIds ?? [])],
                        optionalTeamIds: [],
                        optionalDepartmentIds: [],
                      },
                    })
                  }
                  onArchive={() => void archive('meeting', template.id)}
                  disabled={isBusy}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="agendas" className="mt-3 space-y-3">
          {capabilities.canManageTemplates && (
            <Button
              onClick={() => setAgendaDraft({ name: '', description: '', meetingType: '', items: [] })}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New agenda template
            </Button>
          )}

          {agendaTemplatesQuery.isLoading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : agendaTemplates.length === 0 ? (
            <OfficeHubEmptyState
              icon={ListOrdered}
              title="No agenda templates yet."
              description="A reusable running order — previous action items, progress, issues, next actions — applied to a meeting in one click."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {agendaTemplates.map((template) => (
                <AgendaTemplateCard
                  key={template.id}
                  template={template}
                  canManage={capabilities.canManageTemplates}
                  onEdit={() =>
                    setAgendaDraft({
                      id: template.id,
                      name: template.name,
                      description: template.description ?? '',
                      meetingType: template.meetingType ?? '',
                      items: [...template.items],
                    })
                  }
                  onArchive={() => void archive('agenda', template.id)}
                  disabled={isBusy}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── meeting template dialog ─────────────────────────────────────────────────────────────── */}
      <Dialog open={Boolean(meetingDraft)} onOpenChange={(open) => !open && setMeetingDraft(null)}>
        <DialogContent className={officeHubDialog.contentTall}>
          <DialogHeader className={officeHubDialog.header}>
            <DialogTitle>{meetingDraft?.id ? 'Edit meeting template' : 'New meeting template'}</DialogTitle>
            <DialogDescription>
              Teams and departments are stored as selections, so a meeting made from this template
              next quarter invites whoever is in them then.
            </DialogDescription>
          </DialogHeader>

          {meetingDraft && (
            <div className={officeHubDialog.bodyScroll}>
              <div>
                <Label className="mb-1 block text-xs">
                  Template name<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={meetingDraft.name}
                  onChange={(event) => setMeetingDraft({ ...meetingDraft, name: event.target.value })}
                  placeholder="e.g. Weekly Project Review"
                  className="bg-white"
                  autoFocus
                />
              </div>

              <div>
                <Label className="mb-1 block text-xs">Description</Label>
                <Textarea
                  value={meetingDraft.description}
                  onChange={(event) => setMeetingDraft({ ...meetingDraft, description: event.target.value })}
                  rows={2}
                  className="bg-white"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-xs">Meeting type</Label>
                  <Select
                    value={meetingDraft.meetingType}
                    onValueChange={(value) => setMeetingDraft({ ...meetingDraft, meetingType: value })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.meetingTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1 block text-xs">Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={480}
                    value={meetingDraft.durationMinutes}
                    onChange={(event) =>
                      setMeetingDraft({ ...meetingDraft, durationMinutes: Number(event.target.value) || 60 })
                    }
                    className="bg-white"
                  />
                </div>

                <TimeField
                  label="Usual start time"
                  value={meetingDraft.defaultStartTime}
                  onChange={(next) => setMeetingDraft({ ...meetingDraft, defaultStartTime: next })}
                />

                <div>
                  <Label className="mb-1 block text-xs">Priority</Label>
                  <Select
                    value={meetingDraft.priority}
                    onValueChange={(value) => setMeetingDraft({ ...meetingDraft, priority: value as OfficeHubPriority })}
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
                  <Label className="mb-1 block text-xs">Mode</Label>
                  <Select
                    value={meetingDraft.mode}
                    onValueChange={(value) => setMeetingDraft({ ...meetingDraft, mode: value as MeetingMode })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEETING_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {meetingDraft.mode !== 'Online' && (
                  <div>
                    <Label className="mb-1 block text-xs">Usual location</Label>
                    <Input
                      value={meetingDraft.location}
                      onChange={(event) => setMeetingDraft({ ...meetingDraft, location: event.target.value })}
                      placeholder="e.g. Board Room"
                      className="bg-white"
                    />
                  </div>
                )}

                {meetingDraft.mode !== 'Offline' && (
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs">Standing joining link</Label>
                    <Input
                      value={meetingDraft.meetingUrl}
                      onChange={(event) => setMeetingDraft({ ...meetingDraft, meetingUrl: event.target.value })}
                      placeholder="https://… (optional — a recurring room link)"
                      className="bg-white"
                      inputMode="url"
                    />
                  </div>
                )}
              </div>

              <div>
                <Label className="mb-1 block text-xs">Default invitees</Label>
                <ParticipantSelector
                  selection={meetingDraft.selection}
                  organizerId={null}
                  onChange={(next) => setMeetingDraft({ ...meetingDraft, selection: next })}
                />
              </div>
            </div>
          )}

          <DialogFooter className={officeHubDialog.footer}>
            <Button variant="ghost" onClick={() => setMeetingDraft(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => void saveMeeting()} disabled={isBusy || !meetingDraft?.name.trim()}>
              {meetingDraft?.id ? 'Save template' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── agenda template dialog ─────────────────────────────────────────────────────────────── */}
      <Dialog open={Boolean(agendaDraft)} onOpenChange={(open) => !open && setAgendaDraft(null)}>
        <DialogContent className={officeHubDialog.contentTall}>
          <DialogHeader className={officeHubDialog.header}>
            <DialogTitle>{agendaDraft?.id ? 'Edit agenda template' : 'New agenda template'}</DialogTitle>
            <DialogDescription>A running order that can be applied to any meeting.</DialogDescription>
          </DialogHeader>

          {agendaDraft && (
            <div className={officeHubDialog.bodyScroll}>
              <div>
                <Label className="mb-1 block text-xs">
                  Template name<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={agendaDraft.name}
                  onChange={(event) => setAgendaDraft({ ...agendaDraft, name: event.target.value })}
                  placeholder="e.g. Weekly Project Review"
                  className="bg-white"
                  autoFocus
                />
              </div>

              <div>
                <Label className="mb-1 block text-xs">Applies to meeting type</Label>
                <Select
                  value={agendaDraft.meetingType || '__any__'}
                  onValueChange={(value) =>
                    setAgendaDraft({ ...agendaDraft, meetingType: value === '__any__' ? '' : value })
                  }
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any type</SelectItem>
                    {settings.meetingTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1 block text-xs">Items, in order</Label>
                {agendaDraft.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed bg-white/60 p-4 text-center text-xs text-muted-foreground">
                    No items yet. A good default opens with last time&rsquo;s action items.
                  </p>
                ) : (
                  <ol className="mb-2 space-y-1">
                    {agendaDraft.items.map((item, index) => (
                      <li key={`${item.title}-${index}`} className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          aria-label={`Remove ${item.title}`}
                          onClick={() =>
                            setAgendaDraft({
                              ...agendaDraft,
                              items: agendaDraft.items.filter((_, position) => position !== index),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="flex gap-2">
                  <Input
                    value={newItem}
                    onChange={(event) => setNewItem(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      if (!newItem.trim()) return;
                      setAgendaDraft({
                        ...agendaDraft,
                        items: [
                          ...agendaDraft.items,
                          { title: newItem.trim(), order: agendaDraft.items.length + 1, priority: 'Medium' },
                        ],
                      });
                      setNewItem('');
                    }}
                    placeholder="Add an item and press Enter"
                    className="bg-white"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!newItem.trim()}
                    onClick={() => {
                      if (!newItem.trim()) return;
                      setAgendaDraft({
                        ...agendaDraft,
                        items: [
                          ...agendaDraft.items,
                          { title: newItem.trim(), order: agendaDraft.items.length + 1, priority: 'Medium' },
                        ],
                      });
                      setNewItem('');
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className={officeHubDialog.footer}>
            <Button variant="ghost" onClick={() => setAgendaDraft(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => void saveAgenda()} disabled={isBusy || !agendaDraft?.name.trim()}>
              {agendaDraft?.id ? 'Save template' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MeetingTemplateCard({
  template,
  canManage,
  canCreateMeeting,
  onEdit,
  onArchive,
  disabled,
}: {
  template: OfficeHubMeetingTemplate;
  canManage: boolean;
  canCreateMeeting: boolean;
  onEdit: () => void;
  onArchive: () => void;
  disabled: boolean;
}) {
  const inviteeCount =
    (template.participantUserIds?.length ?? 0) +
    (template.participantTeamIds?.length ?? 0) +
    (template.participantDepartmentIds?.length ?? 0);

  return (
    <Card className="border-white/60 bg-white/80">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{template.name}</p>
            {template.description && (
              <p className="truncate text-xs text-muted-foreground">{template.description}</p>
            )}
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} disabled={disabled} aria-label="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={onArchive}
                disabled={disabled}
                aria-label="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {template.meetingType}
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {formatDuration(template.durationMinutes)}
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {template.mode}
          </Badge>
          {template.defaultStartTime && (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
              {template.defaultStartTime}
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-[11px]">
            <Users className="h-3 w-3" />
            {inviteeCount} selection{inviteeCount === 1 ? '' : 's'}
          </Badge>
          {(template.reminderOffsets?.length ?? 0) > 0 && (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
              {template.reminderOffsets.length} reminder{template.reminderOffsets.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>

        {canCreateMeeting && (
          <Button size="sm" variant="outline" asChild className="gap-2">
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new?template=${template.id}`}>
              <CalendarPlus className="h-4 w-4" />
              Use this template
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AgendaTemplateCard({
  template,
  canManage,
  onEdit,
  onArchive,
  disabled,
}: {
  template: OfficeHubAgendaTemplate;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="border-white/60 bg-white/80">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{template.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {template.items.length} item{template.items.length === 1 ? '' : 's'}
              {template.meetingType ? ` · ${template.meetingType}` : ' · any meeting type'}
            </p>
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} disabled={disabled} aria-label="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={onArchive}
                disabled={disabled}
                aria-label="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <ol className="ml-4 list-decimal space-y-0.5 text-xs text-slate-700">
          {template.items.slice(0, 6).map((item, index) => (
            <li key={`${item.title}-${index}`} className="truncate">
              {item.title}
            </li>
          ))}
          {template.items.length > 6 && (
            <li className="list-none text-muted-foreground">+{template.items.length - 6} more</li>
          )}
        </ol>

        <p className="text-[11px] text-muted-foreground">
          Apply it from a meeting&rsquo;s Agenda tab.
        </p>
      </CardContent>
    </Card>
  );
}
