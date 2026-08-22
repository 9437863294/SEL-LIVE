'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Ban, Download, Loader2, Plus, Search, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  RECRUITMENT_SOURCES,
  findDuplicateCandidates,
  type Candidate,
  type CandidateApplication,
  type RecruitmentSourceKind,
} from '@/lib/hr-requirement';
import { HrControlError, createCandidate, setCandidateDoNotHire } from '@/lib/hr-requirement-service';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrLoader,
  HrPageHeader,
  SensitiveMoney,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The candidate database of spec section 19 — one profile per person, never one per application.
 *
 * The add dialog runs section 20's duplicate detection as the recruiter types, and offers the
 * existing profile rather than blocking: an exact mobile or email match almost always means the same
 * person applying again, and reusing the profile is what preserves their interview history and
 * previous rejection reason (control rule 63.8). A name + DOB match is shown as *probable* and never
 * suppresses a new profile, because namesakes are common and silently merging two people is the more
 * expensive mistake.
 */

export default function CandidateDatabase() {
  const { loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: candidates, loading } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);

  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [poolOnly, setPoolOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [flagFor, setFlagFor] = useState<Candidate | null>(null);

  const applicationCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const application of applications) {
      map.set(application.candidateId, (map.get(application.candidateId) || 0) + 1);
    }
    return map;
  }, [applications]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates
      .filter(candidate => (source === 'all' ? true : candidate.source === source))
      .filter(candidate => (poolOnly ? candidate.inTalentPool : true))
      .filter(candidate =>
        term
          ? [
              candidate.name,
              candidate.candidateNumber,
              candidate.mobile,
              candidate.email,
              candidate.currentCompany,
              candidate.currentDesignation,
              ...(candidate.skills || []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)
          : true,
      )
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  }, [candidates, search, source, poolOnly]);

  const columns: Array<HrListColumn<Candidate>> = [
    {
      header: 'Candidate',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <Link href={`/hr/candidates/${row.id}`} className="block truncate font-medium text-slate-800 hover:text-indigo-700 hover:underline">
            {row.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.candidateNumber}</p>
        </div>
      ),
    },
    { header: 'Mobile', cell: row => row.mobile || '—' },
    { header: 'Email', className: 'hidden xl:table-cell', cell: row => row.email || '—' },
    {
      header: 'Current role',
      className: 'hidden lg:table-cell',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.currentDesignation || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.currentCompany || ''}</p>
        </div>
      ),
    },
    {
      header: 'Experience',
      align: 'right',
      cell: row => (row.totalExperienceYears ? `${row.totalExperienceYears} yrs` : '—'),
    },
    {
      header: 'Expected CTC',
      align: 'right',
      className: 'hidden lg:table-cell',
      cell: row => <SensitiveMoney value={row.expectedCtc} canView={permissions.canViewSalary} />,
    },
    { header: 'Notice', align: 'right', className: 'hidden xl:table-cell', cell: row => (row.noticePeriodDays ? `${row.noticePeriodDays}d` : '—') },
    { header: 'Source', cell: row => row.source },
    {
      header: 'Applications',
      align: 'right',
      cell: row => <span className="tabular-nums">{applicationCounts.get(row.id) || 0}</span>,
    },
    {
      header: 'Flags',
      mobile: 'aside',
      cell: row => (
        <div className="flex flex-wrap gap-1">
          {row.inTalentPool && (
            <Badge variant="outline" className="gap-1 border-cyan-200 bg-cyan-50 text-cyan-700">
              <Sparkles className="h-3 w-3" /> Pool
            </Badge>
          )}
          {row.isInternal && (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Internal</Badge>
          )}
          {row.doNotHire && (
            <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-rose-700">
              <Ban className="h-3 w-3" /> Do not hire
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row => (
        <div className="flex gap-1.5">
          <Button asChild size="sm" variant="outline">
            <Link href={`/hr/candidates/${row.id}`}>Open</Link>
          </Button>
          {permissions.can('Set Do Not Hire', 'Candidates') && (
            <Button size="sm" variant="ghost" className={row.doNotHire ? 'text-emerald-700' : 'text-rose-700'} onClick={() => setFlagFor(row)}>
              {row.doNotHire ? 'Clear flag' : <ShieldAlert className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading candidates…" />;

  return (
    <div>
      <HrPageHeader
        title="Candidate Database"
        description={`${filtered.length} of ${candidates.length} candidates`}
        actions={
          <>
            {permissions.can('Export', 'Candidates') && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  exportRowsToExcel(
                    'Candidate Database',
                    filtered.map(row => ({
                      'Candidate ID': row.candidateNumber,
                      Name: row.name,
                      Mobile: row.mobile,
                      Email: row.email,
                      'Current Company': row.currentCompany || '',
                      'Current Designation': row.currentDesignation || '',
                      Location: row.currentLocation || '',
                      'Total Experience': row.totalExperienceYears || '',
                      'Relevant Experience': row.relevantExperienceYears || '',
                      'Notice Period (days)': row.noticePeriodDays || '',
                      Qualification: row.qualification || '',
                      Skills: (row.skills || []).join(', '),
                      Source: row.source,
                      Applications: applicationCounts.get(row.id) || 0,
                      'Talent Pool': row.inTalentPool ? 'Yes' : 'No',
                    })),
                  )
                }
              >
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            {permissions.can('Add', 'Candidates') && (
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Candidate
              </Button>
            )}
          </>
        }
      />

      <HrFilterCard summary={`${filtered.length} candidates`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Name, mobile, email, company, skill…"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">All sources</SelectItem>
                {RECRUITMENT_SOURCES.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2">
              <Checkbox checked={poolOnly} onCheckedChange={value => setPoolOnly(value === true)} />
              <span className="text-sm">Talent pool only</span>
            </label>
          </div>
        </div>
      </HrFilterCard>

      <HrDataList
        rows={filtered}
        columns={columns}
        rowClassName={row => (row.doNotHire ? 'bg-rose-50/40' : undefined)}
        empty={
          <HrEmptyState
            icon={Users}
            title="No candidates match"
            description="Add a candidate once and apply them to as many requirements as you need."
            action={
              permissions.can('Add', 'Candidates') ? (
                <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" /> Add Candidate
                </Button>
              ) : undefined
            }
          />
        }
      />

      <AddCandidateDialog open={addOpen} onOpenChange={setAddOpen} candidates={candidates} />

      <DoNotHireDialog candidate={flagFor} onClose={() => setFlagFor(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Add a candidate, with duplicate detection (spec sections 19, 20)
 * ---------------------------------------------------------------------------------------------- */

function AddCandidateDialog({
  open,
  onOpenChange,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: Candidate[];
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    dateOfBirth: '',
    currentCompany: '',
    currentDesignation: '',
    currentLocation: '',
    totalExperienceYears: '',
    relevantExperienceYears: '',
    currentCtc: '',
    expectedCtc: '',
    noticePeriodDays: '',
    qualification: '',
    specialization: '',
    skills: '',
    resumeUrl: '',
    source: 'Direct Application' as RecruitmentSourceKind,
    sourceDetail: '',
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(prev => ({ ...prev, [key]: value }));

  /** Runs as the recruiter types, so the warning arrives before the profile is created. */
  const duplicates = useMemo(
    () =>
      findDuplicateCandidates(
        { name: form.name, mobile: form.mobile, email: form.email, dateOfBirth: form.dateOfBirth },
        candidates,
      ),
    [form.name, form.mobile, form.email, form.dateOfBirth, candidates],
  );

  const exactDuplicate = duplicates.find(match => match.confidence === 'exact');

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await createCandidate(
        {
          name: form.name.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          dateOfBirth: form.dateOfBirth || undefined,
          currentCompany: form.currentCompany || undefined,
          currentDesignation: form.currentDesignation || undefined,
          currentLocation: form.currentLocation || undefined,
          totalExperienceYears: Number(form.totalExperienceYears) || undefined,
          relevantExperienceYears: Number(form.relevantExperienceYears) || undefined,
          currentCtc: Number(form.currentCtc) || undefined,
          expectedCtc: Number(form.expectedCtc) || undefined,
          noticePeriodDays: Number(form.noticePeriodDays) || undefined,
          qualification: form.qualification || undefined,
          specialization: form.specialization || undefined,
          skills: form.skills
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean),
          resumeUrl: form.resumeUrl || undefined,
          source: form.source,
          sourceDetail: form.sourceDetail || undefined,
        } as never,
        actor,
      );
      toast({ title: 'Candidate added', description: result.candidateNumber });
      setForm(prev => ({ ...prev, name: '', mobile: '', email: '', dateOfBirth: '', skills: '', resumeUrl: '' }));
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Could not add the candidate',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>One profile per person — they can then apply to any requirement.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {duplicates.length > 0 && (
            <HrAlertNotice tone={exactDuplicate ? 'rose' : 'amber'} title={exactDuplicate ? 'Candidate already exists' : 'Possible match'}>
              <div className="space-y-1">
                {duplicates.slice(0, 3).map(match => (
                  <p key={match.candidate.id}>
                    <Link href={`/hr/candidates/${match.candidate.id}`} className="font-semibold underline">
                      {match.candidate.name}
                    </Link>{' '}
                    — matched on {match.matchedOn.join(', ')}
                    {match.candidate.lastRejectionReason ? ` · previously rejected: ${match.candidate.lastRejectionReason}` : ''}
                  </p>
                ))}
                <p className="pt-1 text-[11px]">
                  {exactDuplicate
                    ? 'Use the existing profile so their interview history is not lost.'
                    : 'A shared name and date of birth may be a different person — check before adding.'}
                </p>
              </div>
            </HrAlertNotice>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={event => set('name', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Mobile *</Label>
              <Input value={form.mobile} onChange={event => set('mobile', event.target.value)} placeholder="10 digits" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={event => set('email', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Date of birth</Label>
              <Input type="date" value={form.dateOfBirth} onChange={event => set('dateOfBirth', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Current company</Label>
              <Input value={form.currentCompany} onChange={event => set('currentCompany', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Current designation</Label>
              <Input value={form.currentDesignation} onChange={event => set('currentDesignation', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Current location</Label>
              <Input value={form.currentLocation} onChange={event => set('currentLocation', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Source *</Label>
              <Select value={form.source} onValueChange={value => set('source', value as RecruitmentSourceKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {RECRUITMENT_SOURCES.map(value => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Total experience (years)</Label>
              <Input type="number" inputMode="decimal" value={form.totalExperienceYears} onChange={event => set('totalExperienceYears', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Relevant experience (years)</Label>
              <Input type="number" inputMode="decimal" value={form.relevantExperienceYears} onChange={event => set('relevantExperienceYears', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Current CTC</Label>
              <Input type="number" inputMode="decimal" value={form.currentCtc} onChange={event => set('currentCtc', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Expected CTC</Label>
              <Input type="number" inputMode="decimal" value={form.expectedCtc} onChange={event => set('expectedCtc', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notice period (days)</Label>
              <Input type="number" inputMode="decimal" value={form.noticePeriodDays} onChange={event => set('noticePeriodDays', event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Qualification</Label>
              <Input value={form.qualification} onChange={event => set('qualification', event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Skills (comma separated)</Label>
              <Textarea rows={2} value={form.skills} onChange={event => set('skills', event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Resume URL</Label>
              <Input value={form.resumeUrl} onChange={event => set('resumeUrl', event.target.value)} placeholder="https://…" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Source detail</Label>
              <Input
                value={form.sourceDetail}
                onChange={event => set('sourceDetail', event.target.value)}
                placeholder="Agency name, portal, referrer…"
              />
            </div>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.name.trim() || (!form.mobile.trim() && !form.email.trim())} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add candidate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DoNotHireDialog({ candidate, onClose }: { candidate: Candidate | null; onClose: () => void }) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!candidate) return null;
  const clearing = Boolean(candidate.doNotHire);

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await setCandidateDoNotHire(candidate.id, { doNotHire: !clearing, reason }, actor);
      toast({ title: clearing ? 'Flag removed' : 'Candidate flagged' });
      setReason('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not update',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{clearing ? 'Remove the do-not-hire flag' : 'Mark do not hire'}</DialogTitle>
          <DialogDescription>{candidate.name}</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {clearing && candidate.doNotHireReason && (
            <HrAlertNotice tone="amber" title="Current reason">
              {candidate.doNotHireReason}
            </HrAlertNotice>
          )}
          <div>
            <Label className="text-xs">Reason *</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={clearing ? 'Why the flag no longer applies' : 'The specific, documented reason'}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recorded against your name in the activity log. A flag with no stated reason is not
              defensible if it is ever questioned.
            </p>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={clearing ? 'default' : 'destructive'} onClick={submit} disabled={saving || !reason.trim()} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {clearing ? 'Remove flag' : 'Mark do not hire'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
