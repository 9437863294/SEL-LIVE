'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  isRecruitingStatus,
  matchTalentPool,
  type Candidate,
  type HrRequirement,
  type TalentPoolEntry,
} from '@/lib/hr-requirement';
import { HrControlError, addToTalentPool, createApplication } from '@/lib/hr-requirement-service';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrLoader,
  HrPageHeader,
  HrSection,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The talent pool of spec section 48 — good candidates who were not hired, kept findable.
 *
 * The screen's real value is the matching panel: pick an open requirement and it scores the pool
 * against that requirement's skills, designation, experience band and location, and offers to add the
 * best matches straight into the pipeline. That is what turns "we interviewed someone suitable eight
 * months ago" from a memory into a shortlist.
 */

export default function TalentPool() {
  const { toast } = useToast();
  const { settings, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: pool, loading } = useHrCollection<TalentPoolEntry>(HR_COLLECTIONS.talentPool);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [matchAgainst, setMatchAgainst] = useState('none');
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = useMemo(() => pool.filter(entry => entry.active !== false), [pool]);

  const categories = useMemo(() => {
    const set = new Set(active.map(entry => entry.category).filter(Boolean));
    settings.masters.talentPoolCategories.forEach(value => set.add(value));
    return Array.from(set).sort();
  }, [active, settings.masters.talentPoolCategories]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return active
      .filter(entry => (category === 'all' ? true : entry.category === category))
      .filter(entry =>
        term
          ? [entry.candidateName, entry.designation, entry.location, ...(entry.skills || [])]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)
          : true,
      )
      .sort((a, b) => (b.addedAt?.toMillis?.() || 0) - (a.addedAt?.toMillis?.() || 0));
  }, [active, category, search]);

  const openRequirements = useMemo(
    () => requirements.filter(requirement => isRecruitingStatus(requirement.status)),
    [requirements],
  );

  const targetRequirement = openRequirements.find(row => row.id === matchAgainst) || null;

  const matches = useMemo(() => {
    if (!targetRequirement) return [];
    return matchTalentPool(
      {
        designation: targetRequirement.designation,
        mandatorySkills: targetRequirement.skills?.mandatorySkills?.length
          ? targetRequirement.skills.mandatorySkills
          : targetRequirement.skills?.primarySkills,
        preferredSkills: targetRequirement.skills?.preferredSkills,
        minExperienceYears: targetRequirement.minExperienceYears,
        maxExperienceYears: targetRequirement.maxExperienceYears,
        locationId: targetRequirement.locationId,
        location: targetRequirement.location,
      },
      active,
      { limit: 20 },
    );
  }, [targetRequirement, active]);

  const addToPipeline = async (candidateId: string, candidateName: string) => {
    if (!actor || !targetRequirement) return;
    setBusyId(candidateId);
    try {
      await createApplication({ requirementId: targetRequirement.id, candidateId, source: 'Talent Pool' }, actor);
      toast({ title: 'Added to the pipeline', description: `${candidateName} → ${targetRequirement.requirementNumber}` });
    } catch (error) {
      toast({
        title: 'Could not add',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Array<HrListColumn<TalentPoolEntry>> = [
    {
      header: 'Candidate',
      mobile: 'title',
      cell: row => (
        <Link href={`/hr/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
          {row.candidateName}
        </Link>
      ),
    },
    { header: 'Category', mobile: 'aside', cell: row => <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-800">{row.category}</Badge> },
    { header: 'Designation', cell: row => row.designation || '—' },
    {
      header: 'Experience',
      align: 'right',
      cell: row => (row.totalExperienceYears ? `${row.totalExperienceYears} yrs` : '—'),
    },
    { header: 'Location', className: 'hidden lg:table-cell', cell: row => row.location || '—' },
    {
      header: 'Skills',
      className: 'hidden xl:table-cell',
      cell: row => (
        <div className="flex flex-wrap gap-1">
          {(row.skills || []).slice(0, 4).map(skill => (
            <Badge key={skill} variant="secondary" className="text-[10px]">{skill}</Badge>
          ))}
          {(row.skills || []).length > 4 && <span className="text-[10px] text-muted-foreground">+{(row.skills || []).length - 4}</span>}
        </div>
      ),
    },
    { header: 'Why in the pool', className: 'hidden lg:table-cell', cell: row => row.addedReason || '—' },
    { header: 'Added', cell: row => row.addedAt?.toDate?.().toLocaleDateString('en-IN') || '—' },
  ];

  if (loading || configLoading) return <HrLoader label="Loading the talent pool…" />;

  return (
    <div>
      <HrPageHeader
        title="Talent Pool"
        description={`${filtered.length} of ${active.length} candidates kept for future requirements`}
        actions={
          <>
            {permissions.can('Export', 'Talent Pool') && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  exportRowsToExcel(
                    'Talent Pool',
                    filtered.map(row => ({
                      Candidate: row.candidateName,
                      Category: row.category,
                      Designation: row.designation || '',
                      Experience: row.totalExperienceYears || '',
                      Location: row.location || '',
                      Skills: (row.skills || []).join(', '),
                      Reason: row.addedReason || '',
                      Added: row.addedAt?.toDate?.().toLocaleDateString('en-IN') || '',
                    })),
                  )
                }
              >
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            {permissions.can('Add', 'Talent Pool') && (
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add to pool
              </Button>
            )}
          </>
        }
      />

      {/* The matching panel — the reason this screen exists (spec section 48). */}
      <HrSection
        title="Match against an open requirement"
        description="Scored on skills, designation, experience band and location."
        className="mb-4"
      >
        <div className="sm:w-96">
          <Label className="text-xs">Requirement</Label>
          <Select value={matchAgainst} onValueChange={setMatchAgainst}>
            <SelectTrigger><SelectValue placeholder="Select an open requirement" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="none">None selected</SelectItem>
              {openRequirements.map(requirement => (
                <SelectItem key={requirement.id} value={requirement.id}>
                  {requirement.requirementNumber} · {requirement.designation}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {targetRequirement && (
          <div className="mt-3">
            {matches.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No pool candidates score highly enough against {targetRequirement.designation}.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm font-medium text-slate-700">
                  {matches.length} previously shortlisted {matches.length === 1 ? 'candidate matches' : 'candidates match'} this
                  requirement.
                </p>
                <div className="space-y-2">
                  {matches.map(match => (
                    <div
                      key={match.candidate.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/hr/candidates/${match.candidate.candidateId}`}
                            className="truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline"
                          >
                            {match.candidate.candidateName}
                          </Link>
                          <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-[10px] text-cyan-700">
                            {match.score}% match
                          </Badge>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {match.reasons.join(' · ') || match.candidate.category}
                        </p>
                      </div>
                      {permissions.can('Add Candidate', 'Pipeline') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={busyId === match.candidate.candidateId}
                          onClick={() => addToPipeline(match.candidate.candidateId, match.candidate.candidateName)}
                        >
                          {busyId === match.candidate.candidateId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                          Add to pipeline
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </HrSection>

      <HrFilterCard summary={`${filtered.length} candidates`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, designation, skill, location" className="pl-8" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </HrFilterCard>

      <HrDataList
        rows={filtered}
        columns={columns}
        cardHref={row => `/hr/candidates/${row.candidateId}`}
        empty={
          <HrEmptyState
            icon={Sparkles}
            title="The talent pool is empty"
            description="Candidates moved to the talent pool from a pipeline land here, and can be added to a future requirement in one click."
          />
        }
      />

      <AddToPoolDialog open={addOpen} onOpenChange={setAddOpen} candidates={candidates} categories={categories} />
    </div>
  );
}

function AddToPoolDialog({
  open,
  onOpenChange,
  candidates,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: Candidate[];
  categories: string[];
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [candidateId, setCandidateId] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates
      .filter(row => !row.doNotHire)
      .filter(row => (term ? [row.name, row.mobile, row.currentDesignation].filter(Boolean).join(' ').toLowerCase().includes(term) : true))
      .slice(0, 50);
  }, [candidates, search]);

  const submit = async () => {
    if (!actor) return;
    const candidate = candidates.find(row => row.id === candidateId);
    if (!candidate) return;
    setSaving(true);
    try {
      await addToTalentPool({ candidateId, candidateName: candidate.name, category, reason }, actor);
      toast({ title: 'Added to the talent pool' });
      setCandidateId('');
      setReason('');
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Could not add',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Add to the talent pool</DialogTitle>
          <DialogDescription>Spec section 48 — keep a good candidate findable for the next requirement.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Search candidates</Label>
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, mobile, designation" />
          </div>
          <div>
            <Label className="text-xs">Candidate *</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {available.map(row => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                    {row.currentDesignation ? ` · ${row.currentDesignation}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {categories.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Why they are worth keeping</Label>
            <Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Strong 220KV substation background; role went to a stronger candidate." />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !candidateId || !category} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
