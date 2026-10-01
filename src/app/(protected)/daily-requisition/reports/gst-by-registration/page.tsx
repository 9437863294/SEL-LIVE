'use client';

/**
 * GST & TDS by registration — what each of the company's own GSTINs carries.
 *
 * The company works across several states and holds one registration per state, but there is a
 * single payment window. Every payable bill therefore has to be attributed to the registration
 * whose return it belongs in, and the report has to keep the two sides of GST apart:
 *
 *   - **Input credit (ITC)** — GST a supplier charged on a normal purchase bill. The company claims
 *     it back. It sits on the credit side of GSTR-3B.
 *   - **Output payable (RCM)** — GST on a reverse-charge bill. The supplier charges nothing and the
 *     company pays the tax to the government itself, in cash, before claiming it.
 *
 * Those two are never added into one "GST" number: they fall on opposite sides of the return, and a
 * single total would read as credit the company does not have. TDS deducted is a third thing again —
 * money withheld from a supplier that the company must deposit, not a tax on the company.
 *
 * None of that arithmetic lives here. `src/lib/gst-registrations.ts` owns it (attribution chain,
 * per-registration totals, data-quality flags, TAN grouping) and is covered by
 * `tests/gst-registrations.test.mjs`; this page reads `dailyRequisitions`, shapes each row as a
 * `GstBill`, and renders what `summariseGst` returns.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Landmark,
  Receipt,
  Scale,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { chartChrome } from '@/components/ui/chart';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
import { DashboardPanel, Legend, useDashboardPalette } from '@/components/daily-requisition/dashboard-charts';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import { compactInr } from '@/lib/bank-balance-ledger';
import { exportWorkbook } from '@/lib/report-excel';
import { requisitionHref } from '@/lib/requisition-progress';
import { checkGstin, isValidPan } from '@/lib/statutory';
import {
  ATTRIBUTION_LABELS,
  UNATTRIBUTED,
  checkTreatment,
  flagTotal,
  summariseGst,
  type AttributionSource,
  type GstBill,
  type GstFlags,
  type GstRegistration,
  type RegistrationSummary,
} from '@/lib/gst-registrations';
import type { DailyRequisitionEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  ReportAccessDenied,
  ReportSkeleton,
  dateKeyOf,
  formatDay,
  inDateRange,
  inr,
  inrWhole,
  localDateKey,
  pctOf,
  round2,
} from '../_components/report-kit';

/** Radix Select cannot hold `''`, so every "no filter" option gets a sentinel. */
const ALL = '__all__';
/** The bucket for bills no attribution source could place — `UNATTRIBUTED` is `''`. */
const UNATTRIBUTED_OPTION = '__unattributed__';
const NO_PROJECT = '__no_project__';
const NO_DEPARTMENT = '__no_department__';

const GST_REGISTRATIONS_SETTINGS_HREF = '/expenses/settings/gst-registrations';

const num = (value: unknown) => Number(value) || 0;
const gstOf = (bill: GstBill) => round2(num(bill.cgst) + num(bill.sgst) + num(bill.igst));

/** A requisition as the GST summary reads it. Taxable is the gross; net is what the supplier is paid. */
function toBill(entry: DailyRequisitionEntry): GstBill {
  return {
    id: entry.id,
    ref: entry.receptionNo || entry.id,
    depNo: entry.depNo || '',
    dateKey: dateKeyOf(entry.date),
    partyName: entry.partyName || '',
    // The supplier's GSTIN, as GST & TDS verification recorded it.
    supplierGstin: entry.gstNo || '',
    projectId: entry.projectId || '',
    departmentId: entry.departmentId || '',
    // A per-bill override; read defensively until the field lands on the type.
    gstRegistrationId: entry.gstRegistrationId ?? '',
    gstType: entry.gstType,
    reverseCharge: Boolean(entry.reverseCharge),
    taxable: num(entry.grossAmount),
    cgst: num(entry.cgstAmount),
    sgst: num(entry.sgstAmount),
    igst: num(entry.igstAmount),
    tds: num(entry.tdsAmount),
    retention: num(entry.retentionAmount),
    other: num(entry.otherDeduction),
    net: num(entry.netAmount),
    invoiceNo: entry.invoiceNo || '',
    invoiceDate: entry.invoiceDate || '',
    panNo: entry.panNo || '',
    status: entry.status,
  };
}

/** What stops (or risks) a claim on one bill, in the words the data-quality panel uses. */
function issuesOf(bill: GstBill, registration: GstRegistration | null): string[] {
  const reasons: string[] = [];
  const gst = gstOf(bill);
  if (gst > 0 && !checkGstin(bill.supplierGstin).valid) {
    reasons.push(bill.supplierGstin ? `Supplier GSTIN ${bill.supplierGstin} is not a valid number` : 'No supplier GSTIN recorded');
  }
  if (gst > 0) {
    const noNumber = !bill.invoiceNo?.trim();
    const noDate = !bill.invoiceDate?.trim();
    if (noNumber && noDate) reasons.push('No invoice number or date');
    else if (noNumber) reasons.push('No invoice number');
    else if (noDate) reasons.push('No invoice date');
  }
  const treatment = checkTreatment(registration, bill.supplierGstin, bill.gstType);
  if (!treatment.ok) reasons.push(treatment.message ?? 'The CGST/SGST vs IGST split does not match the two states');
  if (num(bill.tds) > 0 && !isValidPan(bill.panNo)) reasons.push('TDS deducted without a valid PAN');
  return reasons;
}

/** Each flag in plain words, and whether it stops a claim outright or only risks one. */
const FLAG_NOTES: ReadonlyArray<{ key: keyof GstFlags; title: string; tone: 'blocks' | 'risk'; why: string }> = [
  {
    key: 'missingSupplierGstin',
    title: 'GST charged, no valid supplier GSTIN',
    tone: 'blocks',
    why: 'Input credit is claimed against the supplier’s registration. Without a valid GSTIN the invoice can never appear in GSTR-2B, so the credit cannot be taken at all.',
  },
  {
    key: 'missingInvoice',
    title: 'No invoice number or date',
    tone: 'blocks',
    why: 'A credit is matched invoice by invoice. With no number or date there is nothing to match against GSTR-2B, so the claim is not supportable even though the tax was paid.',
  },
  {
    key: 'treatmentMismatch',
    title: 'Wrong CGST/SGST vs IGST split',
    tone: 'risk',
    why: 'The supplier’s state and this registration’s state decide the heads. Tax paid under the wrong head is not credit under the right one — it has to be recovered from the supplier and re-invoiced.',
  },
  {
    key: 'tdsWithoutPan',
    title: 'TDS deducted without a valid PAN',
    tone: 'risk',
    why: 'Section 206AA forces deduction at the higher rate without a PAN, and the TDS return rejects a deductee row that has none — so the supplier never gets credit for what was withheld.',
  },
];

type SortKey = 'label' | 'bills' | 'taxable' | 'cgst' | 'sgst' | 'igst' | 'itc' | 'rcmOutput' | 'tds' | 'net';

const COMPARISON_COLUMNS: ReadonlyArray<{ key: SortKey; label: string; numeric: boolean; hint?: string }> = [
  { key: 'label', label: 'Registration', numeric: false },
  { key: 'bills', label: 'Bills', numeric: true },
  { key: 'taxable', label: 'Taxable', numeric: true },
  { key: 'cgst', label: 'CGST', numeric: true },
  { key: 'sgst', label: 'SGST', numeric: true },
  { key: 'igst', label: 'IGST', numeric: true },
  { key: 'itc', label: 'Input credit (ITC)', numeric: true, hint: 'Claimed back' },
  { key: 'rcmOutput', label: 'Output payable (RCM)', numeric: true, hint: 'Paid by the company' },
  { key: 'tds', label: 'TDS deducted', numeric: true },
  { key: 'net', label: 'Net paid', numeric: true },
];

/** One figure inside a registration card. */
function Figure({
  label,
  value,
  tone = 'plain',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'credit' | 'liability' | 'muted';
  hint?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border px-2.5 py-1.5',
        tone === 'credit' && 'border-emerald-200 bg-emerald-50/70',
        tone === 'liability' && 'border-orange-200 bg-orange-50/70',
        tone === 'plain' && 'border-slate-200 bg-white/70',
        tone === 'muted' && 'border-slate-200 bg-slate-50/70',
      )}
    >
      <div
        className={cn(
          'truncate text-[11px] font-medium uppercase tracking-wide',
          tone === 'credit' ? 'text-emerald-700' : tone === 'liability' ? 'text-orange-700' : 'text-slate-500',
        )}
      >
        {label}
      </div>
      {/* Whole rupees in a narrow tile; the comparison table and the drill-down give the paise. */}
      <div className="truncate text-sm font-semibold tabular-nums text-slate-900" title={value}>
        {value}
      </div>
      {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function GstByRegistrationReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  // Reports, or the GST registrations themselves. Entry Sheet is in the list because the module
  // sidebar offers every report to anyone who can open it (`dailyRequisitionAccess`), and a menu
  // must not offer a page that answers Access Denied — the same test the sibling reports make.
  const canView =
    can('View', 'Daily Requisition.Reports') ||
    can('View', 'Daily Requisition.Entry Sheet') ||
    can('View', 'Expenses.GST Registrations');
  const canExport = can('Export', 'Daily Requisition.Reports');

  const { doc: registrationsDoc, isLoading: isRegistrationsLoading } = useGstRegistrations();

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [departmentNames, setDepartmentNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // This month so far — the period a return is filed for. Local days: toISOString would give the
  // UTC day, which is a day (and on the 1st, a month) early here.
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [dateTo, setDateTo] = useState(() => localDateKey(new Date()));
  const [registrationFilter, setRegistrationFilter] = useState(ALL);
  const [projectFilter, setProjectFilter] = useState(ALL);
  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [rcmOnly, setRcmOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'taxable', dir: 'desc' });
  const [openRegistration, setOpenRegistration] = useState<string | null>(null);

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const [entriesSnap, projectsSnap, departmentsSnap] = await Promise.all([
          getDocs(collection(db, 'dailyRequisitions')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);
        if (!active) return;

        const projects: Record<string, string> = {};
        projectsSnap.docs.forEach((d) => {
          const data = d.data();
          projects[d.id] = (data.projectName as string) || (data.name as string) || d.id;
        });
        const departments: Record<string, string> = {};
        departmentsSnap.docs.forEach((d) => {
          departments[d.id] = (d.data().name as string) || d.id;
        });

        setProjectNames(projects);
        setDepartmentNames(departments);
        setEntries(entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load daily requisitions for GST by registration', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  /** Every payable bill. A cancelled requisition is no longer payable, so it is out of every return. */
  const allBills = useMemo(
    () => entries.filter((entry) => entry.status !== 'Cancelled').map(toBill),
    [entries],
  );

  const projectOptions = useMemo(() => {
    const ids = new Set(allBills.map((bill) => bill.projectId || ''));
    return [...ids]
      .filter(Boolean)
      .map((id) => ({ id, name: projectNames[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allBills, projectNames]);

  const departmentOptions = useMemo(() => {
    const ids = new Set(allBills.map((bill) => bill.departmentId || ''));
    return [...ids]
      .filter(Boolean)
      .map((id) => ({ id, name: departmentNames[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allBills, departmentNames]);

  /** Everything except the registration filter, which can only be applied once a bill is attributed. */
  const scopedBills = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allBills.filter((bill) => {
      if (!inDateRange(bill.dateKey, dateFrom, dateTo)) return false;
      if (projectFilter !== ALL) {
        const wanted = projectFilter === NO_PROJECT ? '' : projectFilter;
        if ((bill.projectId || '') !== wanted) return false;
      }
      if (departmentFilter !== ALL) {
        const wanted = departmentFilter === NO_DEPARTMENT ? '' : departmentFilter;
        if ((bill.departmentId || '') !== wanted) return false;
      }
      if (rcmOnly && !bill.reverseCharge) return false;
      if (!needle) return true;
      return [bill.ref, bill.depNo, bill.partyName, bill.invoiceNo, bill.supplierGstin]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [allBills, dateFrom, dateTo, projectFilter, departmentFilter, rcmOnly, search]);

  /** Attribution first, so the registration filter can select on its result. */
  const scopedSummary = useMemo(() => summariseGst(scopedBills, registrationsDoc), [scopedBills, registrationsDoc]);

  const targetRegistrationId =
    registrationFilter === ALL ? null : registrationFilter === UNATTRIBUTED_OPTION ? UNATTRIBUTED : registrationFilter;

  const bills = useMemo(() => {
    if (targetRegistrationId === null) return scopedBills;
    return scopedBills.filter(
      (bill) => (scopedSummary.attributionOf.get(bill.id)?.registrationId ?? UNATTRIBUTED) === targetRegistrationId,
    );
  }, [scopedBills, scopedSummary, targetRegistrationId]);

  const summary = useMemo(
    () => (targetRegistrationId === null ? scopedSummary : summariseGst(bills, registrationsDoc)),
    [targetRegistrationId, scopedSummary, bills, registrationsDoc],
  );

  /** Registrations in view: all of them, or the one the filter names. */
  const visibleRegistrations = useMemo(
    () =>
      targetRegistrationId === null
        ? summary.byRegistration
        : summary.byRegistration.filter((bucket) => bucket.registrationId === targetRegistrationId),
    [summary, targetRegistrationId],
  );

  const registrationById = useMemo(() => {
    const map = new Map<string, GstRegistration | null>();
    summary.byRegistration.forEach((bucket) => map.set(bucket.registrationId, bucket.registration));
    return map;
  }, [summary]);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    summary.byRegistration.forEach((bucket) => map.set(bucket.registrationId, bucket.label));
    return map;
  }, [summary]);

  const billsByRegistration = useMemo(() => {
    const map = new Map<string, GstBill[]>();
    bills.forEach((bill) => {
      const id = summary.attributionOf.get(bill.id)?.registrationId ?? UNATTRIBUTED;
      const list = map.get(id);
      if (list) list.push(bill);
      else map.set(id, [bill]);
    });
    map.forEach((list) => list.sort((a, b) => (a.dateKey === b.dateKey ? a.ref.localeCompare(b.ref) : a.dateKey.localeCompare(b.dateKey))));
    return map;
  }, [bills, summary]);

  const company = summary.company;
  const companyFlags = summary.companyFlags;
  const totalFlags = flagTotal(companyFlags);
  const rcmBills = useMemo(() => bills.filter((bill) => bill.reverseCharge).length, [bills]);
  const itcBills = bills.length - rcmBills;

  const unattributed = visibleRegistrations.find((bucket) => bucket.registrationId === UNATTRIBUTED) ?? null;

  /** Bills with something wrong, newest first, with the reason in words. */
  const problemBills = useMemo(() => {
    const rows: Array<{ bill: GstBill; registrationLabel: string; reasons: string[] }> = [];
    bills.forEach((bill) => {
      const id = summary.attributionOf.get(bill.id)?.registrationId ?? UNATTRIBUTED;
      const reasons = issuesOf(bill, registrationById.get(id) ?? null);
      if (reasons.length) rows.push({ bill, registrationLabel: labelById.get(id) ?? 'Not attributed', reasons });
    });
    return rows.sort((a, b) => b.bill.dateKey.localeCompare(a.bill.dateKey));
  }, [bills, summary, registrationById, labelById]);

  const comparisonRows = useMemo(() => {
    const rows = [...visibleRegistrations];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const result =
        key === 'label'
          ? a.label.localeCompare(b.label)
          : (a.totals[key] as number) - (b.totals[key] as number);
      return dir === 'asc' ? result : -result;
    });
    return rows;
  }, [visibleRegistrations, sort]);

  const palette = useDashboardPalette();
  const chartData = useMemo(
    () =>
      visibleRegistrations
        .filter((bucket) => bucket.totals.itc > 0 || bucket.totals.rcmOutput > 0)
        .map((bucket) => ({
          id: bucket.registrationId,
          name: bucket.registrationId === UNATTRIBUTED ? 'Not attributed' : bucket.label,
          gstin: bucket.registration?.gstin ?? '',
          itc: bucket.totals.itc,
          rcmOutput: bucket.totals.rcmOutput,
          bills: bucket.totals.bills,
          // Labelled only where there is something to label, so a zero bar carries no "₹0".
          itcLabel: bucket.totals.itc > 0 ? compactInr(bucket.totals.itc) : '',
          rcmLabel: bucket.totals.rcmOutput > 0 ? compactInr(bucket.totals.rcmOutput) : '',
        }))
        .sort((a, b) => b.itc + b.rcmOutput - (a.itc + a.rcmOutput)),
    [visibleRegistrations],
  );

  const activeFilterCount =
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (registrationFilter !== ALL ? 1 : 0) +
    (projectFilter !== ALL ? 1 : 0) +
    (departmentFilter !== ALL ? 1 : 0) +
    (rcmOnly ? 1 : 0);

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setRegistrationFilter(ALL);
    setProjectFilter(ALL);
    setDepartmentFilter(ALL);
    setRcmOnly(false);
    setSearch('');
  };

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'label' ? 'asc' : 'desc' },
    );

  const exportExcel = async () => {
    if (!canExport || isExporting || bills.length === 0) return;
    setIsExporting(true);
    try {
      const summaryRows = visibleRegistrations.map((bucket) => ({
        Registration: bucket.registrationId === UNATTRIBUTED ? 'Not attributed' : bucket.label,
        GSTIN: bucket.registration?.gstin ?? '',
        State: bucket.registration?.stateName ?? '',
        TAN: bucket.registration?.tan ?? '',
        Bills: bucket.totals.bills,
        'Taxable value': round2(bucket.totals.taxable),
        CGST: round2(bucket.totals.cgst),
        SGST: round2(bucket.totals.sgst),
        IGST: round2(bucket.totals.igst),
        'Input credit (ITC)': round2(bucket.totals.itc),
        'RCM taxable value': round2(bucket.totals.rcmTaxable),
        'Output payable (RCM)': round2(bucket.totals.rcmOutput),
        'TDS deducted': round2(bucket.totals.tds),
        Retention: round2(bucket.totals.retention),
        'Other deductions': round2(bucket.totals.other),
        'Net paid': round2(bucket.totals.net),
        'Data-quality issues': flagTotal(bucket.flags),
      }));
      summaryRows.push({
        Registration: 'Company total',
        GSTIN: '',
        State: '',
        TAN: '',
        Bills: company.bills,
        'Taxable value': round2(company.taxable),
        CGST: round2(company.cgst),
        SGST: round2(company.sgst),
        IGST: round2(company.igst),
        'Input credit (ITC)': round2(company.itc),
        'RCM taxable value': round2(company.rcmTaxable),
        'Output payable (RCM)': round2(company.rcmOutput),
        'TDS deducted': round2(company.tds),
        Retention: round2(company.retention),
        'Other deductions': round2(company.other),
        'Net paid': round2(company.net),
        'Data-quality issues': totalFlags,
      });

      const billRows = bills.map((bill) => {
        const id = summary.attributionOf.get(bill.id)?.registrationId ?? UNATTRIBUTED;
        const registration = registrationById.get(id) ?? null;
        const gst = gstOf(bill);
        return {
          'Reception No': bill.ref,
          'DEP No': bill.depNo ?? '',
          Date: bill.dateKey,
          Registration: id === UNATTRIBUTED ? 'Not attributed' : labelById.get(id) ?? '',
          'Registration GSTIN': registration?.gstin ?? '',
          'Attributed by': summary.attributionOf.get(bill.id)?.reason ?? '',
          Party: bill.partyName,
          'Supplier GSTIN': bill.supplierGstin,
          'Invoice No': bill.invoiceNo ?? '',
          'Invoice Date': bill.invoiceDate ?? '',
          PAN: bill.panNo ?? '',
          'GST type': bill.gstType ?? '',
          'Reverse charge': bill.reverseCharge ? 'Yes' : 'No',
          'Taxable value': round2(bill.taxable),
          CGST: round2(bill.cgst),
          SGST: round2(bill.sgst),
          IGST: round2(bill.igst),
          'Input credit (ITC)': bill.reverseCharge ? 0 : gst,
          'Output payable (RCM)': bill.reverseCharge ? gst : 0,
          'TDS deducted': round2(bill.tds),
          Retention: round2(bill.retention),
          'Other deductions': round2(bill.other),
          'Net paid': round2(bill.net),
          Status: bill.status ?? '',
          Issues: issuesOf(bill, registration).join('; '),
        };
      });

      const suffix = `${dateFrom || 'all'}_to_${dateTo || 'all'}`;
      await exportWorkbook(`gst-by-registration-${suffix}.xlsx`, [
        {
          name: 'By registration',
          columns: Object.keys(summaryRows[0] ?? {}).map((header) => ({
            header,
            key: header,
            width: Math.min(40, Math.max(12, header.length + 4)),
          })),
          rows: summaryRows,
        },
        {
          name: 'Bills',
          columns: Object.keys(billRows[0] ?? {}).map((header) => ({
            header,
            key: header,
            width: Math.min(40, Math.max(12, header.length + 4)),
          })),
          rows: billRows,
        },
      ]);
    } catch (err) {
      console.error('Failed to export GST by registration', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || ((isLoading || isRegistrationsLoading) && canView)) return <ReportSkeleton panel strip />;

  if (!canView) {
    return (
      <ReportAccessDenied
        title="GST & TDS by Registration"
        description="Input credit, reverse-charge output and TDS under each of the company's own GSTINs."
        message="You need View on Daily Requisition Reports, or on Expenses GST Registrations, to open this report."
      />
    );
  }

  const hasRegistrations = registrationsDoc.registrations.length > 0;

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        eyebrow="Daily Requisition"
        title="GST & TDS by Registration"
        description="What each of the company's own GSTINs carries: input credit on purchase bills, output GST the company itself owes under reverse charge, and TDS withheld from suppliers. Cancelled requisitions are excluded — they are payable to nobody and belong in no return."
        backHref="/daily-requisition/reports"
        actions={
          canExport ? (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting || bills.length === 0}
              className="bg-white/80 hover:bg-white border-white/70"
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {isExporting ? 'Exporting…' : 'Export Excel'}
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        className="mb-5"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Reception no, DEP no, party, invoice no, GSTIN…',
          label: 'Search bills',
        }}
        activeCount={activeFilterCount}
        onClear={clearFilters}
        summary={`${bills.length} bill${bills.length === 1 ? '' : 's'} · ${itcBills} purchase · ${rcmBills} reverse charge`}
      >
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap text-sm text-muted-foreground">From</span>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap text-sm text-muted-foreground">To</span>
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <Select value={registrationFilter} onValueChange={setRegistrationFilter}>
          <SelectTrigger aria-label="Registration">
            <SelectValue placeholder="All registrations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All registrations</SelectItem>
            {registrationsDoc.registrations.map((registration) => (
              <SelectItem key={registration.id} value={registration.id}>
                {registration.label?.trim() || registration.stateName || registration.gstin}
              </SelectItem>
            ))}
            <SelectItem value={UNATTRIBUTED_OPTION}>Not attributed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger aria-label="Project">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
            <SelectItem value={NO_PROJECT}>(No project)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger aria-label="Department">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departmentOptions.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
            <SelectItem value={NO_DEPARTMENT}>(No department)</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="rcm-only" checked={rcmOnly} onCheckedChange={setRcmOnly} />
          <Label htmlFor="rcm-only" className="cursor-pointer whitespace-nowrap text-sm text-muted-foreground">
            Reverse charge only
          </Label>
        </div>
      </FilterBar>

      {!hasRegistrations && (
        <Card className={cn(dailySurfaceCardClass, 'mb-5 border-amber-300 bg-amber-50/70')}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              No GST registrations are set up yet
            </CardTitle>
            <CardDescription className="text-amber-800">
              Until the company&rsquo;s own GSTINs are listed, no bill can be attributed to a return. Every figure below sits in
              the &ldquo;Not attributed&rdquo; bucket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={GST_REGISTRATIONS_SETTINGS_HREF} className="text-sm font-medium text-amber-900 underline">
              Set up GST registrations
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Company totals. Five figures, three kinds of money — ITC and RCM output are deliberately
          not neighbours of one "GST" tile. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Taxable value"
          value={inrWhole(company.taxable)}
          hint={`${company.bills} bill${company.bills === 1 ? '' : 's'} in range`}
          icon={Scale}
          tone="indigo"
          accent
        />
        <KpiCard
          label="Input credit (ITC)"
          value={inrWhole(company.itc)}
          hint={`Claimable on ${itcBills} purchase bill${itcBills === 1 ? '' : 's'}`}
          icon={ArrowDownLeft}
          tone="emerald"
          accent
        />
        <KpiCard
          label="Output payable (RCM)"
          value={inrWhole(company.rcmOutput)}
          hint={`Owed by the company on ${rcmBills} bill${rcmBills === 1 ? '' : 's'}`}
          icon={ArrowUpRight}
          tone="orange"
          accent
        />
        <KpiCard
          label="TDS deducted"
          value={inrWhole(company.tds)}
          hint="Withheld from suppliers, to deposit"
          icon={Receipt}
          tone="violet"
          accent
        />
        <KpiCard
          label="Net paid"
          value={inrWhole(company.net)}
          hint={`${pctOf(company.net, company.taxable)} of taxable value`}
          icon={Banknote}
          tone="blue"
          accent
        />
      </div>

      {/* The two sides of the return, spelled out — the one thing this report exists to keep apart. */}
      <Card className={cn(dailySurfaceCardClass, 'mb-5')}>
        <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-slate-300 to-orange-400 opacity-80" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">The two sides of GST on this register</CardTitle>
          <CardDescription>
            Credit the company takes and tax the company pays are opposite sides of GSTR-3B. They are never added together —
            one total would read as credit that does not exist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-emerald-900">Input credit (ITC) — comes back</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-950">{inr(company.itc)}</div>
              <div className="mt-1 text-xs leading-relaxed text-emerald-900/80">
                GST the suppliers charged on {itcBills} purchase bill{itcBills === 1 ? '' : 's'} ({inrWhole(company.taxable - company.rcmTaxable)}{' '}
                taxable). The company claims this back, provided the supplier&rsquo;s GSTIN and invoice are on the bill.
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-orange-200 bg-orange-50/60 p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-orange-900">Output payable (RCM) — goes out</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-orange-950">{inr(company.rcmOutput)}</div>
              <div className="mt-1 text-xs leading-relaxed text-orange-900/80">
                On {rcmBills} reverse-charge bill{rcmBills === 1 ? '' : 's'} ({inrWhole(company.rcmTaxable)} taxable) the supplier charged
                nothing. The company deposits this GST itself, in cash, and may then claim it as credit.
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
              <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-xs leading-relaxed text-violet-900/90">
              <span className="font-semibold text-violet-900">TDS deducted {inr(company.tds)}</span> — a third kind of money
              again: income tax withheld from the suppliers&rsquo; payments, which the company deposits on their behalf and
              reports in its TDS return. It is not GST and belongs on neither side above.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* A card per registration. */}
      <section className="mb-5" aria-label="Per registration">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">By registration</h2>
          <span className="text-xs text-muted-foreground">
            {visibleRegistrations.length} registration{visibleRegistrations.length === 1 ? '' : 's'} in view
          </span>
        </div>
        {visibleRegistrations.length === 0 ? (
          <Card className={dailySurfaceCardClass}>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing to show for these filters.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleRegistrations.map((bucket) => (
              <RegistrationCard
                key={bucket.registrationId || 'unattributed'}
                bucket={bucket}
                open={openRegistration === bucket.registrationId}
                onToggle={() =>
                  setOpenRegistration((current) => (current === bucket.registrationId ? null : bucket.registrationId))
                }
              />
            ))}
          </div>
        )}
      </section>

      {unattributed && unattributed.totals.bills > 0 && (
        <Card className={cn(dailySurfaceCardClass, 'mb-5 border-amber-300 bg-amber-50/70')}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {unattributed.totals.bills} bill{unattributed.totals.bills === 1 ? '' : 's'} belong to no registration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-amber-900">
            <div>
              No attribution source could place {unattributed.totals.bills === 1 ? 'it' : 'them'}, so{' '}
              <span className="font-semibold tabular-nums">{inr(unattributed.totals.itc)}</span> of input credit,{' '}
              <span className="font-semibold tabular-nums">{inr(unattributed.totals.rcmOutput)}</span> of reverse-charge output
              and <span className="font-semibold tabular-nums">{inr(unattributed.totals.tds)}</span> of TDS will be missing from
              every return the company files. Give the projects or departments behind them a registration, or set a default one.
            </div>
            <Link href={GST_REGISTRATIONS_SETTINGS_HREF} className="inline-flex items-center gap-1 font-medium underline">
              Fix the attribution chain
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ITC vs RCM output per GSTIN. Two series of the same unit on one axis, grouped. */}
      <DashboardPanel
        className="mb-5"
        title="Input credit against reverse-charge output, by GSTIN"
        description="Credit the company claims beside tax it owes itself, for each registration. Same scale, one axis — the bars are comparable, the two columns of the return are not."
        icon={BarChart3}
        legend={
          <Legend
            items={[
              { label: 'Input credit (ITC)', color: palette.received },
              { label: 'Output payable (RCM)', color: palette.paid },
            ]}
          />
        }
      >
        {chartData.length === 0 ? (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground"
            style={{ height: 200 }}
          >
            <p className="max-w-xs px-4">No GST on any bill in range — nothing to claim and nothing owed.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 56 + 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }} barGap={2} barCategoryGap={12}>
              <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                stroke={chartChrome.axis}
                fontSize={11}
                tickLine={false}
                tickFormatter={(value) => compactInr(Number(value))}
              />
              <YAxis type="category" dataKey="name" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={132} interval={0} />
              <Tooltip
                cursor={chartChrome.cursor}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as (typeof chartData)[number] | undefined) : undefined;
                  if (!point) return null;
                  return (
                    <div style={chartChrome.tooltip.contentStyle} className="min-w-[210px] px-3 py-2 shadow-md">
                      <p className="text-xs font-semibold">{point.name}</p>
                      {point.gstin && <p className="mb-1 font-mono text-[11px] opacity-70">{point.gstin}</p>}
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between gap-4 text-xs">
                          <span className="inline-flex items-center gap-1.5 opacity-80">
                            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: palette.received }} />
                            Input credit (ITC)
                          </span>
                          <span className="font-semibold tabular-nums">{inr(point.itc)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-xs">
                          <span className="inline-flex items-center gap-1.5 opacity-80">
                            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: palette.paid }} />
                            Output payable (RCM)
                          </span>
                          <span className="font-semibold tabular-nums">{inr(point.rcmOutput)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-xs opacity-70">
                          <span>Bills</span>
                          <span className="tabular-nums">{point.bills.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="itc" fill={palette.received} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                <LabelList dataKey="itcLabel" position="right" fontSize={11} fill={chartChrome.axis} />
              </Bar>
              <Bar dataKey="rcmOutput" fill={palette.paid} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                <LabelList dataKey="rcmLabel" position="right" fontSize={11} fill={chartChrome.axis} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </DashboardPanel>

      {/* The same figures as a table, sortable — and the chart's accessible equivalent. */}
      <TableCard
        className="mb-5"
        title="Registration comparison"
        description="Every registration side by side. Click a column to sort."
        icon={Building2}
        count={comparisonRows.length}
        noun="registration"
      >
        {comparisonRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nothing to compare for these filters.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COMPARISON_COLUMNS.map((column) => (
                  <TableHead
                    key={column.key}
                    className={cn(column.numeric ? 'text-right' : '', column.key === 'label' ? 'min-w-[200px]' : 'min-w-[110px]')}
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        sort.key === column.key ? 'text-foreground' : 'text-muted-foreground',
                      )}
                      aria-label={`Sort by ${column.label}`}
                    >
                      <span className="whitespace-nowrap">{column.label}</span>
                      {sort.key === column.key ? (
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', sort.dir === 'asc' && 'rotate-180')} aria-hidden="true" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                    {column.hint && <div className="text-[10px] font-normal normal-case text-muted-foreground">{column.hint}</div>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonRows.map((bucket) => (
                <TableRow key={bucket.registrationId || 'unattributed'} className={bucket.registrationId === UNATTRIBUTED ? 'bg-amber-50/60' : undefined}>
                  <TableCell className="min-w-0">
                    <div className="truncate font-medium">{bucket.registrationId === UNATTRIBUTED ? 'Not attributed' : bucket.label}</div>
                    {bucket.registration?.gstin && (
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{bucket.registration.gstin}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{bucket.totals.bills.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.taxable)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.cgst)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.sgst)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.igst)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-emerald-700">{inr(bucket.totals.itc)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-orange-700">{inr(bucket.totals.rcmOutput)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.tds)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bucket.totals.net)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-medium">
                <TableCell>Company total</TableCell>
                <TableCell className="text-right tabular-nums">{company.bills.toLocaleString('en-IN')}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.taxable)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.cgst)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.sgst)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.igst)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{inr(company.itc)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-orange-700">{inr(company.rcmOutput)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.tds)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(company.net)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </TableCard>

      {/* TDS: per TAN when the registrations file separately, otherwise one company figure. */}
      <TdsSection
        grouping={registrationsDoc.attribution.tdsGrouping}
        byTan={summary.byTan}
        registrations={visibleRegistrations}
        companyTds={company.tds}
        companyBills={company.bills}
      />

      {/* Data quality: what blocks a claim, and which bills. */}
      <Card className={cn(dailySurfaceCardClass, 'mb-5')}>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Data quality
            <Badge variant={totalFlags > 0 ? 'warning' : 'success'}>
              {totalFlags === 0 ? 'All clear' : `${totalFlags} issue${totalFlags === 1 ? '' : 's'}`}
            </Badge>
          </CardTitle>
          <CardDescription>
            Each of these is something the return itself will not accept. Fixing them at GST &amp; TDS verification is cheaper
            than reversing a claim later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {FLAG_NOTES.map((note) => {
              const count = companyFlags[note.key];
              return (
                <div
                  key={note.key}
                  className={cn(
                    'min-w-0 rounded-xl border p-3',
                    count === 0
                      ? 'border-slate-200 bg-slate-50/60'
                      : note.tone === 'blocks'
                        ? 'border-rose-200 bg-rose-50/60'
                        : 'border-amber-200 bg-amber-50/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{note.title}</div>
                      <Badge variant={count === 0 ? 'neutral' : note.tone === 'blocks' ? 'danger' : 'warning'} className="mt-1">
                        {count === 0 ? 'None' : note.tone === 'blocks' ? 'Blocks the claim' : 'Puts the claim at risk'}
                      </Badge>
                    </div>
                    <span className={cn('shrink-0 text-2xl font-semibold tabular-nums', count === 0 ? 'text-slate-400' : 'text-slate-900')}>
                      {count}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{note.why}</div>
                </div>
              );
            })}
          </div>

          {problemBills.length > 0 && (
            <div className="min-w-0">
              <div className="mb-2 text-sm font-medium text-slate-700">
                {problemBills.length} bill{problemBills.length === 1 ? '' : 's'} to fix
              </div>
              <div className="min-w-0 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-slate-100 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Reception no</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Party</th>
                      <th className="px-3 py-2 font-medium">Registration</th>
                      <th className="px-3 py-2 font-medium">Why it is a problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemBills.slice(0, 50).map((row) => (
                      <tr key={row.bill.id} className="border-b last:border-0 align-top">
                        <td className="whitespace-nowrap px-3 py-2">
                          <Link href={requisitionHref(row.bill.ref)} className="font-mono text-primary hover:underline">
                            {row.bill.ref}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDay(row.bill.dateKey)}</td>
                        <td className="max-w-[200px] truncate px-3 py-2" title={row.bill.partyName}>
                          {row.bill.partyName}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground" title={row.registrationLabel}>
                          {row.registrationLabel}
                        </td>
                        <td className="px-3 py-2">
                          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                            {row.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {problemBills.length > 50 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Showing the 50 most recent. All {problemBills.length} are in the Excel export, with their reasons.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bill-level drill-down for whichever registration is open. */}
      {openRegistration !== null && (
        <BillTable
          label={openRegistration === UNATTRIBUTED ? 'Not attributed' : labelById.get(openRegistration) ?? 'Registration'}
          gstin={registrationById.get(openRegistration)?.gstin ?? ''}
          bills={billsByRegistration.get(openRegistration) ?? []}
          onClose={() => setOpenRegistration(null)}
        />
      )}
    </div>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────────────────────────── */

function RegistrationCard({
  bucket,
  open,
  onToggle,
}: {
  bucket: RegistrationSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const isUnattributed = bucket.registrationId === UNATTRIBUTED;
  const issues = flagTotal(bucket.flags);
  const sources = (Object.entries(bucket.bySource) as Array<[AttributionSource | 'none', number]>)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${count} ${source === 'none' ? 'unplaced' : ATTRIBUTION_LABELS[source].title.toLowerCase()}`);

  return (
    <Card
      className={cn(
        'min-w-0 border-white/60 bg-white/80 shadow-sm backdrop-blur-sm',
        isUnattributed && 'border-amber-300 bg-amber-50/70',
        open && 'ring-2 ring-primary/30',
      )}
    >
      <CardHeader className="space-y-1 p-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              {isUnattributed ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              ) : (
                <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="truncate">{isUnattributed ? 'Not attributed' : bucket.label}</span>
            </CardTitle>
            <div className="mt-0.5 min-w-0 text-xs text-muted-foreground">
              {bucket.registration ? (
                <>
                  <span className="font-mono">{bucket.registration.gstin}</span>
                  {bucket.registration.stateName && <span> · {bucket.registration.stateName}</span>}
                  {bucket.registration.tan && <span> · TAN {bucket.registration.tan}</span>}
                  {!bucket.registration.active && <span> · inactive</span>}
                </>
              ) : (
                <span>No registration — these bills are in no return</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{bucket.totals.bills} bill{bucket.totals.bills === 1 ? '' : 's'}</Badge>
            {issues > 0 && <Badge variant="warning">{issues} issue{issues === 1 ? '' : 's'}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-1">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label="Taxable" value={inrWhole(bucket.totals.taxable)} />
          <Figure label="CGST" value={inrWhole(bucket.totals.cgst)} tone="muted" />
          <Figure label="SGST" value={inrWhole(bucket.totals.sgst)} tone="muted" />
          <Figure label="IGST" value={inrWhole(bucket.totals.igst)} tone="muted" />
          <Figure label="Input credit (ITC)" value={inrWhole(bucket.totals.itc)} tone="credit" hint="Claimed back" />
          <Figure
            label="Output payable (RCM)"
            value={inrWhole(bucket.totals.rcmOutput)}
            tone="liability"
            hint={bucket.totals.rcmTaxable > 0 ? `on ${inrWhole(bucket.totals.rcmTaxable)}` : 'none'}
          />
          <Figure label="TDS deducted" value={inrWhole(bucket.totals.tds)} />
          <Figure label="Net paid" value={inrWhole(bucket.totals.net)} />
        </div>
        {sources.length > 0 && (
          <div className="text-[11px] leading-relaxed text-muted-foreground">Attributed by: {sources.join(' · ')}.</div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onToggle} className="w-auto gap-1.5" disabled={bucket.totals.bills === 0}>
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          {open ? 'Hide bills' : 'Show bills'}
        </Button>
      </CardContent>
    </Card>
  );
}

function TdsSection({
  grouping,
  byTan,
  registrations,
  companyTds,
  companyBills,
}: {
  grouping: 'company' | 'registration';
  byTan: ReadonlyArray<{ tan: string; labels: string[]; tds: number; bills: number }>;
  registrations: readonly RegistrationSummary[];
  companyTds: number;
  companyBills: number;
}) {
  const withTds = registrations.filter((bucket) => bucket.totals.tds > 0);

  return (
    <Card className={cn(dailySurfaceCardClass, 'mb-5')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          TDS deducted
        </CardTitle>
        <CardDescription>
          {grouping === 'registration'
            ? 'Each registration files its own TDS return, so the deduction is totalled per TAN — that is the figure the challan is paid against.'
            : 'TDS is filed for the company as a whole, under one TAN. The per-registration split below is for information only — it is not what the return is filed on.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grouping === 'registration' ? (
          byTan.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No TDS deducted in range.</div>
          ) : (
            <div className="min-w-0 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-100 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">TAN</th>
                    <th className="px-3 py-2 font-medium">Registrations filing under it</th>
                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                    <th className="px-3 py-2 text-right font-medium">TDS deducted</th>
                  </tr>
                </thead>
                <tbody>
                  {byTan.map((row) => (
                    <tr key={row.tan || 'no-tan'} className={cn('border-b last:border-0', !row.tan && 'bg-amber-50/60')}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                        {row.tan || <span className="font-sans text-amber-800">No TAN recorded</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.labels.join(', ')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.bills.toLocaleString('en-IN')}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{inr(row.tds)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/50 font-medium">
                    <td className="px-3 py-2" colSpan={2}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{companyBills.toLocaleString('en-IN')}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(companyTds)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div className="min-w-0 rounded-xl border border-violet-200 bg-violet-50/60 p-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-violet-700">Company-wide TDS, one TAN</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-950">{inr(companyTds)}</div>
              <div className="mt-1 text-xs leading-relaxed text-violet-900/80">
                Withheld from suppliers across {companyBills.toLocaleString('en-IN')} bill
                {companyBills === 1 ? '' : 's'} and deposited by the company on their behalf.
              </div>
            </div>
            {withTds.length > 0 && (
              <div className="min-w-0">
                <div className="mb-2 text-xs text-muted-foreground">Per registration, for information:</div>
                <div className="min-w-0 overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b bg-slate-100 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Registration</th>
                        <th className="px-3 py-2 text-right font-medium">Bills</th>
                        <th className="px-3 py-2 text-right font-medium">TDS deducted</th>
                        <th className="px-3 py-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withTds
                        .slice()
                        .sort((a, b) => b.totals.tds - a.totals.tds)
                        .map((bucket) => (
                          <tr key={bucket.registrationId || 'unattributed'} className="border-b last:border-0">
                            <td className="px-3 py-2">{bucket.registrationId === UNATTRIBUTED ? 'Not attributed' : bucket.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{bucket.totals.bills.toLocaleString('en-IN')}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(bucket.totals.tds)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pctOf(bucket.totals.tds, companyTds)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BillTable({
  label,
  gstin,
  bills,
  onClose,
}: {
  label: string;
  gstin: string;
  bills: readonly GstBill[];
  onClose: () => void;
}) {
  return (
    <TableCard
      className="mb-5"
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          <span>Bills under {label}</span>
          {gstin && <span className="font-mono text-xs font-normal text-muted-foreground">{gstin}</span>}
        </span>
      }
      description="Every bill this registration carries, as it will read in the return."
      icon={FileText}
      count={bills.length}
      noun="bill"
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {bills.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">No bills under this registration in range.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">Reception no</TableHead>
              <TableHead className="min-w-[110px]">Date</TableHead>
              <TableHead className="min-w-[180px]">Party</TableHead>
              <TableHead className="min-w-[150px]">Supplier GSTIN</TableHead>
              <TableHead className="min-w-[150px]">Invoice</TableHead>
              <TableHead className="min-w-[120px] text-right">Taxable</TableHead>
              <TableHead className="min-w-[100px] text-right">CGST</TableHead>
              <TableHead className="min-w-[100px] text-right">SGST</TableHead>
              <TableHead className="min-w-[100px] text-right">IGST</TableHead>
              <TableHead className="min-w-[90px]">RCM?</TableHead>
              <TableHead className="min-w-[110px] text-right">TDS</TableHead>
              <TableHead className="min-w-[120px] text-right">Net paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((bill) => (
              <TableRow key={bill.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={requisitionHref(bill.ref)} className="font-mono text-primary hover:underline">
                    {bill.ref}
                  </Link>
                  {bill.depNo && <div className="font-mono text-[11px] text-muted-foreground">{bill.depNo}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDay(bill.dateKey)}</TableCell>
                <TableCell className="min-w-0">
                  <span className="block max-w-[220px] truncate font-medium" title={bill.partyName}>
                    {bill.partyName}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {bill.supplierGstin || <span className="font-sans text-amber-700">Not recorded</span>}
                </TableCell>
                <TableCell className="min-w-0 text-xs">
                  {bill.invoiceNo ? (
                    <>
                      <span className="block max-w-[150px] truncate font-mono" title={bill.invoiceNo}>
                        {bill.invoiceNo}
                      </span>
                      <span className="text-muted-foreground">{bill.invoiceDate ? formatDay(bill.invoiceDate) : 'no date'}</span>
                    </>
                  ) : (
                    <span className="text-amber-700">Not recorded</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bill.taxable)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bill.cgst)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bill.sgst)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bill.igst)}</TableCell>
                <TableCell>
                  {bill.reverseCharge ? (
                    <Badge variant="warning">RCM output</Badge>
                  ) : (
                    <Badge variant="success">ITC</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(bill.tds)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{inr(bill.net)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
