'use client';

/**
 * What needs renewing, and how it is drawn — shared by the Renewals Hub and the module overview.
 *
 * The overview already reads every compliance collection for its charts, so it builds these items
 * from the documents it has instead of fetching them again; the Renewals Hub reads them itself. Both
 * go through `toRenewalItem`, so an item that shows on one shows on the other, with the same link.
 */

import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, BadgeCheck, CheckCircle2, FileArchive, History, Landmark, Leaf, RefreshCw, ScrollText, Shield, Timer, User } from 'lucide-react';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import type { ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VM_PRIMARY_BUTTON, VM_TONES, type VmTone } from './vm-ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type ExpiryKind = 'expired' | 'dueSoon' | 'valid';

export interface RenewalItem {
  id: string;
  category: string;
  categoryIcon: React.ElementType;
  /** The section's colour, the same one it wears in the sidebar. */
  tone: VmTone;
  vehicleOrDriver: string;
  expiryDate: string;
  daysLeft: number;
  kind: ExpiryKind;
  href: string;
  historyHref: string;
  details: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source definitions
// ─────────────────────────────────────────────────────────────────────────────
export const RENEWAL_SOURCES = [
  {
    category: 'Insurance',
    icon: Shield,
    tone: 'violet' as VmTone,
    collection: VEHICLE_COLLECTIONS.insurance,
    dateKeys: ['expiryDate', 'validTill', 'endDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['policyNumber', 'insuranceCompany'],
    href: '/vehicle-management/insurance/workflow',
    permission: 'Insurance Management',
    requirementKey: 'insurance' as const,
  },
  {
    category: 'PUC',
    icon: Leaf,
    tone: 'green' as VmTone,
    collection: VEHICLE_COLLECTIONS.puc,
    dateKeys: ['expiryDate', 'validTill'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['pucCertificateNumber', 'testingCenterName'],
    href: '/vehicle-management/puc',
    permission: 'PUC Management',
    requirementKey: 'puc' as const,
  },
  {
    category: 'Fitness',
    icon: BadgeCheck,
    tone: 'indigo' as VmTone,
    collection: VEHICLE_COLLECTIONS.fitness,
    dateKeys: ['expiryDate', 'validTill'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['fitnessCertificateNumber', 'rtoName'],
    href: '/vehicle-management/fitness',
    permission: 'Fitness Certificate Management',
    requirementKey: 'fitness' as const,
  },
  {
    category: 'Road Tax',
    icon: Landmark,
    tone: 'amber' as VmTone,
    collection: VEHICLE_COLLECTIONS.roadTax,
    dateKeys: ['validTill', 'expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['receiptNumber', 'taxType', 'totalAmountPaid', 'amountPaid'],
    href: '/vehicle-management/road-tax',
    permission: 'Road Tax Management',
    requirementKey: 'roadTax' as const,
  },
  {
    category: 'Permits',
    icon: ScrollText,
    tone: 'orange' as VmTone,
    collection: VEHICLE_COLLECTIONS.permit,
    dateKeys: ['validTill', 'expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['permitNumber', 'permitType'],
    href: '/vehicle-management/permit',
    permission: 'Permit Management',
    requirementKey: 'permit' as const,
  },
  {
    category: 'Documents',
    icon: FileArchive,
    tone: 'slate' as VmTone,
    collection: VEHICLE_COLLECTIONS.documents,
    dateKeys: ['expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo'],
    detailKeys: ['documentType', 'documentNumber'],
    href: '/vehicle-management/documents',
    permission: 'Document Management',
    // Not covered by getVehicleComplianceRequirements — always evaluated as-is.
    requirementKey: null,
  },
  {
    category: 'Driver License',
    icon: User,
    tone: 'teal' as VmTone,
    collection: VEHICLE_COLLECTIONS.driver,
    dateKeys: ['licenseExpiryDate'],
    nameKeys: ['driverName', 'assignedVehicleNumber'],
    detailKeys: ['licenseNumber', 'licenseClass'],
    href: '/vehicle-management/driver',
    permission: 'Driver Management',
    requirementKey: null,
  },
] as const;

export type RenewalSource = (typeof RENEWAL_SOURCES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
/** A stored expiry as a local-midnight date: ISO first, then DD-MM-YYYY / DD/MM/YYYY. */
export const parseExpiry = (expiryDate: string): Date | null => {
  if (!expiryDate) return null;
  const direct = new Date(expiryDate);
  if (!Number.isNaN(direct.getTime())) {
    direct.setHours(0, 0, 0, 0);
    return direct;
  }
  const parts = expiryDate.replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    const [a, b, c] = parts;
    const maybeDdMmYyyy = new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`);
    if (!Number.isNaN(maybeDdMmYyyy.getTime())) {
      maybeDdMmYyyy.setHours(0, 0, 0, 0);
      return maybeDdMmYyyy;
    }
  }
  return null;
};

export const getDaysLeft = (expiryDate: string): number => {
  const target = parseExpiry(expiryDate);
  if (!target) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const formatExpiry = (expiryDate: string) => {
  const date = parseExpiry(expiryDate);
  return date ? format(date, 'dd MMM yyyy') : expiryDate || '—';
};

export const kindFromDays = (days: number): ExpiryKind => {
  if (days < 0) return 'expired';
  if (days <= 30) return 'dueSoon';
  return 'valid';
};

/**
 * One stored record as a renewal item, or `null` when it needs no renewal: archived, already
 * renewed, no expiry date, valid for more than 30 days, or a category its vehicle no longer needs
 * (Sold/Scrapped, or a manual "not required" flag) — a stale expiry on an old record shouldn't
 * surface as an alert once the vehicle no longer needs that compliance type.
 */
export function toRenewalItem(
  source: RenewalSource,
  docId: string,
  data: Record<string, any>,
  vehicleMap: Record<string, Record<string, any>>,
): RenewalItem | null {
  if (data.isArchived === true || data.renewalStatus === 'Renewed') return null;

  if (source.requirementKey) {
    const vehicle = vehicleMap[String(data.vehicleId || data.assignedVehicleId || '')];
    if (vehicle) {
      const required: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
      if (!required[source.requirementKey]) return null;
    }
  }

  const rawDate =
    source.dateKeys
      .map((key) => String(data[key] || '').trim())
      .find((value) => value.length > 0) || '';
  if (!rawDate) return null;
  const daysLeft = getDaysLeft(rawDate);
  const kind = kindFromDays(daysLeft);

  // Only expired or due soon (within 30 days) need renewing.
  if (kind === 'valid') return null;

  const resolvedName =
    source.nameKeys
      .map((key) => String(data[key] || '').trim())
      .find((value) => value.length > 0) || '—';
  const resolvedDetail =
    source.detailKeys
      .map((key) => String(data[key] || '').trim())
      .find((value) => value.length > 0) || '—';

  // The section's Renew flow, prefilled — see use-renewal-prefill.ts.
  const params = new URLSearchParams();
  params.set('renew', docId);
  if (data.vehicleId || data.assignedVehicleId) params.set('vid', String(data.vehicleId || data.assignedVehicleId));
  if (resolvedName && resolvedName !== '—') params.set('vnum', resolvedName);
  if (data.driverName) params.set('dname', String(data.driverName));

  return {
    id: `${source.collection}-${docId}`,
    category: source.category,
    categoryIcon: source.icon,
    tone: source.tone,
    vehicleOrDriver: resolvedName,
    expiryDate: rawDate,
    daysLeft,
    kind,
    href: `${source.href}?${params.toString()}`,
    // The section's own page, on its history tab. Built from the bare route: appending
    // `?tab=history` to the renew link above produced a second `?` and a broken query.
    historyHref: `${source.href}?tab=history`,
    details: resolvedDetail,
  };
}

/** Most urgent first: expired before due soon, then by days left. Sorts in place. */
export function sortRenewalItems(items: RenewalItem[]) {
  return items.sort((a, b) => {
    if (a.kind === 'expired' && b.kind !== 'expired') return -1;
    if (b.kind === 'expired' && a.kind !== 'expired') return 1;
    return a.daysLeft - b.daysLeft;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────────────────────
export function KindBadge({ kind, daysLeft }: { kind: ExpiryKind; daysLeft: number }) {
  if (kind === 'expired') {
    return (
      <StatusBadge status="Expired" tone="danger">
        <AlertTriangle className="h-3 w-3" />
        Expired {Math.abs(daysLeft)}d ago
      </StatusBadge>
    );
  }
  if (kind === 'dueSoon') {
    return (
      <StatusBadge status="Due Soon" tone="warning">
        <Timer className="h-3 w-3" />
        {daysLeft === 0 ? 'Due Today' : `${daysLeft}d left`}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge status="Valid" tone="success">
      <CheckCircle2 className="h-3 w-3" />
      Valid ({daysLeft}d)
    </StatusBadge>
  );
}

/** The register's columns — one spec, drawn as a table on a desktop and as cards on a phone. */
export function renewalColumns(): Array<ListColumn<RenewalItem>> {
  return [
    {
      header: 'Vehicle / Driver',
      mobile: 'title',
      cell: (item) => <span className="font-semibold text-slate-900">{item.vehicleOrDriver}</span>,
    },
    {
      header: 'Category',
      mobile: 'title',
      cell: (item) => {
        const Icon = item.categoryIcon;
        return (
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', VM_TONES[item.tone].text)} aria-hidden="true" />
            {item.category}
          </span>
        );
      },
    },
    {
      header: 'Reference',
      cell: (item) => <span className="text-slate-600">{item.details}</span>,
    },
    {
      header: 'Expiry Date',
      cell: (item) => <span className="tabular-nums text-slate-700">{formatExpiry(item.expiryDate)}</span>,
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (item) => <KindBadge kind={item.kind} daysLeft={item.daysLeft} />,
    },
    {
      header: 'Actions',
      align: 'right',
      mobile: 'footer',
      // On a phone card the links share the footer row at a full 44px tap height.
      cell: (item) => (
        <div className="flex w-full items-center justify-end gap-1.5 max-sm:[&>a]:h-11 max-sm:[&>a]:flex-1">
          <Button asChild size="sm" className={cn('h-8 gap-1.5 px-3 text-xs', VM_PRIMARY_BUTTON)}>
            <Link href={item.href}>
              <RefreshCw className="h-3 w-3" />
              Renew
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs">
            <Link href={item.historyHref} title={`${item.category} history`}>
              <History className="h-3 w-3" />
              History
            </Link>
          </Button>
        </div>
      ),
    },
  ];
}
