'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Clock, Copy, FileSignature, Loader2, Send, ThumbsDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  canReleaseOffer,
  evaluateOfferValidity,
  hrCurrency,
  type Candidate,
  type HrOffer,
  type HrRequirement,
  type SelectionProposal,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  acceptOffer,
  approveOffer,
  createOffer,
  rejectOffer,
  sendOffer,
  withdrawOffer,
} from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrLoader,
  HrPageHeader,
  HrStatusBadge,
  SensitiveMoney,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { ReasonDialog } from './interview-panel';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Offer management, spec sections 29 and 30.
 *
 * The offer's statuses drive which actions exist, so nothing here needs to ask whether a step has
 * already happened: a DRAFT offer can be approved, an APPROVED one sent, a SENT one responded to.
 * `canReleaseOffer` is consulted before the create dialog will submit — the same check the service
 * runs — so a recruiter is told about a compensation breach while they are typing rather than after
 * they have written the letter (control rule 63.5).
 *
 * Recording an acceptance here is HR entering what the candidate told them, which is why it captures
 * a declaration. The candidate's own portal (section 30) posts to the same `acceptOffer`, so a
 * verbal acceptance and a portal acceptance produce the same joining record and checklist.
 */

export default function OfferPanel({
  requirementId,
  preselectProposalId,
  embedded = false,
}: {
  requirementId?: string;
  preselectProposalId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: offers, loading } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: proposals } = useHrCollection<SelectionProposal>(HR_COLLECTIONS.selectionProposals);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [createFor, setCreateFor] = useState<SelectionProposal | null>(
    preselectProposalId ? proposals.find(row => row.id === preselectProposalId) || null : null,
  );
  const [acceptFor, setAcceptFor] = useState<HrOffer | null>(null);
  const [rejectFor, setRejectFor] = useState<HrOffer | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<HrOffer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      offers
        .filter(offer => (requirementId ? offer.requirementId === requirementId : true))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [offers, requirementId],
  );

  /** Approved proposals with no offer yet — the actual next action on this screen. */
  const awaitingOffer = useMemo(() => {
    const withOffer = new Set(offers.map(offer => offer.selectionProposalId).filter(Boolean));
    return proposals
      .filter(proposal => (requirementId ? proposal.requirementId === requirementId : true))
      .filter(proposal => proposal.status === 'APPROVED' && !withOffer.has(proposal.id));
  }, [proposals, offers, requirementId]);

  const run = async (offerId: string, work: () => Promise<unknown>, success: string) => {
    setBusyId(offerId);
    try {
      await work();
      toast({ title: success });
    } catch (error) {
      toast({
        title: 'Action failed',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Array<HrListColumn<HrOffer>> = [
    { header: 'Offer', mobile: 'title', cell: row => <span className="font-medium text-slate-800">{row.offerNumber}</span> },
    {
      header: 'Candidate',
      mobile: 'title',
      cell: row => (
        <Link href={`/hr/candidates/${row.candidateId}`} className="text-slate-800 hover:text-indigo-700 hover:underline">
          {row.candidateName}
        </Link>
      ),
    },
    {
      header: 'Requirement',
      className: requirementId ? 'hidden' : 'hidden lg:table-cell',
      cell: row => (
        <Link href={`/hr/requirements/${row.requirementId}`} className="text-xs text-muted-foreground hover:underline">
          {row.requirementNumber}
        </Link>
      ),
    },
    { header: 'Designation', className: 'hidden xl:table-cell', cell: row => row.designation },
    {
      header: 'CTC',
      align: 'right',
      cell: row => <SensitiveMoney value={row.offeredCtc} canView={permissions.canViewSalary} />,
    },
    { header: 'Joining', cell: row => row.joiningDate || '—' },
    {
      header: 'Validity',
      className: 'hidden lg:table-cell',
      cell: row => {
        const validity = evaluateOfferValidity({ status: row.status, validUntil: row.validUntil });
        if (validity.daysRemaining === null) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className={validity.expired ? 'text-xs font-medium text-rose-700' : 'text-xs text-muted-foreground'}>
            <Clock className="mr-1 inline h-3 w-3" />
            {validity.expired ? 'Expired' : `${validity.daysRemaining}d left`}
          </span>
        );
      },
    },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row => {
        if (busyId === row.id) return <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />;

        const actions: React.ReactNode[] = [];

        if (row.status === 'PENDING_APPROVAL' && permissions.can('Approve', 'Offers')) {
          actions.push(
            <Button key="approve" size="sm" className="gap-1" onClick={() => run(row.id, () => approveOffer(row.id, actor!), 'Offer approved')}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>,
          );
        }
        if (row.status === 'APPROVED' && permissions.can('Send', 'Offers')) {
          actions.push(
            <Button key="send" size="sm" className="gap-1" onClick={() => run(row.id, () => sendOffer(row.id, actor!), 'Offer sent to the candidate')}>
              <Send className="h-3.5 w-3.5" /> Send
            </Button>,
          );
        }
        if (['SENT', 'VIEWED'].includes(row.status) && permissions.can('Record Response', 'Offers')) {
          actions.push(
            <Button key="accept" size="sm" className="gap-1" onClick={() => setAcceptFor(row)}>
              <Check className="h-3.5 w-3.5" /> Accepted
            </Button>,
            <Button key="reject" size="sm" variant="outline" className="gap-1 text-rose-700" onClick={() => setRejectFor(row)}>
              <ThumbsDown className="h-3.5 w-3.5" /> Declined
            </Button>,
          );
        }
        if (!['ACCEPTED', 'WITHDRAWN', 'REJECTED', 'EXPIRED'].includes(row.status) && permissions.can('Withdraw', 'Offers')) {
          actions.push(
            <Button key="withdraw" size="sm" variant="ghost" className="text-rose-700" onClick={() => setWithdrawFor(row)}>
              <X className="h-3.5 w-3.5" />
            </Button>,
          );
        }
        if (row.status === 'SENT' && row.portalToken) {
          actions.push(
            <Button
              key="link"
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={() => {
                const url = `${window.location.origin}/offer/${row.portalToken}`;
                void navigator.clipboard?.writeText(url);
                toast({ title: 'Candidate link copied', description: url });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>,
          );
        }

        return actions.length ? <div className="flex flex-wrap gap-1.5">{actions}</div> : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading offers…" />;

  return (
    <div>
      {!embedded && (
        <HrPageHeader
          title="Offer Management"
          description={`${scoped.length} ${scoped.length === 1 ? 'offer' : 'offers'}${
            awaitingOffer.length ? ` · ${awaitingOffer.length} approved ${awaitingOffer.length === 1 ? 'selection' : 'selections'} awaiting an offer` : ''
          }`}
        />
      )}

      {permissions.can('Add', 'Offers') && awaitingOffer.length > 0 && (
        <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-800">Ready for an offer</p>
          <div className="flex flex-wrap gap-2">
            {awaitingOffer.slice(0, 8).map(proposal => (
              <Button key={proposal.id} size="sm" variant="outline" className="gap-1.5 bg-white" onClick={() => setCreateFor(proposal)}>
                <FileSignature className="h-3.5 w-3.5" /> {proposal.candidateName}
                {permissions.canViewSalary && (
                  <span className="text-[10px] text-muted-foreground">{hrCurrency(proposal.approvedCtc || proposal.proposedCtc)}</span>
                )}
              </Button>
            ))}
          </div>
        </div>
      )}

      <HrDataList
        rows={scoped}
        columns={columns}
        empty={
          <HrEmptyState
            icon={FileSignature}
            title="No offers yet"
            description="An offer becomes available once a selection proposal is approved and any compensation approval has cleared."
          />
        }
      />

      <CreateOfferDialog
        proposal={createFor}
        requirement={requirements.find(row => row.id === createFor?.requirementId) || null}
        candidate={candidates.find(row => row.id === createFor?.candidateId) || null}
        onClose={() => setCreateFor(null)}
      />

      <AcceptOfferDialog offer={acceptFor} onClose={() => setAcceptFor(null)} />

      <ReasonDialog
        open={Boolean(rejectFor)}
        title="Candidate declined the offer"
        description={rejectFor ? `${rejectFor.candidateName} · ${rejectFor.offerNumber}` : ''}
        reasonLabel="Reason given by the candidate"
        placeholder="e.g. counter-offer from current employer"
        confirmLabel="Record decline"
        destructive
        onClose={() => setRejectFor(null)}
        onConfirm={async reason => {
          if (!actor || !rejectFor) return;
          const offer = rejectFor;
          setRejectFor(null);
          await run(offer.id, () => rejectOffer(offer.id, reason, actor), 'Offer decline recorded');
        }}
      />

      <ReasonDialog
        open={Boolean(withdrawFor)}
        title="Withdraw offer"
        description={withdrawFor ? `${withdrawFor.candidateName} · ${withdrawFor.offerNumber}` : ''}
        reasonLabel="Reason for withdrawal"
        confirmLabel="Withdraw offer"
        destructive
        onClose={() => setWithdrawFor(null)}
        onConfirm={async reason => {
          if (!actor || !withdrawFor) return;
          const offer = withdrawFor;
          setWithdrawFor(null);
          await run(offer.id, () => withdrawOffer(offer.id, reason, actor), 'Offer withdrawn');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Create an offer (spec section 29)
 * ---------------------------------------------------------------------------------------------- */

function CreateOfferDialog({
  proposal,
  requirement,
  candidate,
  onClose,
}: {
  proposal: SelectionProposal | null;
  requirement: HrRequirement | null;
  candidate: Candidate | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const permissions = useHrPermissions();
  const [offeredCtc, setOfferedCtc] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [probationMonths, setProbationMonths] = useState('6');
  const [joiningBonus, setJoiningBonus] = useState('');
  const [employmentConditions, setEmploymentConditions] = useState('');
  const [saving, setSaving] = useState(false);

  const ctcValue = Number(offeredCtc) || proposal?.approvedCtc || proposal?.proposedCtc || 0;

  const gate = useMemo(
    () =>
      proposal
        ? canReleaseOffer({
            proposedCtc: ctcValue,
            approvedCtc: proposal.approvedCtc,
            bandMax: proposal.bandMax,
            compensationApprovalStatus: proposal.compensationApprovalStatus,
            tolerancePercent: settings.compensation.tolerancePercent,
          })
        : { allowed: false, reason: '' },
    [proposal, ctcValue, settings.compensation.tolerancePercent],
  );

  const submit = async () => {
    if (!actor || !proposal) return;
    setSaving(true);
    try {
      const result = await createOffer(
        {
          selectionProposalId: proposal.id,
          offeredCtc: ctcValue,
          joiningDate: joiningDate || proposal.proposedJoiningDate || '',
          validUntil: validUntil || undefined,
          probationMonths: Number(probationMonths) || undefined,
          joiningBonus: Number(joiningBonus) || undefined,
          employmentConditions,
        },
        actor,
      );
      toast({
        title: 'Offer created',
        description:
          result.status === 'PENDING_APPROVAL'
            ? `${result.offerNumber} is awaiting approval before it can be sent.`
            : `${result.offerNumber} is approved and ready to send.`,
      });
      setOfferedCtc('');
      setJoiningDate('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not create the offer',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!proposal) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Offer — {proposal.candidateName}</DialogTitle>
          <DialogDescription>
            {proposal.requirementNumber} · {proposal.designation} · {proposal.grade}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-4">
            <HrField label="Approved CTC">
              <SensitiveMoney value={proposal.approvedCtc || proposal.proposedCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Compensation approval">{proposal.compensationApprovalStatus?.replace(/_/g, ' ').toLowerCase() || '—'}</HrField>
            <HrField label="Department">{proposal.departmentName || '—'}</HrField>
            <HrField label="Location">{proposal.location || requirement?.location || '—'}</HrField>
            <HrField label="Reporting to">{proposal.reportingToName || '—'}</HrField>
            <HrField label="Employment type">{requirement?.employmentType || '—'}</HrField>
            <HrField label="Candidate email">{candidate?.email || '—'}</HrField>
            <HrField label="Notice period">{proposal.noticePeriodDays ? `${proposal.noticePeriodDays} days` : '—'}</HrField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Offered CTC (annual) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={offeredCtc}
                onChange={event => setOfferedCtc(event.target.value)}
                placeholder={String(proposal.approvedCtc || proposal.proposedCtc || '')}
              />
            </div>
            <div>
              <Label className="text-xs">Joining date *</Label>
              <Input
                type="date"
                value={joiningDate || proposal.proposedJoiningDate || ''}
                onChange={event => setJoiningDate(event.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Valid until</Label>
              <Input type="date" value={validUntil} onChange={event => setValidUntil(event.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Defaults to {settings.offers.defaultValidityDays} days from today.
              </p>
            </div>
            <div>
              <Label className="text-xs">Probation (months)</Label>
              <Input type="number" inputMode="decimal" value={probationMonths} onChange={event => setProbationMonths(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Joining bonus</Label>
              <Input type="number" inputMode="decimal" value={joiningBonus} onChange={event => setJoiningBonus(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Employment conditions</Label>
              <Textarea rows={3} value={employmentConditions} onChange={event => setEmploymentConditions(event.target.value)} />
            </div>
          </div>

          {!gate.allowed && gate.reason && (
            <HrAlertNotice tone="rose" title="Cannot release this offer">
              {gate.reason}
            </HrAlertNotice>
          )}
          {settings.offers.requireOfferApproval && (
            <HrAlertNotice tone="blue" title="Approval required">
              This offer will be created as pending approval and can only be sent once approved.
            </HrAlertNotice>
          )}
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !gate.allowed || !(joiningDate || proposal.proposedJoiningDate)} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Record an acceptance (spec sections 30, 31)
 * ---------------------------------------------------------------------------------------------- */

function AcceptOfferDialog({ offer, onClose }: { offer: HrOffer | null; onClose: () => void }) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const [joiningDate, setJoiningDate] = useState('');
  const [declaration, setDeclaration] = useState('');
  const [signedOfferUrl, setSignedOfferUrl] = useState('');
  const [saving, setSaving] = useState(false);

  if (!offer) return null;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await acceptOffer(
        offer.id,
        { declaration, signedOfferUrl: signedOfferUrl || undefined, joiningDate: joiningDate || undefined },
        actor,
      );
      toast({
        title: 'Acceptance recorded',
        description: `Pre-joining checklist created with ${result.documentsCreated} documents.`,
      });
      setDeclaration('');
      setSignedOfferUrl('');
      setJoiningDate('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not record the acceptance',
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
          <DialogTitle>Offer accepted — {offer.candidateName}</DialogTitle>
          <DialogDescription>
            {offer.offerNumber} · this creates the pre-joining checklist and the joining record.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Confirmed joining date</Label>
            <Input type="date" value={joiningDate || offer.joiningDate} onChange={event => setJoiningDate(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Acceptance declaration</Label>
            <Textarea
              rows={2}
              value={declaration}
              onChange={event => setDeclaration(event.target.value)}
              placeholder="How the acceptance was received — email, signed copy, verbal confirmation"
            />
          </div>
          <div>
            <Label className="text-xs">Signed offer copy URL {settings.offers.requireSignedCopy && '*'}</Label>
            <Input value={signedOfferUrl} onChange={event => setSignedOfferUrl(event.target.value)} placeholder="https://…" />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-slate-700">What happens next</p>
            <p className="mt-1">
              A joining record is created for {joiningDate || offer.joiningDate}, the document checklist is
              generated, and the T-7 / T-3 / T-1 reminders begin.
            </p>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving || (settings.offers.requireSignedCopy && !signedOfferUrl)}
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Record acceptance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Offer count badges, used by the workspace tab headers. */
export function OfferCountBadge({ offers }: { offers: HrOffer[] }) {
  const live = offers.filter(offer => ['SENT', 'VIEWED'].includes(offer.status)).length;
  if (live === 0) return null;
  return <Badge variant="secondary" className="ml-1 tabular-nums">{live}</Badge>;
}
