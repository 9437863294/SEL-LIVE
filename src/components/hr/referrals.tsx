'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Handshake, Loader2, Plus } from 'lucide-react';
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
  summarizeRequirementFill,
  type EmployeeReferral,
  type HrRequirement,
} from '@/lib/hr-requirement';
import { HrControlError, submitReferral } from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  HrSection,
  HrStatusBadge,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useEmployees, useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Employee referrals, spec section 46.
 *
 * Open to every employee who can see the module, which is why the nav exposes it without a
 * permission check: the whole point of a referral scheme is that people outside HR use it. What an
 * ordinary employee sees is the eligible openings and the referral form; the register of everyone
 * else's referrals needs the Referrals view permission.
 */

export default function Referrals() {
  const { settings, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { employees } = useEmployees(true);
  const { rows: referrals, loading } = useHrCollection<EmployeeReferral>(HR_COLLECTIONS.referrals);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [referOpen, setReferOpen] = useState(false);
  const [preselected, setPreselected] = useState<HrRequirement | null>(null);

  const canSeeAll = permissions.can('View', 'Referrals');

  /** Openings an employee may refer against — recruiting, with seats left (spec section 46). */
  const openings = useMemo(
    () =>
      requirements
        .filter(requirement => isRecruitingStatus(requirement.status))
        .map(requirement => ({
          requirement,
          fill: summarizeRequirementFill({
            requestedQuantity: requirement.requestedQuantity,
            joinedCount: requirement.joinedCount,
            offerAcceptedCount: requirement.offerAcceptedCount,
            cancelledPositions: requirement.cancelledPositions,
          }),
        }))
        .filter(entry => entry.fill.uncoveredBalance > 0)
        .sort((a, b) => (a.requirement.priority === 'Critical' ? -1 : 0) - (b.requirement.priority === 'Critical' ? -1 : 0)),
    [requirements],
  );

  const visible = useMemo(
    () =>
      referrals
        .filter(referral => (canSeeAll ? true : referral.referredByUserId === actor?.userId))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [referrals, canSeeAll, actor],
  );

  const columns: Array<HrListColumn<EmployeeReferral>> = [
    { header: 'Referral', mobile: 'title', cell: row => row.referralNumber },
    { header: 'Candidate', mobile: 'title', cell: row => row.candidateName },
    { header: 'Mobile', cell: row => row.candidateMobile },
    { header: 'Referred by', className: 'hidden lg:table-cell', cell: row => row.referredByEmployeeName },
    { header: 'Relationship', className: 'hidden xl:table-cell', cell: row => row.relationship || '—' },
    {
      header: 'Requirement',
      className: 'hidden lg:table-cell',
      cell: row =>
        row.requirementId ? (
          <Link href={`/hr/requirements/${row.requirementId}`} className="text-xs text-indigo-700 hover:underline">
            {row.requirementNumber || 'Requirement'}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">General</span>
        ),
    },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
    {
      header: 'Reward',
      align: 'right',
      className: 'hidden xl:table-cell',
      cell: row => (row.rewardAmount ? `₹${row.rewardAmount.toLocaleString('en-IN')}` : '—'),
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading referrals…" />;

  if (!settings.referrals.enabled) {
    return (
      <div>
        <HrPageHeader title="Employee Referrals" />
        <HrAlertNotice tone="blue" title="Referrals are switched off">
          Employee referrals are disabled for this organisation. An administrator can enable them in HR
          settings.
        </HrAlertNotice>
      </div>
    );
  }

  return (
    <div>
      <HrPageHeader
        title="Employee Referrals"
        description={
          canSeeAll
            ? `${visible.length} ${visible.length === 1 ? 'referral' : 'referrals'}`
            : 'Refer someone you would work with, and follow how it goes.'
        }
        actions={
          <Button
            className="gap-2"
            onClick={() => {
              setPreselected(null);
              setReferOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Refer a candidate
          </Button>
        }
      />

      {settings.referrals.rewardAmount > 0 && (
        <div className="mb-4">
          <HrAlertNotice tone="emerald" title="Referral reward">
            ₹{settings.referrals.rewardAmount.toLocaleString('en-IN')} is payable once your referral has
            completed {settings.referrals.rewardAfterDays} days with the company.
          </HrAlertNotice>
        </div>
      )}

      {/* Eligible openings — what an employee actually came here for. */}
      <HrSection title="Open positions you can refer for" description={`${openings.length} ${openings.length === 1 ? 'opening' : 'openings'} with seats remaining.`} className="mb-4">
        {openings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No openings are recruiting right now.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {openings.map(({ requirement, fill }) => (
              <div key={requirement.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-800">{requirement.designation}</p>
                    {requirement.priority === 'Critical' && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">Critical</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {requirement.departmentName}
                    {requirement.projectName ? ` · ${requirement.projectName}` : ''}
                    {requirement.location ? ` · ${requirement.location}` : ''}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {fill.uncoveredBalance} {fill.uncoveredBalance === 1 ? 'opening' : 'openings'} ·{' '}
                    {requirement.minExperienceYears}
                    {requirement.maxExperienceYears ? `–${requirement.maxExperienceYears}` : '+'} years
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setPreselected(requirement);
                    setReferOpen(true);
                  }}
                >
                  Refer
                </Button>
              </div>
            ))}
          </div>
        )}
      </HrSection>

      <HrSection title={canSeeAll ? 'All referrals' : 'My referrals'}>
        <HrDataList
          rows={visible}
          columns={columns}
          empty={
            <HrEmptyState
              icon={Handshake}
              title="No referrals yet"
              description="Refer someone from your network and HR will pick it up from here."
            />
          }
        />
      </HrSection>

      <ReferDialog
        open={referOpen}
        requirement={preselected}
        employees={employees}
        onClose={() => {
          setReferOpen(false);
          setPreselected(null);
        }}
      />
    </div>
  );
}

function ReferDialog({
  open,
  requirement,
  employees,
  onClose,
}: {
  open: boolean;
  requirement: HrRequirement | null;
  employees: Array<{ id: string; name: string; employeeNo?: string; employeeId?: string }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [employeeId, setEmployeeId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [candidateMobile, setCandidateMobile] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [resumeUrl, setResumeUrl] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    const employee = employees.find(row => row.id === employeeId);
    setSaving(true);
    try {
      await submitReferral(
        {
          requirementId: requirement?.id,
          requirementNumber: requirement?.requirementNumber,
          referredByEmployeeId: employeeId || actor.userId,
          referredByEmployeeName: employee?.name || actor.userName,
          candidateName,
          candidateMobile,
          candidateEmail,
          relationship,
          resumeUrl,
          remarks,
        },
        actor,
      );
      toast({ title: 'Referral submitted', description: 'HR will review it and get in touch with the candidate.' });
      setCandidateName('');
      setCandidateMobile('');
      setCandidateEmail('');
      setResumeUrl('');
      setRemarks('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not submit the referral',
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
          <DialogTitle>Refer a candidate</DialogTitle>
          <DialogDescription>
            {requirement ? `${requirement.designation} · ${requirement.requirementNumber}` : 'A general referral, not tied to one opening.'}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Referring employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select your employee record" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {employees.map(row => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                    {row.employeeNo || row.employeeId ? ` · ${row.employeeNo || row.employeeId}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Needed so the referral reward can be linked to payroll later.
            </p>
          </div>
          <div>
            <Label className="text-xs">Candidate name *</Label>
            <Input value={candidateName} onChange={event => setCandidateName(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Candidate mobile *</Label>
            <Input value={candidateMobile} onChange={event => setCandidateMobile(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Candidate email</Label>
            <Input type="email" value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">How you know them</Label>
            <Input value={relationship} onChange={event => setRelationship(event.target.value)} placeholder="e.g. former colleague" />
          </div>
          <div>
            <Label className="text-xs">Resume URL</Label>
            <Input value={resumeUrl} onChange={event => setResumeUrl(event.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea rows={3} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Why you think they would be a good fit" />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !candidateName.trim() || !candidateMobile.trim()} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Submit referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
