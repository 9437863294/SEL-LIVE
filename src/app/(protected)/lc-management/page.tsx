'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import {
  BarChart3,
  BookOpenCheck,
  FileText,
  Landmark,
  ListTree,
  PencilRuler,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { LC_COLLECTIONS, getDaysRemaining } from '@/lib/lc-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type CountCard = {
  label: string;
  description: string;
  href: string;
  collection: string;
  permission: string;
  icon: LucideIcon;
  gradient: string;
};

const cards: CountCard[] = [
  {
    label: 'LC Request',
    description: 'Create and track LC requests linked with PO and supplier.',
    href: '/lc-management/request',
    collection: LC_COLLECTIONS.master,
    permission: 'LC Request',
    icon: FileText,
    gradient: 'from-cyan-500/15 via-sky-500/10 to-blue-600/15',
  },
  {
    label: 'LC Opening',
    description: 'Capture bank reference, margin money, and opening details.',
    href: '/lc-management/opening',
    collection: LC_COLLECTIONS.master,
    permission: 'LC Opening',
    icon: Landmark,
    gradient: 'from-indigo-500/15 via-blue-500/10 to-cyan-500/15',
  },
  {
    label: 'LC Detail',
    description: 'Single LC full workflow view: documents, payments, amendments and accounting.',
    href: '/lc-management/detail',
    collection: LC_COLLECTIONS.master,
    permission: 'LC Detail',
    icon: ListTree,
    gradient: 'from-blue-500/15 via-indigo-500/10 to-cyan-500/15',
  },
  {
    label: 'LC Documents',
    description: 'Upload and verify mandatory supplier and bank documents.',
    href: '/lc-management/documents',
    collection: LC_COLLECTIONS.documents,
    permission: 'LC Documents',
    icon: BookOpenCheck,
    gradient: 'from-emerald-500/15 via-teal-500/10 to-cyan-500/15',
  },
  {
    label: 'LC Payments',
    description: 'Settle due amounts via bank and complete accounting closure.',
    href: '/lc-management/payments',
    collection: LC_COLLECTIONS.payments,
    permission: 'LC Payments',
    icon: Wallet,
    gradient: 'from-amber-500/15 via-orange-500/10 to-red-500/15',
  },
  {
    label: 'LC Amendments',
    description: 'Record amount/date/terms amendments with approval trail.',
    href: '/lc-management/amendments',
    collection: LC_COLLECTIONS.amendments,
    permission: 'LC Amendments',
    icon: PencilRuler,
    gradient: 'from-violet-500/15 via-indigo-500/10 to-blue-500/15',
  },
  {
    label: 'LC Reports',
    description: 'Bank exposure, outstanding, expiry and margin blocked reports.',
    href: '/lc-management/reports',
    collection: LC_COLLECTIONS.master,
    permission: 'LC Reports',
    icon: BarChart3,
    gradient: 'from-slate-500/15 via-zinc-400/10 to-gray-500/15',
  },
];

export default function LcManagementDashboardPage() {
  const { can } = useAuthorization();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [paymentDue, setPaymentDue] = useState(0);
  const mountedRef = useRef(true);

  const canViewSection = useCallback(
    (permission: string) =>
      can('View', `LC Management.${permission}`) ||
      can('Add', `LC Management.${permission}`) ||
      can('Edit', `LC Management.${permission}`),
    [can]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextCounts: Record<string, number> = {};
      await Promise.all(
        cards.map(async (item) => {
          if (!canViewSection(item.permission)) return;
          try {
            const snapshot = await getCountFromServer(collection(db, item.collection));
            nextCounts[`${item.collection}:${item.permission}`] = snapshot.data().count;
          } catch (error) {
            console.error('Failed count for', item.collection, error);
            nextCounts[`${item.collection}:${item.permission}`] = 0;
          }
        })
      );

      const masterSnap = await getDocs(collection(db, LC_COLLECTIONS.master));
      const nextStatusCounts: Record<string, number> = {};
      let nextExpiringSoon = 0;
      let nextPaymentDue = 0;

      masterSnap.docs.forEach((entry) => {
        const row = entry.data() as Record<string, any>;
        const status = String(row.status || 'Draft');
        nextStatusCounts[status] = (nextStatusCounts[status] || 0) + 1;

        const expiryDays = getDaysRemaining(String(row.expiryDate || ''));
        if (expiryDays !== null && expiryDays >= 0 && expiryDays <= 30) {
          nextExpiringSoon += 1;
        }
        const dueDays = getDaysRemaining(String(row.dueDate || ''));
        if (
          dueDays !== null &&
          dueDays <= 7 &&
          !['Payment Settled', 'Closed'].includes(status)
        ) {
          nextPaymentDue += 1;
        }
      });

      if (!mountedRef.current) return;
      setCounts(nextCounts);
      setStatusCounts(nextStatusCounts);
      setExpiringSoon(nextExpiringSoon);
      setPaymentDue(nextPaymentDue);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [canViewSection]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }, 120_000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  const visibleCards = useMemo(
    () => cards.filter((item) => canViewSection(item.permission)),
    [canViewSection]
  );

  const totalRecords = useMemo(
    () =>
      visibleCards.reduce(
        (sum, item) => sum + (counts[`${item.collection}:${item.permission}`] ?? 0),
        0
      ),
    [counts, visibleCards]
  );

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-blue-500/10 animate-bb-gradient" />
        <CardHeader className="relative">
          <CardTitle className="text-2xl tracking-tight">LC Management</CardTitle>
          <CardDescription>
            Complete LC workflow from request and bank opening to documents, settlement, and closure.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Visible Screens</p>
            <p className="mt-1 text-2xl font-semibold">{visibleCards.length}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Total Records</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : totalRecords}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Expiring in 30 Days</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : expiringSoon}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Payment Due (7 Days)</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : paymentDue}</p>
          </div>
        </CardContent>
      </Card>

      {Object.keys(statusCounts).length > 0 && (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle className="text-lg">LC Status Snapshot</CardTitle>
            <CardDescription>Live status mix across all LC records.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(statusCounts)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([status, count]) => (
                <Badge key={status} variant="outline" className="bg-white/80">
                  {status}: {count}
                </Badge>
              ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleCards.map((item, idx) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block h-full" aria-label={`Open ${item.label}`}>
              <Card
                className={cn(
                  'group relative h-full overflow-hidden vm-panel transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)]',
                  'vm-reveal cursor-pointer'
                )}
                style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
              >
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80', item.gradient)} />
                <CardHeader className="relative">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-cyan-100">
                    <Icon className="h-5 w-5 text-cyan-700 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="relative">
                  {isLoading ? (
                    <Skeleton className="h-6 w-20" />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {counts[`${item.collection}:${item.permission}`] ?? 0} records
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
