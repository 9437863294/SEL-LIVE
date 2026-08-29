'use client';

/**
 * One employee, everything this system holds about them.
 *
 * The screen that makes the detail sync worth doing: without it the extra data sits in Firestore and
 * nobody can see it. Laid out by what somebody is actually looking for — who they are and where they
 * work, then their history, then the restricted block.
 *
 * ── The restricted block ────────────────────────────────────────────────────────────────────────
 *
 * Identity numbers, bank accounts, religion and disability status live in `employeeSensitive`, behind
 * `Employee.Personal Data · View`. Three things follow from that:
 *
 *   1. This component does not read that collection unless the viewer holds the permission — a
 *      Firestore read that will be denied is not a useful thing to attempt.
 *   2. Identifiers are **masked by default** even for permitted viewers. Seeing that a PAN is on file
 *      is the common need; seeing the digits is the rare one, and it takes a second permission
 *      (`View Unmasked`) plus a deliberate click.
 *   3. Nothing here is editable. greytHR is the system of record; this is a mirror, and an editable
 *      mirror invites two versions of somebody's Aadhaar number.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  Clock,
  CloudOff,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  FileBadge,
  FolderKanban,
  GraduationCap,
  Heart,
  Laptop,
  Lock,
  MapPin,
  Network,
  Phone,
  Plane,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import type { LeaveBalanceLine } from '@/lib/greythr';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import type { Employee } from '@/lib/types';
import {
  GREYTHR_ADDRESS_TYPES,
  GREYTHR_IDENTITY_CODES,
  attendanceLabel,
  hasSensitiveDetail,
  maskIdentifier,
  type EmployeeOperationalDetail,
  type EmployeeAttendanceSummary,
  type EmployeeLeaveBalance,
  type EmployeeSensitiveDetail,
  type GreytHRAddressType,
  type GreytHRIdentityCode,
} from '@/lib/greythr';
import { canViewEmployeeProfile, formatGrantDate } from '@/lib/access-control';
import {
  fetchEmployeeDocumentTree,
  fetchEmployeeProfile,
  openEmployeeDocument,
  type DocumentTreeResponse,
  type EmployeeProfileResponse,
} from '@/lib/greythr-sync-client';

type FullEmployee = Employee & EmployeeOperationalDetail;

/**
 * The leave-balance register, as the module's responsive list: a six-column table from `sm` up and
 * one card per leave type on a phone, with the balance — the number anybody asks for — as the aside.
 */
const LEAVE_COLUMNS: Array<HrListColumn<LeaveBalanceLine & { id: string }>> = [
  {
    header: 'Leave type',
    mobile: 'title',
    cell: (line) => (
      <span className="font-medium text-slate-800">
        {line.leaveType}
        {line.code && <span className="ml-1 text-[10px] font-normal text-slate-400">{line.code}</span>}
      </span>
    ),
  },
  { header: 'Opening', align: 'right', className: 'text-slate-600', cell: (line) => line.openingBalance },
  { header: 'Granted', align: 'right', className: 'text-slate-600', cell: (line) => line.granted },
  { header: 'Availed', align: 'right', className: 'text-slate-600', cell: (line) => line.availed },
  { header: 'Lapsed', align: 'right', className: 'text-slate-600', cell: (line) => line.lapsed },
  {
    header: 'Balance',
    align: 'right',
    mobile: 'aside',
    cell: (line) => (
      <span className={cn('font-semibold', line.balance < 0 ? 'text-destructive' : 'text-slate-800')}>
        {line.balance}
      </span>
    ),
  },
];

const STATE_TONE: Record<string, string> = {
  Active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Notice Period': 'border-amber-200 bg-amber-50 text-amber-800',
  Relieved: 'border-rose-200 bg-rose-50 text-rose-700',
  Retired: 'border-slate-200 bg-slate-100 text-slate-600',
  Settled: 'border-slate-200 bg-slate-100 text-slate-600',
  Left: 'border-rose-200 bg-rose-50 text-rose-700',
  Unknown: 'border-slate-300 bg-white text-slate-500',
};

const ADDRESS_LABELS: Record<GreytHRAddressType, string> = {
  presentaddress: 'Present address',
  permanentaddress: 'Permanent address',
  contactaddress: 'Contact address',
  emergencyaddress: 'Emergency contact',
  spouseaddress: 'Spouse address',
};

const IDENTITY_LABELS: Record<GreytHRIdentityCode, string> = {
  PAN: 'PAN',
  AADHAR: 'Aadhaar',
  PASSPORT: 'Passport',
  BANKACCNO: 'Bank account',
  PRAN: 'PRAN',
  NPR: 'NPR',
  LWF: 'LWF',
  DL: 'Driving licence',
  RC: 'Vehicle RC',
  EC: 'EC',
};

export function EmployeeProfile({ employeeId }: { employeeId: string }) {
  const { can, isLoading: authLoading } = useAuthorization();

  /**
   * Either namespace opens the profile — see `canViewEmployeeProfile` for why that is a fix rather
   * than laxity. The rule lives in `access-control.ts` so this screen and the route that feeds it
   * cannot disagree about who may open a profile.
   */
  const canView = canViewEmployeeProfile(can);
  const canViewPersonal = can('View', 'Employee.Personal Data');
  const canUnmask = can('View Unmasked', 'Employee.Personal Data');
  const canViewDocuments = can('View', 'Employee.Documents');
  const canDownloadDocuments = can('Download', 'Employee.Documents');

  const [employee, setEmployee] = useState<FullEmployee | null>(null);
  const [sensitive, setSensitive] = useState<EmployeeSensitiveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unmasked, setUnmasked] = useState(false);
  const [leave, setLeave] = useState<EmployeeLeaveBalance | null>(null);
  const [attendance, setAttendance] = useState<EmployeeAttendanceSummary | null>(null);
  /** How the record was resolved and whether greytHR answered — reported, not just used. */
  const [provenance, setProvenance] = useState<
    Pick<EmployeeProfileResponse, 'resolution' | 'live' | 'mirrorSyncedAt'> | null
  >(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Documents are fetched separately and lazily.
   *
   * They are proxied live from greytHR rather than mirrored, so the call is slower than a Firestore
   * read and is only worth making when somebody opens the tab — loading it with the profile would
   * make every page view pay for data most viewers never look at.
   */
  const [documents, setDocuments] = useState<DocumentTreeResponse | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');

  /**
   * The whole profile, in one call.
   *
   * This used to be four Firestore reads made from the browser, the first of which was
   * `getDoc(doc(db, 'employees', employeeId))` — a lookup by *document id*. Manage Employee links here
   * with greytHR's *employee id*, which is a different value for records the older flows created and
   * does not exist at all for someone greytHR employs that no sync has stored yet. Both cases landed
   * on "Employee not found" with a full record sitting in greytHR.
   *
   * The route now resolves the employee by document id, employee id or employee number, refreshes the
   * detail from greytHR's single-employee endpoints, and reports which of those happened — so a blank
   * field is attributable rather than mysterious.
   */
  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setLoadError(null);
      try {
        const result = await fetchEmployeeProfile(employeeId);
        setEmployee({ id: result.employee.employeeId, ...result.employee } as FullEmployee);
        setSensitive(result.sensitive);
        setLeave(result.leave);
        setAttendance(result.attendance);
        setProvenance({
          resolution: result.resolution,
          live: result.live,
          mirrorSyncedAt: result.mirrorSyncedAt,
        });
      } catch (error) {
        // Lands on the page rather than escaping as an unhandled rejection, which surfaces as a
        // Next.js error overlay and tells the reader nothing.
        setLoadError(
          error instanceof Error ? error.message : 'This employee record could not be loaded.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [employeeId],
  );

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, canView, load]);

  /**
   * The id greytHR itself answers to.
   *
   * Not necessarily the one in the URL: that is whatever the linking screen held, which for a legacy
   * record is a Firestore document id. The document proxy calls `emp-docs/{id}` upstream, so handing
   * it a document id returns nothing — the same mismatch that made this whole screen blank. Falls back
   * to the URL value, which is correct in the common case and all there is before the profile loads.
   */
  const greytHRId = provenance?.resolution.greytHRId || employee?.employeeId || employeeId;

  /** Documents, on demand. Errors land on the page rather than escaping as a rejection. */
  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      setDocuments(await fetchEmployeeDocumentTree(greytHRId));
    } catch (error) {
      setDocumentsError(error instanceof Error ? error.message : 'Documents could not be loaded.');
    } finally {
      setDocumentsLoading(false);
    }
  }, [greytHRId]);

  // Fetched when the tab is first opened, and not again unless refreshed — the proxy call is a
  // round trip to greytHR, so repeating it on every tab switch would be wasteful and slow.
  useEffect(() => {
    if (tab !== 'documents' || !canViewDocuments) return;
    if (documents || documentsLoading || documentsError) return;
    void loadDocuments();
  }, [tab, canViewDocuments, documents, documentsLoading, documentsError, loadDocuments]);

  const openDocument = useCallback(
    async (file: { documentId: string; fileId: string; name: string }) => {
      setOpeningFileId(file.fileId);
      setDocumentsError(null);
      try {
        await openEmployeeDocument(greytHRId, file);
      } catch (error) {
        setDocumentsError(error instanceof Error ? error.message : 'The document could not be opened.');
      } finally {
        setOpeningFileId(null);
      }
    },
    [greytHRId],
  );

  const show = useCallback(
    (value: string | undefined | null, alwaysMask = false): string => {
      if (!value) return '';
      if (alwaysMask && !(canUnmask && unmasked)) return maskIdentifier(value);
      return value;
    },
    [canUnmask, unmasked],
  );

  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Loading employee…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <BackLink />
        <HrAccessDenied what="employee records" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <BackLink />
        <HrEmptyState
          icon={ShieldAlert}
          title="Could not load this employee"
          description={loadError}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <BackLink />
        <HrEmptyState
          icon={UserRound}
          title="Employee not found"
          description="No employee matched this id, in the local mirror or in greytHR."
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const state = employee.employmentState ?? (employee.status === 'Active' ? 'Active' : 'Unknown');

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="relative">
        <BackLink />

        <HrPageHeader
          title={employee.name || employee.employeeNo || employee.employeeId}
          description={[employee.designation, employee.department, employee.projectName]
            .filter(Boolean)
            .join(' · ')}
          actions={
            <>
              <Badge variant="outline" className={cn('text-xs', STATE_TONE[state] ?? STATE_TONE.Unknown)}>
                {state}
              </Badge>
              {employee.employmentType && (
                <Badge variant="outline" className="text-xs text-slate-600">{employee.employmentType}</Badge>
              )}
              {/* Live-verified or mirror-only, stated rather than implied — the distinction this
                  screen could not previously draw at all. */}
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 text-xs',
                  provenance?.live.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800',
                )}
                title={
                  provenance?.live.ok
                    ? 'Refreshed from greytHR when this page loaded'
                    : (provenance?.live.error ?? 'Showing stored data')
                }
              >
                {provenance?.live.ok ? <ShieldCheck className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
                {provenance?.live.ok ? 'Live' : 'Stored'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7 bg-white/80 text-xs"
                onClick={() => void load('refresh')}
                disabled={refreshing}
              >
                <RefreshCw className={cn('mr-1 h-3.5 w-3.5', refreshing && 'animate-spin')} />
                Refresh
              </Button>
            </>
          }
        />

        {employee.employmentStateReason && state !== 'Active' && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            {employee.employmentStateReason}
          </div>
        )}

        {/*
          Where this record came from, when that changes what a blank field means.

          A field can be empty for three quite different reasons — greytHR holds nothing, the group is
          not being synced, or greytHR could not be reached — and a screen that renders all three
          identically invites somebody to conclude the data is missing when it is merely unread.
        */}
        {provenance?.resolution.awaitingSync && (
          <div className="mb-3">
            <HrAlertNotice tone="blue" title="Read straight from greytHR — not in the local mirror yet">
              No sync has written this employee here, so this page is showing greytHR&apos;s own answer.
              Everything below is current; the roster and reports that read the mirror will not list them
              until the next sync runs.
            </HrAlertNotice>
          </div>
        )}

        {provenance && !provenance.live.ok && (
          <div className="mb-3">
            <HrAlertNotice tone="amber" title="Showing stored data — not verified against greytHR">
              {provenance.live.error ?? 'greytHR could not be reached.'} These fields are whatever the
              last sync wrote
              {provenance.mirrorSyncedAt
                ? ` (${formatDistanceToNow(new Date(provenance.mirrorSyncedAt), { addSuffix: true })})`
                : ''}
              , so anything changed in greytHR since then is not reflected here.
            </HrAlertNotice>
          </div>
        )}

        {provenance && provenance.live.ok && provenance.live.unavailable.length > 0 && (
          <div className="mb-3">
            <HrAlertNotice
              tone="amber"
              title={`${provenance.live.unavailable.length} detail group(s) could not be read from greytHR`}
            >
              greytHR did not answer for {provenance.live.unavailable.join(', ')}. Those sections fall
              back to whatever the last sync stored, and are blank if it stored nothing — they are not
              evidence that greytHR holds nothing.
            </HrAlertNotice>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          {/* Six tabs will not fit a phone as a grid, so the strip scrolls horizontally — the same
              pattern the Access Control Center uses. Labels are nouns describing what is inside
              rather than where it came from. */}
          <ScrollArea className="w-full pb-1" showHorizontalScrollbar>
            <TabsList className="inline-flex w-max">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="work" className="text-xs">Employment</TabsTrigger>
              <TabsTrigger value="history" className="text-xs">Records</TabsTrigger>
              <TabsTrigger value="documents" className="text-xs">
                Documents
                {documents && documents.totalFiles > 0 && (
                  <Badge variant="outline" className="ml-1.5 border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                    {documents.totalFiles}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="timeoff" className="text-xs">Leave &amp; attendance</TabsTrigger>
              <TabsTrigger value="personal" className="text-xs">
                <Lock className="mr-1 h-3 w-3" />
                Personal
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="mt-3 space-y-3">
            <Section title="Identity" icon={UserRound}>
              <HrField label="Employee no.">{employee.employeeNo}</HrField>
              <HrField label="greytHR id">{employee.employeeId}</HrField>
              <HrField label="Name">{employee.name}</HrField>
              <HrField label="Nickname">{employee.nickname}</HrField>
              <HrField label="Email">{employee.email}</HrField>
              <HrField label="Mobile">{employee.phone}</HrField>
              <HrField label="Date of birth">{employee.dateOfBirth}</HrField>
              <HrField label="Gender">{employee.gender}</HrField>
              <HrField label="Blood group">
                {employee.bloodGroup ? (
                  <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-rose-700">
                    <Heart className="h-3 w-3" />
                    {employee.bloodGroup}
                  </Badge>
                ) : null}
              </HrField>
              <HrField label="Marital status">{employee.maritalStatus}</HrField>
              <HrField label="Spouse">{employee.spouseName}</HrField>
              <HrField label="Marriage date">{employee.marriageDate}</HrField>
            </Section>

            {(employee.emergencyContactName || employee.emergencyContactPhone) && (
              <Card className="border-rose-200 bg-rose-50/60 shadow-sm">
                <CardHeader className="px-4 py-3">
                  <CardTitle className="flex items-center gap-1.5 text-sm text-rose-900">
                    <Phone className="h-4 w-4" />
                    Emergency contact
                  </CardTitle>
                  <CardDescription className="text-xs text-rose-800">
                    Held outside the restricted block on purpose — the reason to have it is that
                    somebody may need it in a hurry.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                  <HrField label="Name">{employee.emergencyContactName}</HrField>
                  <HrField label="Phone">{employee.emergencyContactPhone}</HrField>
                </CardContent>
              </Card>
            )}

            {(employee.linkedIn || employee.twitter || employee.facebook || employee.biography) && (
              <Section title="Profile" icon={BadgeCheck}>
                <HrField label="Biography" className="sm:col-span-2 lg:col-span-4">
                  {employee.biography}
                </HrField>
                <HrField label="LinkedIn">{employee.linkedIn}</HrField>
                <HrField label="Twitter">{employee.twitter}</HrField>
                <HrField label="Facebook">{employee.facebook}</HrField>
              </Section>
            )}
          </TabsContent>

          {/* ── Work ── */}
          <TabsContent value="work" className="mt-3 space-y-3">
            <Section title="Position" icon={FolderKanban}>
              <HrField label="Designation">{employee.designation}</HrField>
              <HrField label="Department">{employee.department}</HrField>
              <HrField label="Grade">{employee.grade}</HrField>
              <HrField label="Location">{employee.location}</HrField>
              <HrField label="Project">{employee.projectName}</HrField>
              <HrField label="Project division">{employee.projectDivision}</HrField>
              <HrField label="Cost centre">{employee.costCenter}</HrField>
              <HrField label="Employee type">{employee.employeeType}</HrField>
              <HrField label="Company">{employee.company}</HrField>
            </Section>

            <Section title="Reporting" icon={Network}>
              <HrField label="Reporting manager">
                {employee.reportingManagerName ?? employee.reportingManagerEmployeeId}
              </HrField>
              <HrField label="Manager greytHR id">{employee.reportingManagerEmployeeId}</HrField>
            </Section>

            <Section title="Employment" icon={CalendarClock}>
              <HrField label="Date of joining">{employee.dateOfJoin}</HrField>
              <HrField label="Confirmation date">{employee.confirmDate}</HrField>
              <HrField label="Employment type">{employee.employmentType}</HrField>
              <HrField label="Notice period">
                {employee.noticePeriodDays ? `${employee.noticePeriodDays} days` : ''}
              </HrField>
              <HrField label="Resignation submitted">{employee.resignationDate}</HrField>
              <HrField label="Exit date">{employee.exitDate}</HrField>
              <HrField label="Leaving date">{employee.leavingDate}</HrField>
            </Section>

            {employee.categories && Object.keys(employee.categories).length > 0 && (
              <Section title="All greytHR categories" icon={Building2} columns="grid-cols-2 lg:grid-cols-3">
                {Object.entries(employee.categories).map(([category, value]) => (
                  <HrField key={category} label={category}>{value}</HrField>
                ))}
              </Section>
            )}
          </TabsContent>

          {/* ── Education & assets ── */}
          <TabsContent value="history" className="mt-3 space-y-3">
            <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <CardHeader className="px-4 py-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <GraduationCap className="h-4 w-4 text-indigo-600" />
                  Qualifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {employee.qualifications?.length ? (
                  employee.qualifications.map((qualification, index) => (
                    <div key={index} className="rounded-xl border border-white bg-white/80 px-3 py-2">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                        {qualification.description}
                        {qualification.level && (
                          <Badge variant="outline" className="text-[10px] text-slate-500">{qualification.level}</Badge>
                        )}
                        {qualification.current && (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                            Current
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[qualification.institute, qualification.university, qualification.year, qualification.grade]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing recorded in greytHR, or the Qualifications group is not being synced.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <CardHeader className="px-4 py-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Laptop className="h-4 w-4 text-indigo-600" />
                  Company assets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {employee.assets?.length ? (
                  employee.assets.map((asset, index) => (
                    <div key={index} className="rounded-xl border border-white bg-white/80 px-3 py-2">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                        {asset.assetType}
                        {asset.assetId && (
                          <Badge variant="outline" className="text-[10px] text-slate-500">{asset.assetId}</Badge>
                        )}
                        {asset.status && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              asset.returnedOn
                                ? 'border-slate-200 bg-slate-50 text-slate-600'
                                : 'border-amber-200 bg-amber-50 text-amber-800',
                            )}
                          >
                            {asset.status}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {asset.details}
                        {asset.issuedDate ? ` · issued ${formatGrantDate(asset.issuedDate)}` : ''}
                        {asset.validTill ? ` · due ${formatGrantDate(asset.validTill)}` : ''}
                        {asset.returnedOn ? ` · returned ${formatGrantDate(asset.returnedOn)}` : ''}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing recorded in greytHR, or the Company assets group is not being synced.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents ── */}
          <TabsContent value="documents" className="mt-3 space-y-3">
            {!canViewDocuments ? (
              <Card className="border-slate-200 bg-white/85 shadow-sm">
                <CardContent className="space-y-2 py-14 text-center">
                  <Lock className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="font-semibold text-slate-800">Restricted</p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Employee documents need the
                    <span className="font-medium"> Employee › Documents · View</span> permission.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5">
                  <p className="flex items-start gap-2 text-xs text-sky-900">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Read live from greytHR, never copied here — so this is always current and there is
                      no second copy of anybody&apos;s documents in this system.
                    </span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 bg-white/80 text-xs"
                    onClick={() => void loadDocuments()}
                    disabled={documentsLoading}
                  >
                    {documentsLoading ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    Refresh
                  </Button>
                </div>

                {documentsError && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {documentsError}
                  </div>
                )}

                {documentsLoading && !documents ? (
                  <Card className="border-white/60 bg-white/80">
                    <CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading documents from greytHR…
                    </CardContent>
                  </Card>
                ) : !documents?.categories.length ? (
                  <HrEmptyState
                    icon={FileText}
                    title="No documents on file"
                    description="greytHR holds no documents for this employee."
                  />
                ) : (
                  <>
                    {documents.categoriesAreUnnamed && (
                      <p className="px-1 text-[11px] text-muted-foreground">
                        greytHR provides no way to read back document category names, so categories are
                        shown by their id.
                      </p>
                    )}
                    {documents.categories.map((category) => (
                      <Card
                        key={category.categoryId}
                        className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm"
                      >
                        <CardHeader className="px-4 py-3">
                          <CardTitle className="flex items-center gap-1.5 text-sm">
                            <FolderOpen className="h-4 w-4 text-indigo-600" />
                            {category.label}
                            <Badge variant="outline" className="text-[10px] text-slate-500">
                              {category.files.length} file{category.files.length === 1 ? '' : 's'}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1.5 px-4 pb-4">
                          {category.files.map((file) => (
                            <div
                              key={file.fileId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white bg-white/80 px-2.5 py-2"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[9px] font-semibold uppercase text-slate-500">
                                  {file.extension || '?'}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                                  {file.createdAt && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Uploaded {new Date(file.createdAt).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 shrink-0 text-xs"
                                disabled={openingFileId === file.fileId || !canDownloadDocuments}
                                title={
                                  canDownloadDocuments
                                    ? 'Open in a new tab'
                                    : 'Downloading needs the Employee › Documents · Download permission'
                                }
                                onClick={() => void openDocument(file)}
                              >
                                {openingFileId === file.fileId ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="mr-1 h-3.5 w-3.5" />
                                )}
                                Open
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Leave & attendance ── */}
          <TabsContent value="timeoff" className="mt-3 space-y-3">
            <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <CardHeader className="px-4 py-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <CalendarDays className="h-4 w-4 text-indigo-600" />
                  Leave balance
                  {leave?.year && (
                    <Badge variant="outline" className="text-[10px] text-slate-500">{leave.year}</Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {leave
                    ? `As at ${new Date(leave.syncedAt).toLocaleString()}. greytHR is authoritative — this is a mirror.`
                    : 'Nothing synced. Enable the Leave balances group in greytHR Sync settings.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {leave?.lines.length ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                        {leave.totalBalance} day{leave.totalBalance === 1 ? '' : 's'} total
                      </Badge>
                    </div>
                    <HrDataList
                      rows={leave.lines.map((line) => ({ ...line, id: line.leaveTypeId }))}
                      columns={LEAVE_COLUMNS}
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No leave balance recorded for this employee.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <CardHeader className="px-4 py-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  Attendance summary
                </CardTitle>
                <CardDescription className="text-xs">
                  {attendance
                    ? `${attendance.periodStart} to ${attendance.periodEnd}. The daily muster is not synced — see the docs for why.`
                    : 'Nothing synced. Enable the Attendance summary group in greytHR Sync settings.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {attendance ? (
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(attendance.averages).map(([type, value]) => (
                      <HrField key={type} label={attendanceLabel(type)}>{value}</HrField>
                    ))}
                    {Object.entries(attendance.days).map(([type, value]) => (
                      <HrField key={type} label={attendanceLabel(type)}>
                        {value} day{value === 1 ? '' : 's'}
                      </HrField>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No attendance recorded for this employee in the current period.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Restricted personal data ── */}
          <TabsContent value="personal" className="mt-3 space-y-3">
            {!canViewPersonal ? (
              <Card className="border-slate-200 bg-white/85 shadow-sm">
                <CardContent className="space-y-2 py-14 text-center">
                  <Lock className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="font-semibold text-slate-800">Restricted</p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Identity documents, bank details, statutory information and home addresses need the
                    <span className="font-medium"> Employee › Personal Data · View</span> permission.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                  <p className="flex items-start gap-2 text-xs text-amber-900">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Special-category personal data, mirrored read-only from greytHR. Identifiers are
                      masked unless you reveal them.
                    </span>
                  </p>
                  {canUnmask && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 bg-white/80 text-xs"
                      onClick={() => setUnmasked((flag) => !flag)}
                    >
                      {unmasked ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                      {unmasked ? 'Hide numbers' : 'Reveal numbers'}
                    </Button>
                  )}
                </div>

                {!hasSensitiveDetail(sensitive) ? (
                  <HrEmptyState
                    icon={Lock}
                    title="No restricted data held for this employee"
                    description="Either greytHR has none on file, or the Statutory, Identity, Bank and Address groups are switched off in greytHR Sync settings — they are off by default."
                  />
                ) : (
                  <>
                    {sensitive?.identities && (
                      <Section title="Identity documents" icon={FileBadge} columns="grid-cols-1 sm:grid-cols-2">
                        {GREYTHR_IDENTITY_CODES.filter((code) => sensitive.identities?.[code]).map((code) => {
                          const identity = sensitive.identities![code]!;
                          return (
                            <HrField key={code} label={IDENTITY_LABELS[code]}>
                              <span className="font-mono">{show(identity.documentNo, true)}</span>
                              {identity.verified && (
                                <Badge variant="outline" className="ml-1.5 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                                  Verified
                                </Badge>
                              )}
                              {identity.expiryDate && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  expires {formatGrantDate(identity.expiryDate)}
                                </span>
                              )}
                            </HrField>
                          );
                        })}
                      </Section>
                    )}

                    {sensitive?.bank && (
                      <Section title="Bank, PF & ESI" icon={Banknote}>
                        <HrField label="Account number">
                          <span className="font-mono">{show(sensitive.bank.accountNumber, true)}</span>
                        </HrField>
                        <HrField label="Name as per bank">{sensitive.bank.nameAsPerBank}</HrField>
                        <HrField label="Bank">{sensitive.bank.bankName}</HrField>
                        <HrField label="Branch">{sensitive.bank.bankBranch}</HrField>
                        <HrField label="Branch code">{sensitive.bank.branchCode}</HrField>
                        <HrField label="Payment mode">{sensitive.bank.salaryPaymentMode}</HrField>
                        <HrField label="UAN">
                          <span className="font-mono">{show(sensitive.pf?.uan, true)}</span>
                        </HrField>
                        <HrField label="PF number">
                          <span className="font-mono">{show(sensitive.pf?.pfNumber, true)}</span>
                        </HrField>
                        <HrField label="ESI number">
                          <span className="font-mono">{show(sensitive.pf?.esiNumber, true)}</span>
                        </HrField>
                        <HrField label="PF eligible">{formatFlag(sensitive.pf?.pfEligible)}</HrField>
                        <HrField label="ESI eligible">{formatFlag(sensitive.pf?.esiEligible)}</HrField>
                        <HrField label="PF join date">{sensitive.pf?.pfJoinDate}</HrField>
                      </Section>
                    )}

                    {sensitive?.statutory && (
                      <Section title="Statutory details" icon={ShieldAlert}>
                        <HrField label="Father's name">{sensitive.statutory.fatherName}</HrField>
                        <HrField label="Mother's name">{sensitive.statutory.motherName}</HrField>
                        <HrField label="Birthplace">{sensitive.statutory.birthplace}</HrField>
                        <HrField label="Nationality">{sensitive.statutory.nationality}</HrField>
                        <HrField label="Religion">{sensitive.statutory.religion}</HrField>
                        <HrField label="Residential status">{sensitive.statutory.residentialStatus}</HrField>
                        <HrField label="Country of origin">{sensitive.statutory.countryOfOrigin}</HrField>
                        <HrField label="Disabled">{formatFlag(sensitive.statutory.disabled)}</HrField>
                        <HrField label="Disability type">{sensitive.statutory.disabilityType}</HrField>
                        <HrField label="Expatriate">{formatFlag(sensitive.statutory.expatriate)}</HrField>
                        <HrField label="Director">{formatFlag(sensitive.statutory.isDirector)}</HrField>
                      </Section>
                    )}

                    {sensitive?.addresses && (
                      <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
                        <CardHeader className="px-4 py-3">
                          <CardTitle className="flex items-center gap-1.5 text-sm">
                            <MapPin className="h-4 w-4 text-indigo-600" />
                            Addresses
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                          {GREYTHR_ADDRESS_TYPES.filter((type) => sensitive.addresses?.[type]).map((type) => {
                            const address = sensitive.addresses![type]!;
                            return (
                              <div key={type} className="rounded-xl border border-white bg-white/80 px-3 py-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {ADDRESS_LABELS[type]}
                                </p>
                                {address.name && <p className="text-sm font-medium text-slate-800">{address.name}</p>}
                                <p className="text-xs text-slate-700">
                                  {[address.line1, address.line2, address.line3, address.city, address.state, address.pin, address.country]
                                    .filter(Boolean)
                                    .join(', ') || '—'}
                                </p>
                                {(address.mobile || address.phone || address.email) && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {[address.mobile, address.phone, address.email].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    )}

                    {(sensitive?.passport || sensitive?.visa) && (
                      <Section title="Travel documents" icon={Plane}>
                        <HrField label="Passport number">
                          <span className="font-mono">{show(sensitive.passport?.passportNo, true)}</span>
                        </HrField>
                        <HrField label="Passport country">{sensitive.passport?.country}</HrField>
                        <HrField label="Issued">{sensitive.passport?.issueDate}</HrField>
                        <HrField label="Expires">{sensitive.passport?.expiryDate}</HrField>
                        <HrField label="Issue place">{sensitive.passport?.issuePlace}</HrField>
                        <HrField label="Visa country">{sensitive.visa?.country}</HrField>
                        <HrField label="Visa expires">{sensitive.visa?.expiryDate}</HrField>
                      </Section>
                    )}

                    <p className="px-1 text-[11px] text-muted-foreground">
                      Mirrored from greytHR
                      {sensitive?.syncedAt ? ` on ${new Date(sensitive.syncedAt).toLocaleString()}` : ''}. greytHR is
                      the system of record — change it there, not here.
                    </p>
                  </>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const formatFlag = (value: boolean | undefined): string =>
  value === true ? 'Yes' : value === false ? 'No' : '';

function BackLink() {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Link href="/employee/manage">
        <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </Link>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  columns = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  children,
}: {
  title: string;
  icon: React.ElementType;
  columns?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Icon className="h-4 w-4 text-indigo-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('grid gap-3 px-4 pb-4', columns)}>{children}</CardContent>
    </Card>
  );
}
