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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
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
  Upload,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { createUserNotification } from '@/lib/notifications';
import { formatVehicleTimestamp, getVehicleComplianceRequirements, getVehicleTimestampMillis, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useFieldControl } from '@/components/vehicle-management/use-field-control';
import {
  DEFAULT_INSURANCE_WORKFLOW_CONFIG,
  INSURANCE_WORKFLOW_CONFIG_DOC_ID,
  INSURANCE_WORKFLOW_OPEN_STATUSES,
  insuranceDaysUntil,
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
import { addBusinessHours } from '@/lib/working-hours';
import { loadWorkingCalendar } from '@/lib/working-hours-client';
import type { Holiday, WorkingHours } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';

type FilterTab = 'All' | 'My Tasks' | 'Overdue' | 'Unassigned' | 'Completed';
const TERMINAL_STATUSES = ['Completed', 'Rejected', 'Cancelled'];

export default function InsuranceWorkflowPage() {
  const searchParams = useSearchParams();
  const targetInsuranceId = searchParams?.get('insuranceId') || searchParams?.get('renew') || '';
  const targetCaseId = searchParams?.get('case') || '';
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl('insuranceWorkflow');
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
  const [supportingDocument, setSupportingDocument] = useState<File | null>(null);
  const [proposedPremiumText, setProposedPremiumText] = useState('');
  const [reassignUserId, setReassignUserId] = useState('');
  const [vehicleMap, setVehicleMap] = useState<Record<string, Record<string, any>>>({});
  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const autoScanStarted = useRef(false);

  const activeUsers = useMemo(() => users.filter((item) => item.status !== 'Inactive'), [users]);
  const userMap = useMemo(() => Object.fromEntries(activeUsers.map((item) => [item.id, item])), [activeUsers]);

  const loadCases = useCallback(async () => {
    const [caseSnapshot, configSnapshot, vehicleSnapshot, calendar] = await Promise.all([
      getDocs(collection(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases)),
      getDoc(doc(db, VEHICLE_COLLECTIONS.settings, INSURANCE_WORKFLOW_CONFIG_DOC_ID)),
      getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
      loadWorkingCalendar(),
    ]);
    const nextConfig = normalizeInsuranceWorkflowConfig(configSnapshot.exists() ? configSnapshot.data() as Partial<InsuranceWorkflowConfig> : null);
    const nextCases = caseSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() } as InsuranceRenewalCase))
      .sort((a, b) => getVehicleTimestampMillis(b.createdAt) - getVehicleTimestampMillis(a.createdAt));
    // Needed so a vehicle that's since been marked Sold/Scrapped (or had insurance manually
    // turned off) never gets a new case created for it, and existing cases can be excluded
    // from escalation below.
    const nextVehicleMap = Object.fromEntries(vehicleSnapshot.docs.map((item) => [item.id, item.data()]));
    setConfig(nextConfig);
    setCases(nextCases);
    setVehicleMap(nextVehicleMap);
    setWorkingHours(calendar.workingHours);
    setHolidays(calendar.holidays);
    if (targetCaseId && nextCases.some((item) => item.id === targetCaseId)) {
      setSelectedCaseId(targetCaseId);
    } else if (targetInsuranceId) {
      const matching = nextCases.find((item) => item.insuranceId === targetInsuranceId && !TERMINAL_STATUSES.includes(item.status));
      if (matching) setSelectedCaseId(matching.id);
    }
    return { nextConfig, nextCases, nextVehicleMap, calendar };
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
      const [{ nextConfig, nextCases, nextVehicleMap, calendar }, insuranceSnapshot] = await Promise.all([
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
        const vehicle = nextVehicleMap[String(row.vehicleId || '')];
        if (vehicle && !getVehicleComplianceRequirements(vehicle).insurance) continue;
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
          workflowDeadline: Timestamp.fromDate(addBusinessHours(new Date(), firstStep.tatHours, calendar.workingHours, calendar.holidays)),
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
  const availableActions = useMemo(() => {
    if (!selectedCase || !currentStep) return [];
    const visitStartedAt = getVehicleTimestampMillis(selectedCase.stepStartedAt);
    const completedActions = new Set(
      (selectedCase.history || [])
        .filter((entry) => entry.stepId === currentStep.id && (!visitStartedAt || getVehicleTimestampMillis(entry.timestamp) >= visitStartedAt))
        .map((entry) => entry.action)
    );
    if (selectedCase.acknowledgedAt) completedActions.add('Acknowledge');
    return currentStep.actions.filter((action) => !completedActions.has(action));
  }, [currentStep, selectedCase]);

  useEffect(() => {
    setProposedPremiumText(selectedCase ? String(selectedCase.proposedPremium || selectedCase.currentPremium || '') : '');
    setSupportingDocument(null);
  }, [selectedCase?.id]);

  useEffect(() => {
    if (selectedAction && !availableActions.includes(selectedAction)) setSelectedAction('');
  }, [availableActions, selectedAction]);

  const performAction = async () => {
    if (!selectedCase || !selectedAction || !currentStep || isWorking) return;
    if (!availableActions.includes(selectedAction)) {
      setSelectedAction('');
      toast({ title: 'Action already completed', description: `${selectedAction} has already been recorded for this stage.` });
      return;
    }
    if (['Return', 'Reject'].includes(selectedAction) && !comment.trim()) {
      toast({ title: 'Comment required', description: `Add a reason before ${selectedAction.toLowerCase()}.`, variant: 'destructive' });
      return;
    }
    if (currentStep.documentRequired && ['Complete', 'Approve'].includes(selectedAction) && !supportingDocument) {
      toast({ title: 'Document upload required', description: `Upload a supporting document for ${currentStep.name}.`, variant: 'destructive' });
      return;
    }
    if (supportingDocument && supportingDocument.size > 10 * 1024 * 1024) {
      toast({ title: 'File is too large', description: 'Supporting documents must be smaller than 10 MB.', variant: 'destructive' });
      return;
    }
    if (supportingDocument && !/\.(pdf|jpe?g|png|webp|docx?|xlsx?)$/i.test(supportingDocument.name)) {
      toast({ title: 'Unsupported file format', description: 'Upload a PDF, image, Word, or Excel document.', variant: 'destructive' });
      return;
    }
    setIsWorking(true);
    try {
      const now = Timestamp.now();
      const proposedPremium = Math.max(0, Number(proposedPremiumText || selectedCase.proposedPremium || selectedCase.currentPremium || 0));
      let uploadedDocumentUrl = '';
      if (supportingDocument) {
        const safeName = supportingDocument.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const uploadRef = ref(storage, `vehicle-management/insurance-workflow/${selectedCase.id}/${currentStep.id}/${Date.now()}-${safeName}`);
        await uploadBytes(uploadRef, supportingDocument, { contentType: supportingDocument.type || 'application/octet-stream' });
        uploadedDocumentUrl = await getDownloadURL(uploadRef);
      }
      const actionComment = [comment.trim(), supportingDocument ? `Document: ${supportingDocument.name}` : ''].filter(Boolean).join(' | ');
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
      if (uploadedDocumentUrl) {
        patch.documentReferences = arrayUnion({
          stepId: currentStep.id,
          stepName: currentStep.name,
          reference: uploadedDocumentUrl,
          fileName: supportingDocument?.name || 'Supporting document',
          contentType: supportingDocument?.type || 'application/octet-stream',
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
            workflowDeadline: Timestamp.fromDate(addBusinessHours(new Date(), nextStep.tatHours, workingHours, holidays)),
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
      setSupportingDocument(null);
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
        workflowDeadline: Timestamp.fromDate(addBusinessHours(new Date(), currentStep.tatHours, workingHours, holidays)),
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
    const overdueCases = cases.filter((item) => {
      if (!INSURANCE_WORKFLOW_OPEN_STATUSES.includes(item.status) || !insuranceWorkflowDeadlineMeta(item.workflowDeadline).overdue) return false;
      const vehicle = vehicleMap[String(item.vehicleId || '')];
      // Don't escalate a case whose vehicle no longer requires insurance (Sold/Scrapped, etc.).
      if (vehicle && !getVehicleComplianceRequirements(vehicle).insurance) return false;
      return true;
    });
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
          workflowDeadline: Timestamp.fromDate(addBusinessHours(new Date(), workflowStep.tatHours, workingHours, holidays)),
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
  const workflowPagination = useVehicleTablePagination(filteredCases);

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

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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

      {isLoading ? <Card className="vm-panel"><CardContent className="space-y-2 p-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-11 rounded-lg" />)}</CardContent></Card> : filteredCases.length === 0 ? (
        <Card className="vm-panel"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><ShieldCheck className="h-11 w-11 text-emerald-400" /><div><p className="font-semibold">No matching renewal cases</p><p className="text-sm text-muted-foreground">Run the expiry scan to create cases from eligible insurance policies.</p></div></CardContent></Card>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 md:hidden">
            {workflowPagination.paginatedRows.map((caseRow) => {
              const tat = insuranceWorkflowDeadlineMeta(caseRow.workflowDeadline);
              const progress = insuranceWorkflowProgress(caseRow);
              return <Card key={caseRow.id} className={cn('vm-panel cursor-pointer overflow-hidden', tat.overdue && 'border-rose-200')} onClick={() => setSelectedCaseId(caseRow.id)}>
                <div className={cn('h-0.5', caseRow.status === 'Completed' ? 'bg-emerald-500' : tat.overdue ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-cyan-500')} />
                <CardContent className="space-y-2.5 p-3">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{caseRow.vehicleNumber || 'Unlinked Vehicle'}</p><p className="truncate text-[11px] text-muted-foreground">{caseRow.policyNumber || '-'} · {caseRow.insuranceCompany || '-'}</p></div><StatusBadge status={caseRow.status} /></div>
                  <div><div className="mb-1 flex items-center justify-between gap-2 text-[11px]"><span className="truncate font-medium text-slate-700">{caseRow.currentStepName}</span><span className="shrink-0 text-muted-foreground">{progress}%</span></div><Progress value={progress} className="h-1.5" /></div>
                  <div className="grid grid-cols-4 gap-1.5"><CompactInfo label="Expiry" value={caseRow.expiryDate || '-'} /><CompactInfo label="Owner" value={caseRow.assigneeNames.join(', ') || 'Unassigned'} /><CompactInfo label="TAT" value={tat.label} danger={tat.overdue} /><CompactInfo label="Priority" value={caseRow.priority} /></div>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-full bg-white text-xs" onClick={(event) => { event.stopPropagation(); setSelectedCaseId(caseRow.id); }}>Open Workflow</Button>
                </CardContent>
              </Card>;
            })}
          </div>

          <Card className="vm-panel hidden overflow-hidden md:block">
            <Table containerClassName="max-w-full">
              <TableHeader className="bg-slate-50/90">
                <TableRow className="hover:bg-slate-50/90">
                  <TableHead className="h-9 min-w-[150px] px-3 text-[11px]">Vehicle / Policy</TableHead>
                  <TableHead className="h-9 min-w-[140px] px-3 text-[11px]">Insurer</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px]">Expiry</TableHead>
                  <TableHead className="h-9 min-w-[150px] px-3 text-[11px]">Current Stage</TableHead>
                  <TableHead className="h-9 min-w-[135px] px-3 text-[11px]">Owner</TableHead>
                  <TableHead className="h-9 min-w-[120px] px-3 text-[11px]">Progress</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-[11px]">TAT</TableHead>
                  <TableHead className="h-9 px-3 text-[11px]">Priority</TableHead>
                  <TableHead className="h-9 px-3 text-[11px]">Status</TableHead>
                  <TableHead className="h-9 min-w-[135px] whitespace-nowrap px-3 text-[11px]">Created Time</TableHead>
                  <TableHead className="h-9 px-3 text-right text-[11px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflowPagination.paginatedRows.map((caseRow) => {
                  const tat = insuranceWorkflowDeadlineMeta(caseRow.workflowDeadline);
                  const progress = insuranceWorkflowProgress(caseRow);
                  return <TableRow key={caseRow.id} className={cn('cursor-pointer bg-white', tat.overdue && 'bg-rose-50/40')} onClick={() => setSelectedCaseId(caseRow.id)}>
                    <TableCell className="px-3 py-2"><p className="max-w-[155px] truncate text-xs font-semibold text-slate-900">{caseRow.vehicleNumber || 'Unlinked Vehicle'}</p><p className="max-w-[155px] truncate text-[10px] text-muted-foreground">{caseRow.policyNumber || '-'}</p></TableCell>
                    <TableCell className="max-w-[170px] truncate px-3 py-2 text-xs" title={caseRow.insuranceCompany || '-'}>{caseRow.insuranceCompany || '-'}</TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{caseRow.expiryDate || '-'}</TableCell>
                    <TableCell className="max-w-[170px] truncate px-3 py-2 text-xs font-medium" title={caseRow.currentStepName}>{caseRow.currentStepName}</TableCell>
                    <TableCell className="max-w-[150px] truncate px-3 py-2 text-xs" title={caseRow.assigneeNames.join(', ') || 'Unassigned'}>{caseRow.assigneeNames.join(', ') || 'Unassigned'}</TableCell>
                    <TableCell className="px-3 py-2"><div className="flex items-center gap-2"><Progress value={progress} className="h-1.5 w-16" /><span className="text-[10px] text-muted-foreground">{progress}%</span></div></TableCell>
                    <TableCell className={cn('whitespace-nowrap px-3 py-2 text-xs font-medium', tat.overdue && 'text-rose-700')}>{tat.label}</TableCell>
                    <TableCell className="px-3 py-2"><PriorityBadge priority={caseRow.priority} /></TableCell>
                    <TableCell className="px-3 py-2"><StatusBadge status={caseRow.status} /></TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-[11px] text-muted-foreground">{formatVehicleTimestamp(caseRow.createdAt)}</TableCell>
                    <TableCell className="px-3 py-2 text-right"><Button type="button" variant="outline" size="sm" className="h-7 bg-white px-2.5 text-[11px]" onClick={(event) => { event.stopPropagation(); setSelectedCaseId(caseRow.id); }}>Open</Button></TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
          </Card>

          <VehicleTablePagination currentPage={workflowPagination.currentPage} totalPages={workflowPagination.totalPages} totalRows={filteredCases.length} pageSize={workflowPagination.pageSize} onPageChange={workflowPagination.setCurrentPage} />
        </div>
      )}

      <Dialog open={!!selectedCase} onOpenChange={(open) => { if (!open) { setSelectedCaseId(''); setSelectedAction(''); setComment(''); setSupportingDocument(null); setProposedPremiumText(''); setReassignUserId(''); } }}>
        <DialogContent size="default" className="vm-mobile-dialog flex max-h-[88dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {selectedCase && <>
            <DialogHeader className="shrink-0 border-b bg-gradient-to-r from-violet-50 via-white to-cyan-50 px-4 py-3 pr-12"><DialogTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-violet-600" />{selectedCase.vehicleNumber || selectedCase.policyNumber}</DialogTitle><DialogDescription className="truncate text-xs">{selectedCase.policyNumber} · {selectedCase.insuranceCompany} · expires {selectedCase.expiryDate}</DialogDescription></DialogHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-3">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Policy Details</p><PriorityBadge priority={selectedCase.priority} /></div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"><CompactInfo label="Policy Number" value={selectedCase.policyNumber || '-'} /><CompactInfo label="Insurance Company" value={selectedCase.insuranceCompany || '-'} /><CompactInfo label="Policy Type" value={selectedCase.policyType || '-'} /><CompactInfo label="Expiry Date" value={selectedCase.expiryDate || '-'} /><CompactInfo label="Vehicle Number" value={selectedCase.vehicleNumber || '-'} /><CompactInfo label="Current Premium" value={new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(selectedCase.currentPremium || 0)} /></div>
              </section>

              <section className="rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50 to-white p-3">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600"><Clock3 className="h-3.5 w-3.5" />Current Stage</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{selectedCase.currentStepName}</p>{currentStep && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{currentStep.description}</p>}</div><StatusBadge status={selectedCase.status} /></div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4"><CompactInfo label="Owner" value={selectedCase.assigneeNames.join(', ') || 'Unassigned'} /><CompactInfo label="TAT" value={insuranceWorkflowDeadlineMeta(selectedCase.workflowDeadline).label} danger={insuranceWorkflowDeadlineMeta(selectedCase.workflowDeadline).overdue} /><CompactInfo label="Expiry" value={selectedCase.expiryDate || '-'} /><CompactInfo label="Premium" value={new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(selectedCase.proposedPremium || selectedCase.currentPremium || 0)} /></div>
                <div className="mt-2 flex items-center gap-2"><Progress value={insuranceWorkflowProgress(selectedCase)} className="h-1.5 flex-1" /><span className="text-[10px] font-medium text-muted-foreground">{selectedCase.currentStepIndex}/{selectedCase.totalSteps} stages</span></div>
              </section>

              {selectedCase.status === 'Ready for Renewal' && <section className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-emerald-900">Approved for policy renewal</p><p className="text-[11px] text-emerald-800">Upload and save the new policy to close this workflow.</p></div><Link href={selectedCase.renewalHref || '#'}><Button size="sm" className="h-8 w-full bg-emerald-600 text-xs hover:bg-emerald-700 sm:w-auto"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open Renewal</Button></Link></section>}

              {canManage && currentStep && INSURANCE_WORKFLOW_OPEN_STATUSES.includes(selectedCase.status) && selectedCase.status !== 'Ready for Renewal' && <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">Take Action</p>{selectedCase.acknowledgedAt && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[9px] text-emerald-700">Acknowledged</Badge>}</div>
                {availableActions.length ? <div className="mt-2 flex flex-wrap gap-1.5">{availableActions.map((action) => <Button key={action} size="sm" className="h-8 px-3 text-xs" variant={action === 'Reject' ? 'destructive' : action === 'Return' ? 'outline' : selectedAction === action ? 'default' : 'secondary'} onClick={() => setSelectedAction(action)}>{action}</Button>)}</div> : <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />All actions for this stage are completed.</div>}
                {selectedAction && <div className="mt-3 space-y-2">
                  {['Complete', 'Approve'].includes(selectedAction) && <Field label={field('proposedPremiumText').label}><Input type="number" min="0" value={proposedPremiumText} onChange={(event) => setProposedPremiumText(event.target.value)} placeholder="Enter quotation premium" className="h-9" /></Field>}
                  {currentStep.documentRequired && ['Complete', 'Approve'].includes(selectedAction) && <Field label={`${field('supportingDocument').label} *`}><div className="space-y-1.5"><label htmlFor="workflow-supporting-document" className={cn('flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors', supportingDocument ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-dashed border-slate-300 bg-slate-50 text-muted-foreground hover:border-violet-400 hover:bg-violet-50')}><Upload className="h-4 w-4 shrink-0" /><span className="truncate text-xs font-medium">{supportingDocument?.name || 'Choose a document to upload'}</span></label><input id="workflow-supporting-document" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" className="sr-only" onChange={(event) => setSupportingDocument(event.target.files?.[0] || null)} /><p className="text-[10px] text-muted-foreground">PDF, image, Word or Excel · Maximum 10 MB</p></div></Field>}
                  <Field label={['Return', 'Reject'].includes(selectedAction) ? `${field('comment').label} / reason *` : field('comment').label}><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add remarks for the audit trail" className="min-h-16" /></Field>
                  <Button size="sm" onClick={() => void performAction()} disabled={isWorking} className="h-9 w-full">{isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm {selectedAction}</Button>
                </div>
                }
              </section>}

              <Accordion type="multiple" className="rounded-xl border bg-white px-3">
                <AccordionItem value="progress"><AccordionTrigger className="py-2.5 text-sm hover:no-underline"><span>Workflow Progress</span></AccordionTrigger><AccordionContent className="space-y-1.5 pb-3">{config.steps.map((workflowStep, index) => { const complete = index < selectedCase.currentStepIndex || selectedCase.status === 'Completed'; const active = workflowStep.id === selectedCase.currentStepId && selectedCase.status !== 'Completed'; return <div key={workflowStep.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', active ? 'border-violet-200 bg-violet-50' : complete ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-slate-50/60')}><div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold', complete ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500')}>{complete ? '✓' : index + 1}</div><p className="min-w-0 flex-1 truncate text-xs font-medium">{workflowStep.name}</p><Badge variant="outline" className="shrink-0 bg-white text-[9px]">{workflowStep.tatHours}h</Badge></div>; })}</AccordionContent></AccordionItem>
                <AccordionItem value="details"><AccordionTrigger className="py-2.5 text-sm hover:no-underline"><span>More Details</span></AccordionTrigger><AccordionContent className="grid grid-cols-2 gap-1.5 pb-3"><Info label="Days to Expiry" value={String(selectedCase.daysToExpiry ?? '-')} /><Info label="Proposed Premium" value={new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(selectedCase.proposedPremium || selectedCase.currentPremium || 0)} /><Info label="Escalation" value={`Level ${selectedCase.escalationLevel || 0}`} /><Info label="Created" value={formatVehicleTimestamp(selectedCase.createdAt)} />{!!selectedCase.documentReferences?.length && <div className="col-span-2 mt-1 rounded-lg border border-slate-100 bg-slate-50 p-2"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Uploaded Documents</p><div className="space-y-1">{selectedCase.documentReferences.map((documentItem, index) => <a key={`${documentItem.reference}-${index}`} href={documentItem.reference} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-xs font-medium text-violet-700 hover:underline"><ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{documentItem.fileName || `Supporting document ${index + 1}`}</span></a>)}</div></div>}</AccordionContent></AccordionItem>
                {canManage && INSURANCE_WORKFLOW_OPEN_STATUSES.includes(selectedCase.status) && selectedCase.status !== 'Ready for Renewal' && <AccordionItem value="reassign"><AccordionTrigger className="py-2.5 text-sm hover:no-underline"><span className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-indigo-600" />Reassign Task</span></AccordionTrigger><AccordionContent className="space-y-2 pb-3"><Field label={`${field('reassignUserId').label} *`}><Select value={reassignUserId} onValueChange={setReassignUserId}><SelectTrigger className="h-9"><SelectValue placeholder="Select new owner" /></SelectTrigger><SelectContent>{activeUsers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name || item.email} {item.role ? `(${item.role})` : ''}</SelectItem>)}</SelectContent></Select></Field><Field label={field('comment').label}><Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Reason for reassignment" className="h-9" /></Field><Button size="sm" variant="outline" onClick={() => void reassign()} disabled={!reassignUserId || isWorking} className="h-9 w-full">Reassign Case</Button></AccordionContent></AccordionItem>}
                <AccordionItem value="history" className="border-b-0"><AccordionTrigger className="py-2.5 text-sm hover:no-underline"><span>Action History ({selectedCase.history?.length || 0})</span></AccordionTrigger><AccordionContent className="space-y-1.5 pb-3">{[...(selectedCase.history || [])].reverse().map((entry, index) => <div key={`${entry.action}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold">{entry.action} · {entry.stepName}</p><span className="shrink-0 text-[9px] text-muted-foreground">{formatVehicleTimestamp(entry.timestamp)}</span></div><p className="truncate text-[10px] text-muted-foreground" title={entry.comment}>{entry.userName}{entry.comment ? ` — ${entry.comment}` : ''}</p></div>)}{!selectedCase.history?.length && <p className="py-4 text-center text-xs text-muted-foreground">No workflow activity recorded.</p>}</AccordionContent></AccordionItem>
              </Accordion>
            </div>
            <DialogFooter className="shrink-0 border-t bg-white px-3 py-2"><Button variant="outline" size="sm" className="h-8" onClick={() => { setSelectedCaseId(''); setSelectedAction(''); setComment(''); setSupportingDocument(null); setReassignUserId(''); }}>Close</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof RefreshCw; tone: 'blue' | 'violet' | 'rose' | 'emerald' }) {
  const tones = { blue: 'border-blue-100 bg-blue-50 text-blue-700', violet: 'border-violet-100 bg-violet-50 text-violet-700', rose: 'border-rose-100 bg-rose-50 text-rose-700', emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700' };
  return <Card className={cn('border', tones[tone])}><CardContent className="flex items-center gap-2 p-2 sm:p-2.5"><div className="rounded-md bg-white/80 p-1.5"><Icon className="h-3.5 w-3.5" /></div><div className="min-w-0"><p className="truncate text-[9px] font-semibold uppercase tracking-wide sm:text-[10px]">{label}</p><p className="text-base font-bold leading-5">{value}</p></div></CardContent></Card>;
}

function Info({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className={cn('mt-0.5 truncate text-xs font-medium text-slate-700', danger && 'text-rose-700')} title={value}>{value}</p></div>;
}

function CompactInfo({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="min-w-0 rounded-md bg-slate-50 px-1.5 py-1.5"><p className="truncate text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className={cn('truncate text-[10px] font-medium text-slate-700', danger && 'text-rose-700')} title={value}>{value}</p></div>;
}

function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant="outline" className={cn('whitespace-nowrap text-[9px]', priority === 'Critical' ? 'border-rose-200 bg-rose-50 text-rose-700' : priority === 'High' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>{priority}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn('text-[10px]', status === 'Completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'Rejected' ? 'border-rose-200 bg-rose-50 text-rose-700' : status === 'Escalated' || status === 'Returned' ? 'border-amber-200 bg-amber-50 text-amber-700' : status === 'Ready for Renewal' ? 'border-cyan-200 bg-cyan-50 text-cyan-700' : 'border-violet-200 bg-violet-50 text-violet-700')}>{status}</Badge>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-semibold">{label}</Label>{children}</div>;
}
