'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, RefreshCw, Save, ShieldCheck, Workflow } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_RECURRING_E_APPROVAL_SETTINGS,
  DEFAULT_RECURRING_WORKFLOW,
  recurringMirrorMode,
  RP_COLLECTIONS,
  visibleObligations,
  type PaymentObligation,
  type RecurringEApprovalSettings,
  type RecurringPaymentSettings,
  type RecurringWorkflowStep,
} from '@/lib/recurring-payments';
import {
  recurringPaymentEApprovalActor,
  sweepRecurringPaymentApprovals,
} from '@/lib/recurring-payments-e-approval-service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const settingDocId = (organizationId: string) => organizationId.replace(/[^a-zA-Z0-9_-]/g, '_');

type ApprovalTypeRow = { id: string; name: string; active?: boolean };

/**
 * The switch that decides whether these two modules are connected at all.
 *
 * Off by default and reversible at any time, because that is the promise the bridge is built on:
 * Recurring Payments and E-Approval each work on their own, and mirroring is something an
 * organization turns on when it wants one file in one place rather than a coupling it inherits.
 * Turning it off stops new mirrors and leaves existing approvals exactly as they are — their trail
 * is a record of decisions that were genuinely taken, and deleting it to tidy up a setting change
 * would be the wrong call.
 */
export default function RecurringEApprovalSettingsPage() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const canEdit = can('Edit', 'Recurring Payments.Settings');

  const [settings, setSettings] = useState<RecurringEApprovalSettings>(DEFAULT_RECURRING_E_APPROVAL_SETTINGS);
  const [workflow, setWorkflow] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const [types, setTypes] = useState<ApprovalTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    const stop = onSnapshot(doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId)), (snapshot) => {
      const data = snapshot.exists() ? (snapshot.data() as Partial<RecurringPaymentSettings>) : {};
      setSettings({ ...DEFAULT_RECURRING_E_APPROVAL_SETTINGS, ...(data.eApproval || {}) });
      setLoading(false);
    }, () => setLoading(false));
    (async () => {
      const [workflowSnap, typeSnap] = await Promise.all([
        getDocs(query(collection(db, 'workflows'), where('__name__', '==', 'recurring-payments-workflow'))).catch(() => null),
        getDocs(collection(db, 'eApprovalTypes')).catch(() => null),
      ]);
      const steps = workflowSnap?.docs[0]?.data()?.steps as RecurringWorkflowStep[] | undefined;
      if (steps?.length) setWorkflow(steps);
      if (typeSnap) {
        setTypes(
          typeSnap.docs
            .map((item) => ({ id: item.id, ...(item.data() as Omit<ApprovalTypeRow, 'id'>) }))
            .filter((row) => row.active !== false),
        );
      }
    })();
    return () => stop();
  }, [organizationId]);

  const mirrored = useMemo(
    () => workflow.filter((step) => settings.scope === 'All' || recurringMirrorMode(step) === 'Decision'),
    [workflow, settings.scope],
  );

  async function save() {
    if (!canEdit) return toast({ title: 'You do not have permission to edit settings', variant: 'destructive' });
    setSaving(true);
    try {
      await setDoc(
        doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId)),
        { organizationId, eApproval: settings, updatedAt: serverTimestamp() },
        { merge: true },
      );
      toast({ title: 'E-Approval bridge saved' });
    } catch {
      toast({ title: 'Settings could not be saved', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Mirrors every open obligation that does not have an approval yet.
   *
   * The bridge cannot be driven from the nightly generation job — that runs server-side under the
   * Admin SDK, while this is a client module acting as the signed-in user — so this is how a payment
   * generated overnight, or the whole backlog on the day the bridge is switched on, gets into
   * E-Approval without waiting for somebody to open each one.
   */
  async function sweep() {
    const actor = recurringPaymentEApprovalActor(user);
    if (!actor) return;
    setSweeping(true);
    try {
      const snapshot = await getDocs(query(collection(db, RP_COLLECTIONS.payments), where('organizationId', '==', organizationId)));
      const payments = visibleObligations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PaymentObligation)));
      const result = await sweepRecurringPaymentApprovals(payments, actor);
      toast({
        title: result.scanned ? `${result.raised} raised, ${result.updated} updated` : 'Nothing to mirror',
        description: result.failed
          ? `${result.failed} could not be mirrored. ${result.errors.join(' ')}`
          : result.scanned
            ? `Checked ${result.scanned} payment(s).`
            : 'No open payment matches the settings above.',
        variant: result.failed ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({ title: 'The sweep could not run', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setSweeping(false);
    }
  }

  const update = (patch: Partial<RecurringEApprovalSettings>) => setSettings((current) => ({ ...current, ...patch }));

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/recurring-payments/settings">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">E-Approval Bridge</h1>
          <p className="text-sm text-muted-foreground">
            Mirror each payment’s workflow into E-Approval, so the same task appears in both and either side can act.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-600" /> Connect the two modules</CardTitle>
          <CardDescription>
            Both modules work on their own with this off — which is how they ship. Turning it on raises one E-Approval
            request per payment, running the same steps, in the same order, with the same people on them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <Label className="text-base">Mirror payments into E-Approval</Label>
              <p className="text-sm text-muted-foreground">
                {settings.enabled
                  ? 'On. Payments already in flight are picked up the next time they are opened or actioned.'
                  : 'Off. Nothing is written to E-Approval, and E-Approval never sees a payment.'}
              </p>
            </div>
            <Switch checked={settings.enabled} disabled={!canEdit} onCheckedChange={(enabled) => update({ enabled })} />
          </div>

          <div className={settings.enabled ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-50'}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Which steps appear in E-Approval</Label>
                <Select value={settings.scope} disabled={!canEdit} onValueChange={(scope: RecurringEApprovalSettings['scope']) => update({ scope })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">Every step — the whole payment as one file</SelectItem>
                    <SelectItem value="Decision">Decision steps only — verification, approval, closure</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {settings.scope === 'All'
                    ? 'Steps that need a bill number or a UTR appear too, but are completed on the payment’s own form.'
                    : 'Bill collection and payment processing stay entirely in this module.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Only mirror payments of at least</Label>
                <Input
                  type="number"
                  min="0"
                  step="1000"
                  value={settings.minAmount}
                  disabled={!canEdit}
                  onChange={(event) => update({ minAmount: Math.max(0, Number(event.target.value) || 0) })}
                />
                <p className="text-xs text-muted-foreground">
                  Measured against the billed amount once a bill is in, the estimate before that. 0 mirrors everything.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Raise under approval type</Label>
                <Select
                  value={settings.approvalTypeId || 'none'}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    update({
                      approvalTypeId: value === 'none' ? '' : value,
                      approvalTypeName: value === 'none' ? '' : types.find((type) => type.id === value)?.name || '',
                    })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="No type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No type</SelectItem>
                    {types.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used for E-Approval’s own reporting and reference numbering. It does not change the chain — that always
                  comes from the payment workflow below.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
                <div>
                  <Label>Mark mirrored approvals confidential</Label>
                  <p className="text-xs text-muted-foreground">
                    Only participants and users with confidential access can open them.
                  </p>
                </div>
                <Switch checked={settings.confidential} disabled={!canEdit} onCheckedChange={(confidential) => update({ confidential })} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {settings.enabled && (
              <Button variant="outline" onClick={sweep} disabled={sweeping || !canEdit}>
                {sweeping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Mirror eligible payments now
              </Button>
            )}
            <Button onClick={save} disabled={saving || !canEdit}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
            </Button>
          </div>
          {settings.enabled && (
            <p className="text-xs text-muted-foreground">
              Obligations are generated overnight by a server job that runs outside the browser, so it cannot raise
              approvals itself. They are mirrored the first time anybody opens or actions them — or all at once, here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Workflow className="h-5 w-5 text-amber-600" /> What a payment will look like in E-Approval</CardTitle>
          <CardDescription>
            The chain below is your configured payment workflow, read as approval stages. Change it in{' '}
            <Link href="/recurring-payments/settings/workflow" className="underline">Workflow Configuration</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {mirrored.map((step, index) => {
            const mode = recurringMirrorMode(step);
            return (
              <div key={step.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${mode === 'Decision' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {mode === 'Decision'
                      ? `Decidable in E-Approval — ${step.actions.filter((action) => ['Approve', 'Verify', 'Close'].includes(action)).join(', ') || 'no decision action configured'}.`
                      : 'Shown in E-Approval, completed on the payment’s own form.'}
                  </p>
                </div>
                <Badge variant={mode === 'Decision' ? 'default' : 'outline'} className="text-[10px]">
                  {mode === 'Decision' ? 'Decision' : 'Visibility'}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">{step.tat}h</Badge>
              </div>
            );
          })}
          {!mirrored.length && (
            <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              No step matches this scope, so nothing would be mirrored.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5 text-sky-600" /> How the two stay in step</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><strong className="text-foreground">Either side can act.</strong> An approval given in E-Approval moves the payment on; a step completed in Recurring Payments is recorded against the approval. Whichever happens first brings the other with it.</span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><strong className="text-foreground">Nobody approves their own request.</strong> A stage that lands on the person the payment belongs to is signed off automatically and the chain carries on — except a stage that is genuinely their own work, like collecting the bill, which still waits for them. Governed by <em>Skip self-approval stages</em> in E-Approval settings.</span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><strong className="text-foreground">A rejection or a return wins.</strong> Rejecting on either side rejects the payment; returning in E-Approval sends the payment back a step.</span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><strong className="text-foreground">A mirror can be broken.</strong> Any payment can be unlinked from its approval on its own detail screen; both records survive and each carries on alone.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
