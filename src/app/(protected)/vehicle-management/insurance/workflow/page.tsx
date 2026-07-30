'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { createUserNotification } from '@/lib/notifications';
import { formatVehicleTimestamp, getVehicleTimestampMillis, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import {
  DEFAULT_INSURANCE_WORKFLOW_CONFIG,
  INSURANCE_WORKFLOW_CONFIG_DOC_ID,
  INSURANCE_WORKFLOW_OPEN_STATUSES,
  insuranceDaysUntil,
  insuranceWorkflowDeadline,
  insuranceWorkflowDeadlineMeta,
  insuranceWorkflowPriority,
  insuranceWorkflowProgress,
  normalizeInsuranceWorkflowConfig,
  resolveInsuranceWorkflowAssignment,
  type InsuranceRenewalCase,
  type InsuranceWorkflowAction,
  type InsuranceWorkflowConfig,
  type InsuranceWorkflowHistoryEntry,
  type InsuranceWorkflowStep,
} from '@/lib/vehicle-insurance-workflow';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

type FilterTab = 'All' | 'My Tasks' | 'Overdue' | 'Unassigned' | 'Completed';
const TERMINAL_STATUSES = ['Completed', 'Rejected', 'Cancelled'];

export default function InsuranceWorkflowPage() {
  const searchParams = useSearchParams();
  const targetInsuranceId = searchParams?.get('insuranceId') || searchParams?.get('renew') || '';
  const targetCaseId = searchParams?.get('case') || '';
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Vehicle Management.Insurance Management') || can('Add', 'Vehicle Management.Insurance Management') || can('Edit', 'Vehicle Management.Insurance Management');
  const canManage = can('Add', 'Vehicle Management.Insurance Management') || can('Edit', 'Vehicle Management.Insurance Management');
  const canConfigure = can('Edit', 'Vehicle Management.Settings');
  const [config, setConfig] = useState<InsuranceWorkflowConfig>(normalizeInsuranceWorkflowConfig(DEFAULT_INSURANCE_WORKFLOW_CONFIG));
  const [cases, setCases] = useState<InsuranceRenewalCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [filter, setFilter] = useState<FilterTab>('All');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [selectedAction, setSelectedAction] = useState<InsuranceWorkflowAction | ''>('');
  const [comment, setComment] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [proposedPremiumText, setProposedPremiumText] = useState('');
  const [reassignUserId, setReassignUserId] = useState('');
  const autoScanStarted = useRef(false);

  const activeUsers = useMemo(() => users.filter((item) => item.status !== 'Inactive'), [users]);
  const userMap = useMemo(() => Object.fromEntries(activeUsers.map((item) => [item.id, item])), [activeUsers]);

  const loadCases = useCallback(async () => {
    const [caseSnapshot, configSnapshot] = await Promise.all([
      getDocs(collection(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases)),
      getDoc(doc(db, VEHICLE_COLLECTIONS.settings, INSURANCE_WORKFLOW_CONFIG_DOC_ID)),
    ]);
    const nextConfig = normalizeInsuranceWorkflowConfig(configSnapshot.exists() ? configSnapshot.data() as Partial<InsuranceWorkflowConfig> : null);
    const nextCases = caseSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() } as InsuranceRenewalCase))
      .sort((a, b) => getVehicleTimestampMillis(b.createdAt) - getVehicleTimestampMillis(a.createdAt));
    setConfig(nextConfig);
    setCases(nextCases);
    if (targetCaseId && nextCases.some((item) => item.id === targetCaseId)) {
      setSelectedCaseId(targetCaseId);
    } else if (targetInsuranceId) {
      const matching = nextCases.find((item) => item.insuranceId === targetInsuranceId && !TERMINAL_STATUSES.includes(item.status));
      if (matching) setSelectedCaseId(matching.id);
    }
    return { nextConfig, nextCases };
  }, [targetCaseId, targetInsuranceId]);

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    loadCases().catch((error) => {
      console.error('Unable to load insurance workflow cases', error);
      toast({ title: 'Unable to load workflow cases', variant: 'destructive' });
    }).finally(() => setIsLoading(false));
  }, [canView, loadCases, toast]);

  const notifyUsers = async (userIds: string[], caseId: string, title: string, body: string, stepName: string) => {
    await Promise.all(userIds.map((userId) => createUserNotification(userId, {
      type: title.toLowerCase().includes('escalat') ? 'tat_escalation' : 'step_entry',
      title,
      body,
      module: 'insurance',
      itemId: caseId,
      itemRef: body,
      stepName,
      link: `/vehicle-management/insurance/workflow?case=${caseId}`,
    }).catch((error) => console.error('Unable to create insurance workflow notification', error))));
  };

  const addActivity = async (caseId: string, caseRow: Partial<InsuranceRenewalCase>, history: InsuranceWorkflowHistoryEntry) => {
    const { timestamp: _timestamp, ...activity } = history;
    await addDoc(collection(db, VEHICLE_COLLECTIONS.insuranceWorkflowActivities), {
      caseId,
      insuranceId: caseRow.insuranceId || '',
      vehicleId: caseRow.vehicleId || '',
      vehicleNumber: caseRow.vehicleNumber || '',
      ...activity,
      createdAt: serverTimestamp(),
    });
  };

  const runScan = useCallback(async (specificInsuranceId = '') => {
    if (!canManage || isScanning) return '';
    setIsScanning(true);
    try {
      const [{ nextConfig, nextCases }, insuranceSnapshot] = await Promise.all([
        loadCases(),
        getDocs(collection(db, VEHICLE_COLLECTIONS.insurance)),
      ]);
      if (!nextConfig.enabled) {
        toast({ title: 'Workflow is disabled', description: 'Enable it from Insurance Workflow Setup.' });
        return '';
      }
      const maxTriggerDays = Math.max(...nextConfig.triggerDays);
      const existingInsuranceIds = new Set(nextCases.map((item) => item.insuranceId));
      let createdCount = 0;
      let openedCaseId = '';

      for (const insuranceDoc of insuranceSnapshot.docs) {
        if (specificInsuranceId && insuranceDoc.id !== specificInsuranceId) continue;
        const row = insuranceDoc.data() as Record<string, any>;
        if (row.isArchived === true || row.renewalStatus === 'Renewed' || existingInsuranceIds.has(insuranceDoc.id)) continue;
        const daysToExpiry = insuranceDaysUntil(String(row.expiryDate || ''));
        if (!Number.isFinite(daysToExpiry) || (!specificInsuranceId && daysToExpiry > maxTriggerDays)) continue;
        const firstStep = nextConfig.steps[0];
        if (!firstStep) continue;
        const assignment = resolveInsuranceWorkflowAssignment(firstStep, Number(row.premiumAmount || 0), activeUsers, nextConfig);
        const now = Timestamp.now();
        const historyEntry: InsuranceWorkflowHistoryEntry = {
          action: 'Workflow Started',
          comment: daysToExpiry < 0 ? `Policy expired ${Math.abs(daysToExpiry)} day(s) ago.` : `Policy expires in ${daysToExpiry} day(s).`,
          userId: user?.id || 'system',
          userName: user?.name || 'System',
          stepId: firstStep.id,
          stepName: firstStep.name,
          timestamp: now,
        };
        const caseRef = doc(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases, insuranceDoc.id);
        await setDoc(caseRef, {
          insuranceId: insuranceDoc.id,
          vehicleId: String(row.vehicleId || ''),
          vehicleNumber: String(row.vehicleNumber || ''),
          policyNumber: String(row.policyNumber || ''),
          insuranceCompany: String(row.insuranceCompany || ''),
          policyType: String(row.policyType || ''),
          expiryDate: String(row.expiryDate || ''),
          currentPremium: Number(row.premiumAmount || 0),
          daysToExpiry,
          priority: insuranceWorkflowPriority(daysToExpiry),
          status: 'Open',
          currentStepId: firstStep.id,
          currentStepName: firstStep.name,
          currentStepIndex: 0,
          totalSteps: nextConfig.steps.length,
          ...assignment,
          escalationLevel: 0,
          workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(firstStep.tatHours)),
          stepStartedAt: now,
          acknowledgedAt: null,
          history: [historyEntry],
          createdAt: now,
          updatedAt: now,
        });
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.insurance, insuranceDoc.id), {
          workflowCaseId: caseRef.id,
          renewalStatus: 'Workflow Started',
          updatedAt: serverTimestamp(),
        });
        await addActivity(caseRef.id, row, historyEntry);
        await notifyUsers(assignment.assigneeIds, caseRef.id, 'Insurance renewal assigned', `${row.vehicleNumber || row.policyNumber || 'Insurance policy'} requires renewal`, firstStep.name);
        createdCount += 1;
        openedCaseId ||= caseRef.id;
      }

      await loadCases();
      if (openedCaseId) setSelectedCaseId(openedCaseId);
      toast({ title: createdCount ? 'Expiry scan completed' : 'No new cases', description: createdCount ? `${createdCount} renewal case(s) created.` : 'All eligible policies already have workflow cases.' });
      return openedCaseId;
    } catch (error) {
      console.error('Unable to scan insurance expiry records', error);
      toast({ title: 'Expiry scan failed', variant: 'destructive' });
      return '';
    } finally {
      setIsScanning(false);
    }
  }, [activeUsers, canManage, isScanning, loadCases, toast, user?.id, user?.name]);

  useEffect(() => {
    if (isLoading || autoScanStarted.current || !canManage) return;
    autoScanStarted.current = true;
    void runScan(targetInsuranceId);
  }, [canManage, isLoading, runScan, targetInsuranceId]);

  const selectedCase = useMemo(() => cases.find((item) => item.id === selectedCaseId) || null, [cases, selectedCaseId]);
  const currentStep = selectedCase ? config.steps.find((item) => item.id === selectedCase.currentStepId) || config.steps[selectedCase.currentStepIndex] : undefined;

  useEffect(() => {
    setProposedPremiumText(selectedCase ? String(selectedCase.proposedPremium || selectedCase.currentPremium || '') : '');
  }, [selectedCase?.id]);

  const performAction = async () => {
    if (!selectedCase || !selectedAction || !currentStep || isWorking) return;
    if (['Return', 'Reject'].includes(selectedAction) && !comment.trim()) {
      toast({ title: 'Comment required', description: `Add a reason before ${selectedAction.toLowerCase()}.`, variant: 'destructive' });
      return;
    }
    if (currentStep.documentRequired && ['Complete', 'Approve'].includes(selectedAction) && !documentReference.trim()) {
      toast({ title: 'Document reference required', description: `Add a document URL, file reference or quotation number for ${currentStep.name}.`, variant: 'destructive' });
      return;
    }
    setIsWorking(true);
    try {
      const now = Timestamp.now();
      const proposedPremium = Math.max(0, Number(proposedPremiumText || selectedCase.proposedPremium || selectedCase.currentPremium || 0));
      const actionComment = [comment.trim(), documentReference.trim() ? `Document: ${documentReference.trim()}` : ''].filter(Boolean).join(' | ');
      const historyEntry: InsuranceWorkflowHistoryEntry = {
        action: selectedAction,
        comment: actionComment,
        userId: user?.id || '',
        userName: user?.name || user?.email || 'User',
        stepId: currentStep.id,
        stepName: currentStep.name,
        timestamp: now,
      };
      const patch: Record<string, any> = { updatedAt: now, history: arrayUnion(historyEntry), proposedPremium };
      if (documentReference.trim()) {
        patch.documentReferences = arrayUnion({
          stepId: currentStep.id,
          stepName: currentStep.name,
          reference: documentReference.trim(),
          addedBy: user?.name || user?.email || 'User',
          addedAt: now,
        });
      }
      let notifyIds: string[] = [];
      let notifyTitle = '';
      let notifyStepName = currentStep.name;

      if (selectedAction === 'Acknowledge') {
        patch.status = 'In Progress';
        patch.acknowledgedAt = now;
      } else if (selectedAction === 'Reject') {
        patch.status = 'Rejected';
        patch.workflowDeadline = null;
      } else {
        const nextIndex = selectedAction === 'Return'
          ? Math.max(0, selectedCase.currentStepIndex - 1)
          : selectedCase.currentStepIndex + 1;
        if (nextIndex >= config.steps.length) {
          const params = new URLSearchParams({
            renew: selectedCase.insuranceId,
            vid: selectedCase.vehicleId,
            vnum: selectedCase.vehicleNumber,
            case: selectedCase.id,
          });
          patch.status = 'Ready for Renewal';
          patch.currentStepName = 'Policy Renewal';
          patch.currentStepIndex = config.steps.length;
          patch.workflowDeadline = null;
          patch.renewalHref = `/vehicle-management/insurance?${params.toString()}`;
        } else {
          const nextStep = config.steps[nextIndex];
          const assignment = resolveInsuranceWorkflowAssignment(nextStep, proposedPremium, activeUsers, config);
          Object.assign(patch, assignment, {
            status: selectedAction === 'Return' ? 'Returned' : 'In Progress',
            currentStepId: nextStep.id,
            currentStepName: nextStep.name,
            currentStepIndex: nextIndex,
            stepStartedAt: now,
            acknowledgedAt: null,
            workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(nextStep.tatHours)),
          });
          notifyIds = assignment.assigneeIds;
          notifyTitle = selectedAction === 'Return' ? 'Insurance renewal returned' : 'Insurance workflow step assigned';
          notifyStepName = nextStep.name;
        }
      }

      await updateDoc(doc(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases, selectedCase.id), patch);
      await addActivity(selectedCase.id, selectedCase, historyEntry);
      if (notifyIds.length) await notifyUsers(notifyIds, selectedCase.id, notifyTitle, selectedCase.vehicleNumber || selectedCase.policyNumber, notifyStepName);
      toast({ title: 'Workflow updated', description: `${selectedAction} recorded successfully.` });
      setSelectedAction('');
      setComment('');
      setDocumentReference('');
      await loadCases();
    } catch (error) {
      console.error('Unable to update insurance workflow', error);
      toast({ title: 'Workflow action failed', variant: 'destructive' });
    } finally {
      setIsWorking(false);
    }
  };

  const reassign = async () => {
    if (!selectedCase || !currentStep || !reassignUserId || isWorking) return;
    const assignee = userMap[reassignUserId];
    if (!assignee) return;
    setIsWorking(true);
    try {
      const now = Timestamp.now();
      const historyEntry: InsuranceWorkflowHistoryEntry = {
        action: 'Reassigned',
        comment: comment.trim() || `Assigned to ${assignee.name || assignee.email}.`,
        userId: user?.id || '',
        userName: user?.name || user?.email || 'User',
        stepId: currentStep.id,
        stepName: currentStep.name,
        timestamp: now,
      };
      await updateDoc(doc(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases, selectedCase.id), {
        assigneeIds: [assignee.id],
        assigneeNames: [assignee.name || assignee.email],
        status: 'In Progress',
        stepStartedAt: now,
        acknowledgedAt: null,
        workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(currentStep.tatHours)),
        history: arrayUnion(historyEntry),
        updatedAt: now,
      });
      await addActivity(selectedCase.id, selectedCase, historyEntry);
      await notifyUsers([assignee.id], selectedCase.id, 'Insurance renewal reassigned', selectedCase.vehicleNumber || selectedCase.policyNumber, currentStep.name);
      setReassignUserId('');
      setComment('');
      await loadCases();
      toast({ title: 'Case reassigned' });
    } catch (error) {
      console.error('Unable to reassign insurance workflow', error);
      toast({ title: 'Reassignment failed', variant: 'destructive' });
    } finally {
      setIsWorking(false);
    }
  };

  const runEscalations = async () => {
    if (!canManage || isWorking) return;
    const overdueCases = cases.filter((item) => INSURANCE_WORKFLOW_OPEN_STATUSES.includes(item.status) && insuranceWorkflowDeadlineMeta(item.workflowDeadline).overdue);
    if (!overdueCases.length) return toast({ title: 'No overdue stages', description: 'All active cases are within TAT.' });
    setIsWorking(true);
    try {
      for (const caseRow of overdueCases) {
        const workflowStep = config.steps.find((item) => item.id === caseRow.currentStepId) || config.steps[caseRow.currentStepIndex];
        if (!workflowStep) continue;
        const nextUserId = config.autoEscalate && caseRow.backupAssigneeId ? caseRow.backupAssigneeId : caseRow.assigneeIds[0];
        const nextUser = userMap[nextUserId];
        const now = Timestamp.now();
        const historyEntry: InsuranceWorkflowHistoryEntry = {
          action: 'TAT Escalated',
          comment: nextUser ? `Escalated to ${nextUser.name || nextUser.email}.` : 'TAT breached; manager action required.',
          userId: user?.id || 'system',
          userName: user?.name || 'System',
          stepId: workflowStep.id,
          stepName: workflowStep.name,
          timestamp: now,
        };
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases, caseRow.id), {
          status: 'Escalated',
          assigneeIds: nextUser ? [nextUser.id] : caseRow.assigneeIds,
          assigneeNames: nextUser ? [nextUser.name || nextUser.email] : caseRow.assigneeNames,
          escalationLevel: Number(caseRow.escalationLevel || 0) + 1,
          workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(workflowStep.tatHours)),
          history: arrayUnion(historyEntry),
          updatedAt: now,
        });
        await addActivity(caseRow.id, caseRow, historyEntry);
        if (nextUser) await notifyUsers([nextUser.id], caseRow.id, 'Insurance TAT escalated', caseRow.vehicleNumber || caseRow.policyNumber, workflowStep.name);
      }
      await loadCases();
      toast({ title: 'Escalation completed', description: `${overdueCases.length} overdue case(s) processed.` });
    } catch (error) {
      console.error('Unable to run workflow escalation', error);
      toast({ title: 'Escalation failed', variant: 'destructive' });
    } finally {
      setIsWorking(false);
    }
  };

  const metrics = useMemo(() => ({
    open: cases.filter((item) => INSURANCE_WORKFLOW_OPEN_STATUSES.includes(item.status)).length,
    mine: cases.filter((item) => item.assigneeIds.includes(user?.id || '') && INSURANCE_WORKFLOW_OPEN_STATUSES.includes(item.status)).length,
    overdue: cases.filter((item) => INSURANCE_WORKFLOW_OPEN_STATUSES.includes(item.status) && insuranceWorkflowDeadlineMeta(item.workflowDeadline).overdue).length,
    completed: cases.filter((item) => item.status === 'Completed').length,
  }), [cases, user?.id]);

  const filteredCases = useMemo(() => {
    const term = queryText.trim().toLowerCase();
    return cases.filter((item) => {
      if (filter === 'My Tasks' && !item.assigneeIds.includes(user?.id || '')) return false;
      if (filter === 'Overdue' && !insuranceWorkflowDeadlineMeta(item.workflowDeadline).overdue) return false;
      if (filter === 'Unassigned' && item.assigneeIds.length) return false;
      if (filter === 'Completed' && item.status !== 'Completed') return false;
      if (filter === 'All' && item.status === 'Completed') return false;
      if (!term) return true;
      return [item.vehicleNumber, item.policyNumber, item.insuranceCompany, item.currentStepName, item.status].some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [cases, filter, queryText, user?.id]);

  if (!canView) return <Card><CardHeader><CardTitle>Access Restricted</CardTitle><CardDescription>You do not have permission to view insurance workflows.</CardDescription></CardHeader></Card>;

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><CardTitle className="flex items-center gap-2 text-lg"><GitBranch className="h-5 w-5 text-violet-600" />Insurance Renewal Workflow</CardTitle><CardDescription>Dynamic ownership, stage TAT, escalation, approvals and policy activation.</CardDescription></div>
          <div className="flex flex-wrap gap-2">{canConfigure && <Link href="/vehicle-management/settings/insurance-workflow"><Button variant="outline" className="bg-white"><Settings2 className="mr-1.5 h-4 w-4" />Configure</Button></Link>}<Button variant="outline" onClick={() => void runEscalations()} disabled={!canManage || isWorking} className="bg-white"><BellRing className="mr-1.5 h-4 w-4" />Run Escalation</Button><Button onClick={() => void runScan()} disabled={!canManage || isScanning} className="bg-gradient-to-r from-violet-600 to-indigo-600">{isScanning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Run Expiry Scan</Button></div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Open Cases" value={metrics.open} icon={RefreshCw} tone="blue" />
        <Metric label="My Tasks" value={metrics.mine} icon={UserRoundCheck} tone="violet" />
        <Metric label="TAT Overdue" value={metrics.overdue} icon={AlertTriangle} tone="rose" />
        <Metric label="Completed" value={metrics.completed} icon={CheckCircle2} tone="emerald" />
      </div>

      <Card className="vm-panel">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex gap-1 overflow-x-auto pb-1">{(['All', 'My Tasks', 'Overdue', 'Unassigned', 'Completed'] as FilterTab[]).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={cn('shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors', filter === item ? 'bg-violet-600 text-white' : 'border border-slate-200 bg-white text-slate-600')}>{item}</button>)}</div>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Search vehicle, policy, insurer, stage or status..." className="bg-white pl-9" /></div>
        </CardContent>
      </Card>

      {isLoading ? <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-52 rounded-xl" />)}</div> : filteredCases.length === 0 ? (
        <Card className="vm-panel"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><ShieldCheck className="h-11 w-11 text-emerald-400" /><div><p className="font-semibold">No matching renewal cases</p><p className="text-sm text-muted-foreground">Run the expiry scan to create cases from eligible insurance policies.</p></div></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredCases.map((caseRow) => {
            const tat = insuranceWorkflowDeadlineMeta(caseRow.workflowDeadline);
            const progress = insuranceWorkflowProgress(caseRow);
            return <Card key={caseRow.id} className={cn('vm-panel cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md', tat.overdue && 'border-rose-200')} onClick={() => setSelectedCaseId(caseRow.id)}>
              <div className={cn('h-1', caseRow.status === 'Completed' ? 'bg-emerald-500' : tat.overdue ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-cyan-500')} />
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{caseRow.vehicleNumber || 'Unlinked Vehicle'}</p><p className="truncate text-xs text-muted-foreground">{caseRow.policyNumber || '-'} · {caseRow.insuranceCompany || '-'}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><StatusBadge status={caseRow.status} /><Badge variant="outline" className={cn('text-[10px]', caseRow.priority === 'Critical' ? 'border-rose-200 bg-rose-50 text-rose-700' : caseRow.priority === 'High' ? 'border-amber-200 bg-amber-50 text-amber-700' : '')}>{caseRow.priority}</Badge></div></div>
                <div><div className="mb-1.5 flex justify-between text-xs"><span className="font-medium text-slate-700">{caseRow.currentStepName}</span><span className="text-muted-foreground">{progress}%</span></div><Progress value={progress} className="h-2" /></div>
                <div className="grid grid-cols-2 gap-2 text-xs"><Info label="Expiry" value={caseRow.expiryDate || '-'} /><Info label="Current owner" value={caseRow.assigneeNames.join(', ') || 'Unassigned'} /><Info label="TAT" value={tat.label} danger={tat.overdue} /><Info label="Created" value={formatVehicleTimestamp(caseRow.createdAt)} /></div>
                <Button type="button" variant="outline" className="w-full bg-white" onClick={(event) => { event.stopPropagation(); setSelectedCaseId(caseRow.id); }}>Open Workflow</Button>
              </CardContent>
            </Card>;
          })}
        </div>
      )}

      <Dialog open={!!selectedCase} onOpenChange={(open) => { if (!open) { setSelectedCaseId(''); setSelectedAction(''); setComment(''); setDocumentReference(''); setProposedPremiumText(''); setReassignUserId(''); } }}>
        <DialogContent className="vm-mobile-dialog flex max-h-[94vh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          {selectedCase && <>
            <DialogHeader className="shrink-0 border-b bg-gradient-to-r from-violet-50 via-white to-cyan-50 px-4 py-4 pr-12 sm:px-6"><DialogTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-violet-600" />{selectedCase.vehicleNumber || selectedCase.policyNumber}</DialogTitle><DialogDescription>{selectedCase.policyNumber} · {selectedCase.insuranceCompany} · expires {selectedCase.expiryDate}</DialogDescription></DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-3 sm:p-5">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <Card className="bg-white"><CardHeader className="pb-3"><CardTitle className="text-base">Workflow Progress</CardTitle><CardDescription>{selectedCase.currentStepIndex} of {selectedCase.totalSteps} stages completed</CardDescription></CardHeader><CardContent className="space-y-2">{config.steps.map((workflowStep, index) => { const complete = index < selectedCase.currentStepIndex || selectedCase.status === 'Completed'; const active = workflowStep.id === selectedCase.currentStepId && selectedCase.status !== 'Completed'; return <div key={workflowStep.id} className={cn('flex items-start gap-3 rounded-xl border p-3', active ? 'border-violet-200 bg-violet-50' : complete ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-200 bg-white')}><div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', complete ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500')}>{complete ? '✓' : index + 1}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{workflowStep.name}</p><p className="line-clamp-2 text-xs text-muted-foreground">{workflowStep.description}</p></div><Badge variant="outline" className="shrink-0 bg-white text-[10px]">{workflowStep.tatHours}h</Badge></div>; })}<Progress value={insuranceWorkflowProgress(selectedCase)} className="mt-3 h-2" /></CardContent></Card>
                <div className="space-y-3">
                  <Card className="bg-white"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-violet-600" />Current Stage</CardTitle></CardHeader><CardContent className="space-y-3"><div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-violet-900">{selectedCase.currentStepName}</p><StatusBadge status={selectedCase.status} /></div>{currentStep && <p className="mt-1 text-xs text-violet-800">{currentStep.description}</p>}</div><div className="grid grid-cols-2 gap-2"><Info label="Owner" value={selectedCase.assigneeNames.join(', ') || 'Unassigned'} /><Info label="TAT" value={insuranceWorkflowDeadlineMeta(selectedCase.workflowDeadline).label} danger={insuranceWorkflowDeadlineMeta(selectedCase.workflowDeadline).overdue} /><Info label="Escalation" value={`Level ${selectedCase.escalationLevel || 0}`} /><Info label="Proposed Premium" value={new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(selectedCase.proposedPremium || selectedCase.currentPremium || 0)} /></div>{canManage && selectedCase.status !== 'Completed' && <Field label="Proposed renewal premium"><Input type="number" min="0" value={proposedPremiumText} onChange={(event) => setProposedPremiumText(event.target.value)} placeholder="Enter quotation premium" /></Field>}</CardContent></Card>
                  {selectedCase.status === 'Ready for Renewal' && <Card className="border-emerald-200 bg-emerald-50"><CardContent className="p-4"><p className="font-semibold text-emerald-900">Approved for policy renewal</p><p className="mt-1 text-xs text-emerald-800">Open the renewal form, upload the new policy and save it to close this workflow.</p><Link href={selectedCase.renewalHref || '#'}><Button className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700"><ExternalLink className="mr-1.5 h-4 w-4" />Open Renewal Form</Button></Link></CardContent></Card>}
                  {canManage && currentStep && INSURANCE_WORKFLOW_OPEN_STATUSES.includes(selectedCase.status) && selectedCase.status !== 'Ready for Renewal' && <Card className="bg-white"><CardHeader className="pb-3"><CardTitle className="text-base">Take Action</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2">{currentStep.actions.map((action) => <Button key={action} size="sm" variant={action === 'Reject' ? 'destructive' : action === 'Return' ? 'outline' : selectedAction === action ? 'default' : 'secondary'} onClick={() => setSelectedAction(action)}>{action}</Button>)}</div>{selectedAction && <>{currentStep.documentRequired && ['Complete', 'Approve'].includes(selectedAction) && <Field label="Supporting document / reference *"><Input value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} placeholder="Document URL, quotation or file reference" /></Field>}<Field label={['Return', 'Reject'].includes(selectedAction) ? 'Comment / reason *' : 'Comment'}><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add remarks for the audit trail" /></Field><Button onClick={() => void performAction()} disabled={isWorking} className="w-full">{isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm {selectedAction}</Button></>}</CardContent></Card>}
                  {canManage && INSURANCE_WORKFLOW_OPEN_STATUSES.includes(selectedCase.status) && selectedCase.status !== 'Ready for Renewal' && <Card className="bg-white"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-indigo-600" />Reassign</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={reassignUserId} onValueChange={setReassignUserId}><SelectTrigger><SelectValue placeholder="Select new owner" /></SelectTrigger><SelectContent>{activeUsers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name || item.email} {item.role ? `(${item.role})` : ''}</SelectItem>)}</SelectContent></Select><Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Reason for reassignment" /><Button variant="outline" onClick={() => void reassign()} disabled={!reassignUserId || isWorking} className="w-full">Reassign Case</Button></CardContent></Card>}
                </div>
              </div>
              <Card className="bg-white"><CardHeader className="pb-3"><CardTitle className="text-base">Action History</CardTitle><CardDescription>Complete audit trail for assignment, approval, escalation and renewal.</CardDescription></CardHeader><CardContent><div className="space-y-2">{[...(selectedCase.history || [])].reverse().map((entry, index) => <div key={`${entry.action}-${index}`} className="flex gap-3 rounded-xl border border-slate-200 p-3"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700"><ShieldCheck className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-1"><p className="text-sm font-semibold">{entry.action} · {entry.stepName}</p><span className="text-[11px] text-muted-foreground">{formatVehicleTimestamp(entry.timestamp)}</span></div><p className="text-xs text-muted-foreground">{entry.userName}{entry.comment ? ` — ${entry.comment}` : ''}</p></div></div>)}{!selectedCase.history?.length && <p className="py-8 text-center text-sm text-muted-foreground">No workflow activity recorded.</p>}</div></CardContent></Card>
            </div>
            <DialogFooter className="shrink-0 border-t bg-white px-4 py-3 sm:px-6"><Button variant="outline" onClick={() => setSelectedCaseId('')}>Close</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof RefreshCw; tone: 'blue' | 'violet' | 'rose' | 'emerald' }) {
  const tones = { blue: 'border-blue-100 bg-blue-50 text-blue-700', violet: 'border-violet-100 bg-violet-50 text-violet-700', rose: 'border-rose-100 bg-rose-50 text-rose-700', emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700' };
  return <Card className={cn('border', tones[tone])}><CardContent className="flex items-center gap-3 p-3 sm:p-4"><div className="rounded-lg bg-white/80 p-2"><Icon className="h-4 w-4" /></div><div><p className="text-[10px] font-semibold uppercase tracking-wide sm:text-xs">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>;
}

function Info({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className={cn('mt-0.5 truncate text-xs font-medium text-slate-700', danger && 'text-rose-700')} title={value}>{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn('text-[10px]', status === 'Completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'Rejected' ? 'border-rose-200 bg-rose-50 text-rose-700' : status === 'Escalated' || status === 'Returned' ? 'border-amber-200 bg-amber-50 text-amber-700' : status === 'Ready for Renewal' ? 'border-cyan-200 bg-cyan-50 text-cyan-700' : 'border-violet-200 bg-violet-50 text-violet-700')}>{status}</Badge>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-semibold">{label}</Label>{children}</div>;
}
