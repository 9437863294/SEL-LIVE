'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  CalendarClock,
  Check,
  FileCheck2,
  FileText,
  Loader2,
  ShieldAlert,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  dueJoiningReminders,
  summarizeDocumentChecklist,
  type Candidate,
  type DocumentVerificationStatus,
  type JoiningRecord,
  type PreJoiningDocument,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  confirmJoining,
  markNotJoined,
  postponeJoining,
  recordDocumentUpload,
  updateOnboardingStep,
  verifyDocument,
} from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrLoader,
  HrMeter,
  HrPageHeader,
  HrSection,
  HrStatusBadge,
  SensitiveMoney,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { ReasonDialog } from './interview-panel';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Pre-joining and joining — spec sections 31 to 36.
 *
 * One screen for both, because they are one queue seen at two moments: HR chases documents, then
 * confirms the joining, and the second is gated on the first. `mode` decides which the page leads
 * with, so the nav can offer "Pre-Joining" and "Joining" separately without duplicating the logic.
 *
 * Confirming a joining is the module's most consequential action — it creates the employee record
 * (control rule 63.7) — so it is the one dialog here that shows what it is about to do before it
 * does it.
 */

const ONBOARDING_STEPS: Array<{ key: keyof NonNullable<JoiningRecord['onboarding']>; label: string }> = [
  { key: 'employeeMasterCreated', label: 'Employee master created' },
  { key: 'officialEmailRequested', label: 'Official email requested' },
  { key: 'attendanceEnrolled', label: 'Attendance enrolment' },
  { key: 'payrollActivated', label: 'Payroll activation' },
  { key: 'reportingHierarchySet', label: 'Reporting hierarchy' },
  { key: 'appLoginCreated', label: 'App login created' },
  { key: 'inductionScheduled', label: 'Induction scheduled' },
];

export default function JoiningPanel({
  mode = 'joining',
  requirementId,
  embedded = false,
}: {
  mode?: 'joining' | 'pre-joining';
  requirementId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: joinings, loading } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);
  const { rows: documents } = useHrCollection<PreJoiningDocument>(HR_COLLECTIONS.preJoining);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);

  const [statusFilter, setStatusFilter] = useState(mode === 'pre-joining' ? 'documents' : 'upcoming');
  const [checklistFor, setChecklistFor] = useState<JoiningRecord | null>(null);
  const [confirmFor, setConfirmFor] = useState<JoiningRecord | null>(null);
  const [postponeFor, setPostponeFor] = useState<JoiningRecord | null>(null);
  const [notJoinedFor, setNotJoinedFor] = useState<{ record: JoiningRecord; outcome: 'NOT_JOINED' | 'OFFER_CANCELLED' } | null>(null);

  const documentsByJoining = useMemo(() => {
    const map = new Map<string, PreJoiningDocument[]>();
    for (const document of documents) {
      if (!document.joiningRecordId) continue;
      const bucket = map.get(document.joiningRecordId);
      if (bucket) bucket.push(document);
      else map.set(document.joiningRecordId, [document]);
    }
    return map;
  }, [documents]);

  const decorated = useMemo(
    () =>
      joinings
        .filter(record => (requirementId ? record.requirementId === requirementId : true))
        .map(record => {
          const checklist = documentsByJoining.get(record.id) || [];
          const summary = summarizeDocumentChecklist(
            checklist.map(item => ({ status: item.status, mandatory: item.mandatory })),
          );
          const joiningDate = record.revisedJoiningDate || record.plannedJoiningDate;
          const remindersDue = dueJoiningReminders({
            joiningDate,
            reminderDays: [7, 3, 1, 0],
            alreadySent: record.remindersSent || [],
          });
          return { ...record, checklist, summary, joiningDate, remindersDue };
        })
        .filter(record => {
          switch (statusFilter) {
            case 'documents':
              return !['JOINED', 'NOT_JOINED', 'OFFER_CANCELLED'].includes(record.status) && !record.summary.readyForJoining;
            case 'upcoming':
              return !['JOINED', 'NOT_JOINED', 'OFFER_CANCELLED'].includes(record.status);
            case 'joined':
              return record.status === 'JOINED';
            case 'not-joined':
              return ['NOT_JOINED', 'OFFER_CANCELLED'].includes(record.status);
            default:
              return true;
          }
        })
        .sort((a, b) => (a.joiningDate || '').localeCompare(b.joiningDate || '')),
    [joinings, documentsByJoining, requirementId, statusFilter],
  );

  const columns: Array<HrListColumn<(typeof decorated)[number]>> = [
    {
      header: 'Candidate',
      mobile: 'title',
      cell: row => (
        <Link href={`/hr/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
          {row.candidateName}
        </Link>
      ),
    },
    {
      header: 'Designation',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.designation}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.projectName || row.departmentName || '—'}
          </p>
        </div>
      ),
    },
    { header: 'Joining date', cell: row => row.joiningDate || '—' },
    {
      header: 'Documents',
      cell: row => (
        <div className="w-28">
          <HrMeter label={`${row.summary.verified + row.summary.waived}/${row.summary.total}`} percent={row.summary.completionPercent} />
        </div>
      ),
    },
    {
      header: 'CTC',
      align: 'right',
      className: 'hidden xl:table-cell',
      cell: row => <SensitiveMoney value={row.ctc} canView={permissions.canViewSalary} />,
    },
    {
      header: 'Employee code',
      className: 'hidden lg:table-cell',
      cell: row =>
        row.employeeCode ? (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-800">
            {row.employeeCode}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row => {
        if (row.status === 'JOINED') {
          return (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setChecklistFor(row)}>
                Onboarding
              </Button>
            </div>
          );
        }
        if (['NOT_JOINED', 'OFFER_CANCELLED'].includes(row.status)) {
          return <span className="text-xs text-muted-foreground">{row.notJoinedReason || '—'}</span>;
        }
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setChecklistFor(row)}>
              <FileText className="h-3.5 w-3.5" /> Documents
              {row.summary.mandatoryPending > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{row.summary.mandatoryPending}</Badge>
              )}
            </Button>
            {permissions.can('Confirm Joining', 'Joining') && (
              <Button size="sm" className="gap-1" onClick={() => setConfirmFor(row)}>
                <UserPlus className="h-3.5 w-3.5" /> Joined
              </Button>
            )}
            {permissions.can('Postpone', 'Joining') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">…</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setPostponeFor(row)}>
                    <CalendarClock className="mr-2 h-3.5 w-3.5" /> Postpone joining
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-700" onClick={() => setNotJoinedFor({ record: row, outcome: 'NOT_JOINED' })}>
                    <X className="mr-2 h-3.5 w-3.5" /> Did not join
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-700" onClick={() => setNotJoinedFor({ record: row, outcome: 'OFFER_CANCELLED' })}>
                    <ShieldAlert className="mr-2 h-3.5 w-3.5" /> Cancel the offer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      },
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading joinings…" />;

  const thisWeek = decorated.filter(row => {
    if (!row.joiningDate || row.status === 'JOINED') return false;
    const days = Math.floor((new Date(row.joiningDate).getTime() - new Date().getTime()) / 86_400_000);
    return days >= 0 && days <= 7;
  }).length;

  const documentsPending = decorated.filter(row => row.summary.mandatoryPending > 0 && row.status !== 'JOINED').length;

  return (
    <div>
      {!embedded && (
        <HrPageHeader
          title={mode === 'pre-joining' ? 'Pre-Joining' : 'Joining Management'}
          description={`${decorated.length} ${decorated.length === 1 ? 'record' : 'records'}${
            thisWeek ? ` · ${thisWeek} joining this week` : ''
          }${documentsPending ? ` · ${documentsPending} with documents pending` : ''}`}
        />
      )}

      <div className="mb-3 sm:w-60">
        <Label className="text-xs">Show</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="upcoming">Awaiting joining</SelectItem>
            <SelectItem value="documents">Documents pending</SelectItem>
            <SelectItem value="joined">Joined</SelectItem>
            <SelectItem value="not-joined">Did not join / cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <HrDataList
        rows={decorated}
        columns={columns}
        rowClassName={row => (row.summary.mandatoryPending > 0 && row.status !== 'JOINED' ? 'bg-amber-50/40' : undefined)}
        empty={
          <HrEmptyState
            icon={UserPlus}
            title="Nothing here yet"
            description="A joining record is created automatically when a candidate accepts their offer."
          />
        }
      />

      <ChecklistDialog record={checklistFor} onClose={() => setChecklistFor(null)} />

      <ConfirmJoiningDialog
        record={confirmFor}
        candidate={candidates.find(row => row.id === confirmFor?.candidateId) || null}
        onClose={() => setConfirmFor(null)}
      />

      <ReasonDialog
        open={Boolean(postponeFor)}
        title="Postpone joining"
        description={postponeFor ? `${postponeFor.candidateName} · currently ${postponeFor.revisedJoiningDate || postponeFor.plannedJoiningDate}` : ''}
        withDate
        reasonLabel="Reason for postponing"
        confirmLabel="Postpone"
        onClose={() => setPostponeFor(null)}
        onConfirm={async (reason, dateValue) => {
          if (!actor || !postponeFor) return;
          try {
            await postponeJoining(postponeFor.id, { revisedJoiningDate: dateValue || '', reason }, actor);
            toast({ title: 'Joining postponed', description: 'The reminder schedule restarts from the new date.' });
            setPostponeFor(null);
          } catch (error) {
            toast({
              title: 'Could not postpone',
              description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
              variant: 'destructive',
            });
          }
        }}
      />

      <ReasonDialog
        open={Boolean(notJoinedFor)}
        title={notJoinedFor?.outcome === 'NOT_JOINED' ? 'Candidate did not join' : 'Cancel the offer'}
        description={notJoinedFor ? notJoinedFor.record.candidateName : ''}
        reasonLabel="Reason"
        confirmLabel="Confirm"
        destructive
        onClose={() => setNotJoinedFor(null)}
        onConfirm={async reason => {
          if (!actor || !notJoinedFor) return;
          try {
            await markNotJoined(notJoinedFor.record.id, { reason, outcome: notJoinedFor.outcome }, actor);
            toast({ title: 'Recorded', description: 'The requirement balance has been restored.' });
            setNotJoinedFor(null);
          } catch (error) {
            toast({
              title: 'Could not record',
              description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
              variant: 'destructive',
            });
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Document checklist and verification (spec sections 31, 32)
 * ---------------------------------------------------------------------------------------------- */

function ChecklistDialog({ record, onClose }: { record: JoiningRecord | null; onClose: () => void }) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: documents } = useHrCollection<PreJoiningDocument>(HR_COLLECTIONS.preJoining);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<PreJoiningDocument | null>(null);
  const [verifyFor, setVerifyFor] = useState<{ document: PreJoiningDocument; status: DocumentVerificationStatus } | null>(null);

  const checklist = useMemo(
    () => documents.filter(document => document.joiningRecordId === record?.id).sort((a, b) => (a.documentType || '').localeCompare(b.documentType || '')),
    [documents, record],
  );

  const summary = summarizeDocumentChecklist(checklist.map(item => ({ status: item.status, mandatory: item.mandatory })));

  if (!record) return null;

  const setStatus = async (document: PreJoiningDocument, status: DocumentVerificationStatus) => {
    if (status === 'VERIFIED' || status === 'UNDER_VERIFICATION') {
      if (!actor) return;
      setBusyId(document.id);
      try {
        await verifyDocument(document.id, { status: status as 'VERIFIED' | 'UNDER_VERIFICATION' }, actor);
      } catch (error) {
        toast({
          title: 'Could not update',
          description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
          variant: 'destructive',
        });
      } finally {
        setBusyId(null);
      }
      return;
    }
    // Rejections, re-upload requests and waivers all need a written remark (spec section 32).
    setVerifyFor({ document, status });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{record.candidateName} — pre-joining documents</DialogTitle>
          <DialogDescription>
            {record.designation} · joining {record.revisedJoiningDate || record.plannedJoiningDate}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <HrMeter
            label="Checklist completion"
            percent={summary.completionPercent}
            hint={
              summary.readyForJoining
                ? 'All mandatory documents are verified or waived.'
                : `${summary.mandatoryPending} mandatory ${summary.mandatoryPending === 1 ? 'document' : 'documents'} outstanding.`
            }
          />

          {record.status === 'JOINED' && (
            <HrSection title="Onboarding" description="Spec section 36 — the triggers that follow joining.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ONBOARDING_STEPS.map(step => {
                  const done = Boolean(record.onboarding?.[step.key]);
                  return (
                    <label key={step.key} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={done}
                        disabled={!permissions.can('Manage Onboarding', 'Joining')}
                        onChange={async event => {
                          if (!actor) return;
                          try {
                            await updateOnboardingStep(record.id, step.key, event.target.checked, actor);
                          } catch {
                            toast({ title: 'Could not update the step', variant: 'destructive' });
                          }
                        }}
                      />
                      <span className={`text-sm ${done ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{step.label}</span>
                    </label>
                  );
                })}
              </div>
            </HrSection>
          )}

          <div className="space-y-2">
            {checklist.map(document => (
              <div key={document.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {document.documentType}
                      {document.mandatory && <span className="ml-1 text-rose-600">*</span>}
                    </p>
                    {document.verificationRemarks && (
                      <p className="mt-0.5 text-[11px] text-amber-700">{document.verificationRemarks}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <HrStatusBadge status={document.status} />
                    {busyId === document.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                    ) : (
                      <>
                        {document.fileUrl && (
                          <Button asChild size="sm" variant="ghost">
                            <a href={document.fileUrl} target="_blank" rel="noreferrer">View</a>
                          </Button>
                        )}
                        {permissions.can('Upload', 'Pre-Joining') && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setUploadFor(document)}>
                            <Upload className="h-3.5 w-3.5" /> {document.fileUrl ? 'Replace' : 'Upload'}
                          </Button>
                        )}
                        {permissions.can('Verify', 'Pre-Joining') && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost">…</Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setStatus(document, 'VERIFIED')}>
                                <Check className="mr-2 h-3.5 w-3.5" /> Verified
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setStatus(document, 'UNDER_VERIFICATION')}>
                                <FileCheck2 className="mr-2 h-3.5 w-3.5" /> Under verification
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setStatus(document, 'REUPLOAD_REQUIRED')}>
                                <Upload className="mr-2 h-3.5 w-3.5" /> Re-upload required
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-rose-700" onClick={() => setStatus(document, 'REJECTED')}>
                                <X className="mr-2 h-3.5 w-3.5" /> Rejected
                              </DropdownMenuItem>
                              {permissions.can('Waive', 'Pre-Joining') && (
                                <DropdownMenuItem onClick={() => setStatus(document, 'WAIVED')}>
                                  <BadgeCheck className="mr-2 h-3.5 w-3.5" /> Waive
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {checklist.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No checklist has been generated for this candidate.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>

        {/* A URL field rather than a file picker: uploads across this app go through the shared
            storage helper and each module's document screen, and this dialog records the result. */}
        <ReasonDialog
          open={Boolean(uploadFor)}
          title={`Attach ${uploadFor?.documentType || 'document'}`}
          reasonLabel="Document URL"
          placeholder="https://…"
          confirmLabel="Attach"
          onClose={() => setUploadFor(null)}
          onConfirm={async url => {
            if (!actor || !uploadFor) return;
            try {
              await recordDocumentUpload(uploadFor.id, { fileUrl: url.trim(), fileName: uploadFor.documentType }, actor);
              toast({ title: 'Document attached' });
              setUploadFor(null);
            } catch (error) {
              toast({
                title: 'Could not attach',
                description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
                variant: 'destructive',
              });
            }
          }}
        />

        <ReasonDialog
          open={Boolean(verifyFor)}
          title={verifyFor ? `${verifyFor.document.documentType} — ${verifyFor.status.replace(/_/g, ' ').toLowerCase()}` : ''}
          reasonLabel="Remarks to the candidate"
          placeholder="e.g. Relieving letter is unclear; please upload a readable copy."
          confirmLabel="Save"
          destructive={verifyFor?.status === 'REJECTED'}
          onClose={() => setVerifyFor(null)}
          onConfirm={async remarks => {
            if (!actor || !verifyFor) return;
            try {
              await verifyDocument(
                verifyFor.document.id,
                { status: verifyFor.status as 'REJECTED' | 'REUPLOAD_REQUIRED' | 'WAIVED', remarks },
                actor,
              );
              toast({ title: 'Document updated' });
              setVerifyFor(null);
            } catch (error) {
              toast({
                title: 'Could not update',
                description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
                variant: 'destructive',
              });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Confirm joining → create the employee (spec sections 35, 36)
 * ---------------------------------------------------------------------------------------------- */

function ConfirmJoiningDialog({
  record,
  candidate,
  onClose,
}: {
  record: JoiningRecord | null;
  candidate: Candidate | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: documents } = useHrCollection<PreJoiningDocument>(HR_COLLECTIONS.preJoining);
  const [actualJoiningDate, setActualJoiningDate] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [pan, setPan] = useState('');
  const [uan, setUan] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const summary = useMemo(
    () =>
      summarizeDocumentChecklist(
        documents
          .filter(document => document.joiningRecordId === record?.id)
          .map(document => ({ status: document.status, mandatory: document.mandatory })),
      ),
    [documents, record],
  );

  if (!record) return null;

  const blocked = settings.documents.blockJoiningOnPendingDocuments && !summary.readyForJoining;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await confirmJoining(
        record.id,
        {
          actualJoiningDate: actualJoiningDate || record.revisedJoiningDate || record.plannedJoiningDate,
          employeeCode: employeeCode.trim() || undefined,
          employeeExtras: {
            ...(bankAccount ? { bankAccountNumber: bankAccount } : {}),
            ...(ifsc ? { bankIfsc: ifsc } : {}),
            ...(pan ? { pan } : {}),
            ...(uan ? { uan } : {}),
            ...(address ? { address } : {}),
          },
        },
        actor,
      );
      toast({
        title: 'Employee created',
        description: `${record.candidateName} joined as ${result.employeeCode}. Payroll and attendance can now be activated.`,
      });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not confirm the joining',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Confirm joining — {record.candidateName}</DialogTitle>
          <DialogDescription>
            This creates the employee record and allocates the employee code.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {blocked ? (
            <HrAlertNotice tone="rose" title="Documents outstanding">
              {summary.mandatoryPending} mandatory {summary.mandatoryPending === 1 ? 'document is' : 'documents are'} not yet
              verified, and this organisation blocks joining until they are. Verify or waive them first.
            </HrAlertNotice>
          ) : (
            !summary.readyForJoining && (
              <HrAlertNotice tone="amber" title="Documents outstanding">
                {summary.mandatoryPending} mandatory {summary.mandatoryPending === 1 ? 'document is' : 'documents are'} still
                pending. You can proceed, but they will remain outstanding against the employee.
              </HrAlertNotice>
            )
          )}

          {/* What will be carried into the employee master (spec section 35). */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Carried into the employee master</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <HrField label="Name">{record.candidateName}</HrField>
              <HrField label="Designation">{record.designation}</HrField>
              <HrField label="Grade">{record.grade || '—'}</HrField>
              <HrField label="Department">{record.departmentName || '—'}</HrField>
              <HrField label="Project">{record.projectName || '—'}</HrField>
              <HrField label="Location">{record.location || '—'}</HrField>
              <HrField label="Reporting to">{record.reportingToName || '—'}</HrField>
              <HrField label="CTC">
                <SensitiveMoney value={record.ctc} canView={permissions.canViewSalary} />
              </HrField>
              <HrField label="Mobile">{candidate?.mobile || '—'}</HrField>
              <HrField label="Email">{candidate?.email || '—'}</HrField>
              <HrField label="Date of birth">{candidate?.dateOfBirth || '—'}</HrField>
              <HrField label="Requirement">{record.requirementNumber || '—'}</HrField>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Actual joining date *</Label>
              <Input
                type="date"
                value={actualJoiningDate || record.revisedJoiningDate || record.plannedJoiningDate}
                onChange={event => setActualJoiningDate(event.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Employee code</Label>
              <Input
                value={employeeCode}
                onChange={event => setEmployeeCode(event.target.value)}
                placeholder={`Auto — ${settings.general.employeeCodePrefix}${settings.general.employeeCodeStart}`}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Leave blank to allocate the next code automatically.</p>
            </div>
          </div>

          {/* The gaps the candidate master cannot fill (spec section 35). */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Missing employee information</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Bank account number</Label>
                <Input value={bankAccount} onChange={event => setBankAccount(event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">IFSC</Label>
                <Input value={ifsc} onChange={event => setIfsc(event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">PAN</Label>
                <Input
                  value={pan}
                  onChange={event => setPan(event.target.value.toUpperCase())}
                  placeholder={candidate?.pan || 'ABCDE1234F'}
                />
              </div>
              <div>
                <Label className="text-xs">UAN</Label>
                <Input value={uan} onChange={event => setUan(event.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Address</Label>
                <Textarea rows={2} value={address} onChange={event => setAddress(event.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || blocked} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirm &amp; create employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
