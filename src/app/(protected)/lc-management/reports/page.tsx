'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import { getDaysRemaining, getMandatoryDocumentNames, LC_COLLECTIONS } from '@/lib/lc-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const formatCurrency = (amount: number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

type LcRow = Record<string, any>;

export default function LcReportsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Reports');
  const canExport = can('Export', 'LC Management.LC Reports') || canView;
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [masterRows, setMasterRows] = useState<LcRow[]>([]);
  const [docRows, setDocRows] = useState<LcRow[]>([]);
  const [paymentRows, setPaymentRows] = useState<LcRow[]>([]);
  const [amendmentRows, setAmendmentRows] = useState<LcRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [masterSnap, docSnap, paymentSnap, amendmentSnap] = await Promise.all([
          getDocs(collection(db, LC_COLLECTIONS.master)),
          getDocs(collection(db, LC_COLLECTIONS.documents)),
          getDocs(collection(db, LC_COLLECTIONS.payments)),
          getDocs(collection(db, LC_COLLECTIONS.amendments)),
        ]);
        setMasterRows(masterSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDocRows(docSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPaymentRows(paymentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAmendmentRows(amendmentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to load LC reports', error);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const settledByLc = useMemo(() => {
    const table: Record<string, number> = {};
    paymentRows.forEach((row) => {
      const key = String(row.lcNo || '').trim();
      if (!key) return;
      table[key] = (table[key] || 0) + Number(row.paymentAmount || 0);
    });
    return table;
  }, [paymentRows]);

  const lcRegister = useMemo(
    () =>
      masterRows.map((row) => {
        const lcNo = String(row.lcNo || '');
        const lcAmount = Number(row.lcAmount || 0);
        const settled = Number(settledByLc[lcNo] || row.settledAmount || 0);
        const outstanding = Number((lcAmount - settled).toFixed(2));
        return {
          lcNo,
          supplierName: String(row.supplierName || '-'),
          bankName: String(row.bankName || '-'),
          purchaseOrderNo: String(row.purchaseOrderNo || '-'),
          lcAmount,
          settled,
          outstanding,
          currency: String(row.currency || 'INR'),
          expiryDate: String(row.expiryDate || ''),
          dueDate: String(row.dueDate || ''),
          status: String(row.status || 'Draft'),
          marginAmount: Number(row.marginAmount || 0),
          bankCharges: Number(row.bankCharges || 0),
        };
      }),
    [masterRows, settledByLc]
  );

  const openStatuses = new Set([
    'Draft',
    'Submitted',
    'Approved',
    'Sent to Bank',
    'LC Opened',
    'Shipment / Dispatch Done',
    'Documents Received',
    'Documents Verified',
    'Payment Due',
  ]);

  const openLcRows = useMemo(
    () => lcRegister.filter((row) => openStatuses.has(row.status)),
    [lcRegister]
  );

  const totals = useMemo(() => {
    const totalLcValue = lcRegister.reduce((sum, row) => sum + row.lcAmount, 0);
    const totalOutstanding = lcRegister.reduce((sum, row) => sum + Math.max(row.outstanding, 0), 0);
    const marginBlocked = openLcRows.reduce((sum, row) => sum + Number(row.marginAmount || 0), 0);
    const chargesFromMaster = lcRegister.reduce((sum, row) => sum + Number(row.bankCharges || 0), 0);
    const chargesFromAmendments = amendmentRows.reduce(
      (sum, row) => sum + Number(row.bankCharges || 0),
      0
    );
    return {
      totalLcValue,
      totalOutstanding,
      marginBlocked,
      totalCharges: chargesFromMaster + chargesFromAmendments,
    };
  }, [amendmentRows, lcRegister, openLcRows]);

  const bankWiseExposure = useMemo(() => {
    const table: Record<string, { bankName: string; openCount: number; openValue: number; outstanding: number }> = {};
    openLcRows.forEach((row) => {
      const key = row.bankName || 'Unassigned';
      if (!table[key]) {
        table[key] = { bankName: key, openCount: 0, openValue: 0, outstanding: 0 };
      }
      table[key].openCount += 1;
      table[key].openValue += row.lcAmount;
      table[key].outstanding += Math.max(row.outstanding, 0);
    });
    return Object.values(table).sort((a, b) => b.outstanding - a.outstanding);
  }, [openLcRows]);

  const expiryBuckets = useMemo(() => {
    const result = { d7: 0, d15: 0, d30: 0, expired: 0 };
    openLcRows.forEach((row) => {
      const days = getDaysRemaining(row.expiryDate);
      if (days === null) return;
      if (days < 0) result.expired += 1;
      if (days >= 0 && days <= 7) result.d7 += 1;
      if (days >= 0 && days <= 15) result.d15 += 1;
      if (days >= 0 && days <= 30) result.d30 += 1;
    });
    return result;
  }, [openLcRows]);

  const paymentDueRows = useMemo(
    () =>
      lcRegister
        .filter((row) => row.status !== 'Closed' && row.status !== 'Payment Settled')
        .filter((row) => {
          const days = getDaysRemaining(row.dueDate);
          return days !== null && days <= 15;
        })
        .sort((a, b) => (getDaysRemaining(a.dueDate) || 999) - (getDaysRemaining(b.dueDate) || 999)),
    [lcRegister]
  );

  const documentPendingRows = useMemo(() => {
    const docByLc: Record<string, LcRow[]> = {};
    docRows.forEach((row) => {
      const key = String(row.lcNo || '').trim();
      if (!key) return;
      if (!docByLc[key]) docByLc[key] = [];
      docByLc[key].push(row);
    });

    return lcRegister
      .map((lc) => {
        const docs = docByLc[lc.lcNo] || [];
        const requiredNames = getMandatoryDocumentNames(String(masterRows.find((m) => m.lcNo === lc.lcNo)?.lcType || 'Inland'));
        const verified = new Set(
          docs
            .filter((doc) => String(doc.verifiedStatus || '').toLowerCase() === 'verified')
            .map((doc) => String(doc.documentName || '').trim())
        );
        const missing = requiredNames.filter((name) => !verified.has(name));
        return {
          lcNo: lc.lcNo,
          supplierName: lc.supplierName,
          missing,
          status: lc.status,
        };
      })
      .filter((row) => row.missing.length > 0 && row.status !== 'Closed');
  }, [docRows, lcRegister, masterRows]);

  const exportWorkbook = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const registerSheet = workbook.addWorksheet('LC Register');
      registerSheet.columns = [
        { header: 'LC No', key: 'lcNo', width: 18 },
        { header: 'Supplier', key: 'supplierName', width: 24 },
        { header: 'PO No', key: 'purchaseOrderNo', width: 20 },
        { header: 'Bank', key: 'bankName', width: 18 },
        { header: 'LC Amount', key: 'lcAmount', width: 16 },
        { header: 'Settled', key: 'settled', width: 14 },
        { header: 'Outstanding', key: 'outstanding', width: 16 },
        { header: 'Expiry Date', key: 'expiryDate', width: 14 },
        { header: 'Due Date', key: 'dueDate', width: 14 },
        { header: 'Status', key: 'status', width: 20 },
      ];
      lcRegister.forEach((row) => registerSheet.addRow(row));

      const bankSheet = workbook.addWorksheet('Bank Exposure');
      bankSheet.columns = [
        { header: 'Bank', key: 'bankName', width: 24 },
        { header: 'Open LC Count', key: 'openCount', width: 14 },
        { header: 'Open LC Value', key: 'openValue', width: 18 },
        { header: 'Outstanding', key: 'outstanding', width: 18 },
      ];
      bankWiseExposure.forEach((row) => bankSheet.addRow(row));

      const dueSheet = workbook.addWorksheet('Payment Due');
      dueSheet.columns = [
        { header: 'LC No', key: 'lcNo', width: 18 },
        { header: 'Supplier', key: 'supplierName', width: 24 },
        { header: 'Due Date', key: 'dueDate', width: 14 },
        { header: 'Outstanding', key: 'outstanding', width: 16 },
        { header: 'Status', key: 'status', width: 20 },
      ];
      paymentDueRows.forEach((row) => dueSheet.addRow(row));

      const pendingDocSheet = workbook.addWorksheet('Document Pending');
      pendingDocSheet.columns = [
        { header: 'LC No', key: 'lcNo', width: 18 },
        { header: 'Supplier', key: 'supplierName', width: 24 },
        { header: 'Missing Documents', key: 'missingDocs', width: 60 },
      ];
      documentPendingRows.forEach((row) =>
        pendingDocSheet.addRow({
          lcNo: row.lcNo,
          supplierName: row.supplierName,
          missingDocs: row.missing.join(', '),
        })
      );

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lc-reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export LC reports', error);
    } finally {
      setIsExporting(false);
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view LC reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="tracking-tight">LC Reports</CardTitle>
            <CardDescription>
              Outstanding exposure, expiry and due reminders, bank-wise analysis, and document pending register.
            </CardDescription>
          </div>
          {canExport && (
            <Button
              variant="outline"
              onClick={exportWorkbook}
              disabled={isExporting}
              className="w-full bg-white/80 hover:bg-white md:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          )}
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total LC Value</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totals.totalLcValue)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-500/80 to-orange-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Outstanding</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totals.totalOutstanding)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-violet-500/80 to-indigo-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Margin Blocked</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totals.marginBlocked)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500/80 to-red-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total LC Charges</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totals.totalCharges)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Expiry Watch</CardTitle>
          <CardDescription>Open LCs expiring soon.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="destructive">Expired: {expiryBuckets.expired}</Badge>
          <Badge className="bg-rose-50 text-rose-700">7 Days: {expiryBuckets.d7}</Badge>
          <Badge className="bg-amber-50 text-amber-700">15 Days: {expiryBuckets.d15}</Badge>
          <Badge className="bg-emerald-50 text-emerald-700">30 Days: {expiryBuckets.d30}</Badge>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Bank-wise LC Exposure</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Bank</TableHead>
                <TableHead>Open LC Count</TableHead>
                <TableHead>Open LC Value</TableHead>
                <TableHead>Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankWiseExposure.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                    No open LC exposure.
                  </TableCell>
                </TableRow>
              ) : (
                bankWiseExposure.map((row) => (
                  <TableRow key={row.bankName}>
                    <TableCell className="font-medium">{row.bankName}</TableCell>
                    <TableCell>{row.openCount}</TableCell>
                    <TableCell>{formatCurrency(row.openValue)}</TableCell>
                    <TableCell>{formatCurrency(row.outstanding)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Payment Due Report (Next 15 Days)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>LC No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentDueRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No payment due in next 15 days.
                  </TableCell>
                </TableRow>
              ) : (
                paymentDueRows.map((row) => (
                  <TableRow key={`${row.lcNo}-${row.dueDate}`}>
                    <TableCell className="font-medium">{row.lcNo}</TableCell>
                    <TableCell>{row.supplierName}</TableCell>
                    <TableCell>{row.dueDate || '-'}</TableCell>
                    <TableCell>{formatCurrency(row.outstanding, row.currency)}</TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Document Pending Reminder</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>LC No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Missing Mandatory Documents</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documentPendingRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                    All mandatory documents verified.
                  </TableCell>
                </TableRow>
              ) : (
                documentPendingRows.map((row) => (
                  <TableRow key={row.lcNo}>
                    <TableCell className="font-medium">{row.lcNo}</TableCell>
                    <TableCell>{row.supplierName}</TableCell>
                    <TableCell>{row.missing.join(', ')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

