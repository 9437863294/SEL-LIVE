'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { LC_COLLECTIONS } from '@/lib/lc-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export default function LcDetailPage() {
  const { can } = useAuthorization();
  const canView =
    can('View', 'LC Management.LC Detail') ||
    can('View', 'LC Management.LC Request') ||
    can('View', 'LC Management.LC Opening');

  const [isLoading, setIsLoading] = useState(true);
  const [masterRows, setMasterRows] = useState<Record<string, any>[]>([]);
  const [docRows, setDocRows] = useState<Record<string, any>[]>([]);
  const [paymentRows, setPaymentRows] = useState<Record<string, any>[]>([]);
  const [amendmentRows, setAmendmentRows] = useState<Record<string, any>[]>([]);
  const [selectedLcNo, setSelectedLcNo] = useState('');

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

        const nextMaster: Record<string, any>[] = masterSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, any>),
        }));
        setMasterRows(nextMaster);
        setDocRows(
          docSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
        );
        setPaymentRows(
          paymentSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
        );
        setAmendmentRows(
          amendmentSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
        );

        const firstLcNo = String(nextMaster[0]?.lcNo || '');
        setSelectedLcNo((prev) => prev || firstLcNo);
      } catch (error) {
        console.error('Failed to load LC detail data', error);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const lcOptions = useMemo(
    () =>
      masterRows
        .map((row) => String(row.lcNo || '').trim())
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a)),
    [masterRows]
  );

  const selectedMaster = useMemo(
    () => masterRows.find((row) => String(row.lcNo || '').trim() === selectedLcNo) || null,
    [masterRows, selectedLcNo]
  );

  const selectedDocuments = useMemo(
    () => docRows.filter((row) => String(row.lcNo || '').trim() === selectedLcNo),
    [docRows, selectedLcNo]
  );

  const selectedPayments = useMemo(
    () => paymentRows.filter((row) => String(row.lcNo || '').trim() === selectedLcNo),
    [paymentRows, selectedLcNo]
  );

  const selectedAmendments = useMemo(
    () => amendmentRows.filter((row) => String(row.lcNo || '').trim() === selectedLcNo),
    [amendmentRows, selectedLcNo]
  );

  const paidAmount = useMemo(
    () => selectedPayments.reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0),
    [selectedPayments]
  );

  const outstanding = useMemo(() => {
    const lcAmount = Number(selectedMaster?.lcAmount || 0);
    return Number((lcAmount - paidAmount).toFixed(2));
  }, [paidAmount, selectedMaster?.lcAmount]);

  const accountingEntries = useMemo(() => {
    const lcAmount = Number(selectedMaster?.lcAmount || 0);
    const marginAmount = Number(selectedMaster?.marginAmount || 0);
    const bankCharges = Number(selectedMaster?.bankCharges || 0);
    const rows: Array<{ scenario: string; debit: string; credit: string; amount: number }> = [];

    if (marginAmount > 0) {
      rows.push({
        scenario: 'Margin money paid to bank',
        debit: 'LC Margin Money Account',
        credit: 'Bank Account',
        amount: marginAmount,
      });
    }
    if (bankCharges > 0) {
      rows.push({
        scenario: 'Bank charges for LC opening',
        debit: 'Bank Charges / LC Charges',
        credit: 'Bank Account',
        amount: bankCharges,
      });
    }
    if (lcAmount > 0) {
      rows.push({
        scenario: 'Supplier invoice booking',
        debit: 'Purchase / Inventory (+GST Input)',
        credit: 'Supplier Payable',
        amount: lcAmount,
      });
    }
    if (paidAmount > 0) {
      rows.push({
        scenario: 'Bank pays supplier under LC',
        debit: 'Supplier Payable',
        credit: 'LC Bank Liability / Bank Account',
        amount: paidAmount,
      });
    }
    if (String(selectedMaster?.status || '') === 'Closed' && marginAmount > 0) {
      rows.push({
        scenario: 'Margin money adjusted/released',
        debit: 'Bank / LC Settlement',
        credit: 'LC Margin Money Account',
        amount: marginAmount,
      });
    }
    return rows;
  }, [paidAmount, selectedMaster?.bankCharges, selectedMaster?.lcAmount, selectedMaster?.marginAmount, selectedMaster?.status]);

  const activityLog = useMemo(() => {
    const entries: Array<{ date: string; action: string; source: string; remarks: string }> = [];
    if (selectedMaster) {
      entries.push({
        date: String(selectedMaster.openingDate || selectedMaster.createdAt || ''),
        action: `LC status: ${selectedMaster.status || 'Draft'}`,
        source: 'LC Master',
        remarks: String(selectedMaster.remarks || ''),
      });
    }
    selectedDocuments.forEach((row) => {
      entries.push({
        date: String(row.uploadedDate || row.verificationDate || ''),
        action: `${row.documentName || 'Document'} ${row.verifiedStatus || 'Pending'}`,
        source: 'LC Documents',
        remarks: String(row.remarks || ''),
      });
    });
    selectedPayments.forEach((row) => {
      entries.push({
        date: String(row.paymentDate || ''),
        action: `Payment ${formatCurrency(Number(row.paymentAmount || 0), String(row.currency || selectedMaster?.currency || 'INR'))}`,
        source: 'LC Payments',
        remarks: String(row.remarks || ''),
      });
    });
    selectedAmendments.forEach((row) => {
      entries.push({
        date: String(row.createdAt || ''),
        action: `Amendment: ${row.amendmentType || ''} (${row.approvalStatus || ''})`,
        source: 'LC Amendments',
        remarks: String(row.reason || ''),
      });
    });
    return entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [selectedAmendments, selectedDocuments, selectedMaster, selectedPayments]);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view LC details.</CardDescription>
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
        <CardHeader>
          <CardTitle className="tracking-tight">LC Detail</CardTitle>
          <CardDescription>
            Full LC view with PO link, bank terms, documents, payment settlement, amendments and accounting closure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full max-w-sm space-y-1.5">
            <Label>Select LC No</Label>
            <Select value={selectedLcNo} onValueChange={setSelectedLcNo}>
              <SelectTrigger className="bg-white/80 border-white/70">
                <SelectValue placeholder="Select LC No" />
              </SelectTrigger>
              <SelectContent>
                {lcOptions.map((lcNo) => (
                  <SelectItem key={lcNo} value={lcNo}>
                    {lcNo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedMaster ? (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle>No LC Selected</CardTitle>
            <CardDescription>Select an LC number to load details.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="vm-panel">
              <CardHeader className="pb-2">
                <CardDescription>LC Amount</CardDescription>
                <CardTitle className="text-xl">
                  {formatCurrency(Number(selectedMaster.lcAmount || 0), String(selectedMaster.currency || 'INR'))}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="vm-panel">
              <CardHeader className="pb-2">
                <CardDescription>Paid Amount</CardDescription>
                <CardTitle className="text-xl">
                  {formatCurrency(paidAmount, String(selectedMaster.currency || 'INR'))}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="vm-panel">
              <CardHeader className="pb-2">
                <CardDescription>Outstanding</CardDescription>
                <CardTitle className="text-xl">
                  {formatCurrency(outstanding, String(selectedMaster.currency || 'INR'))}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="vm-panel">
              <CardHeader className="pb-2">
                <CardDescription>Status</CardDescription>
                <CardTitle className="text-xl">{String(selectedMaster.status || 'Draft')}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="vm-panel-strong">
              <CardHeader>
                <CardTitle className="text-lg">Master & PO Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">LC No</span><span>{selectedMaster.lcNo || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">LC Type</span><span>{selectedMaster.lcType || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Supplier</span><span>{selectedMaster.supplierName || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">PO No</span><span>{selectedMaster.purchaseOrderNo || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">PO Amount</span><span>{formatCurrency(Number(selectedMaster.purchaseOrderAmount || 0), String(selectedMaster.currency || 'INR'))}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Payment Terms</span><span>{selectedMaster.paymentTerms || '-'}</span></div>
              </CardContent>
            </Card>

            <Card className="vm-panel-strong">
              <CardHeader>
                <CardTitle className="text-lg">Bank Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Bank</span><span>{selectedMaster.bankName || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">LC Reference</span><span>{selectedMaster.bankLcReferenceNo || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Opening Date</span><span>{selectedMaster.openingDate || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Expiry Date</span><span>{selectedMaster.expiryDate || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Margin %</span><span>{selectedMaster.marginPercent || 0}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Margin Amount</span><span>{formatCurrency(Number(selectedMaster.marginAmount || 0), String(selectedMaster.currency || 'INR'))}</span></div>
              </CardContent>
            </Card>
          </div>

          <Card className="vm-panel-strong">
            <CardHeader>
              <CardTitle className="text-lg">Documents</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Document</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Upload Date</TableHead>
                    <TableHead>Verified By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDocuments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        No documents uploaded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedDocuments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.documentName || '-'}</TableCell>
                        <TableCell>{row.receivedStatus || '-'}</TableCell>
                        <TableCell>{row.verifiedStatus || '-'}</TableCell>
                        <TableCell>{row.uploadedDate || '-'}</TableCell>
                        <TableCell>{row.verifiedBy || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="vm-panel-strong">
            <CardHeader>
              <CardTitle className="text-lg">Payments</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Bank Ref</TableHead>
                    <TableHead>Debit</TableHead>
                    <TableHead>Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedPayments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        No payment entries.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedPayments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.paymentDate || '-'}</TableCell>
                        <TableCell>{formatCurrency(Number(row.paymentAmount || 0), String(row.currency || selectedMaster.currency || 'INR'))}</TableCell>
                        <TableCell>{row.bankReference || '-'}</TableCell>
                        <TableCell>{row.debitAccount || '-'}</TableCell>
                        <TableCell>{row.creditAccount || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="vm-panel-strong">
            <CardHeader>
              <CardTitle className="text-lg">Amendments</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Type</TableHead>
                    <TableHead>Old Value</TableHead>
                    <TableHead>New Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedAmendments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        No amendment entries.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedAmendments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.amendmentType || '-'}</TableCell>
                        <TableCell>{row.oldValue || '-'}</TableCell>
                        <TableCell>{row.newValue || '-'}</TableCell>
                        <TableCell>{row.approvalStatus || '-'}</TableCell>
                        <TableCell>{row.reason || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="vm-panel-strong">
            <CardHeader>
              <CardTitle className="text-lg">Accounting Entries (Suggested)</CardTitle>
              <CardDescription>Ledger names can be mapped to your chart of accounts.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto rounded-lg border border-white/70 bg-white/80">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Scenario</TableHead>
                    <TableHead>Debit</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountingEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        No accounting entry suggestion available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    accountingEntries.map((row, index) => (
                      <TableRow key={`${row.scenario}-${index}`}>
                        <TableCell>{row.scenario}</TableCell>
                        <TableCell>{row.debit}</TableCell>
                        <TableCell>{row.credit}</TableCell>
                        <TableCell>{formatCurrency(row.amount, String(selectedMaster.currency || 'INR'))}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="vm-panel-strong">
            <CardHeader>
              <CardTitle className="text-lg">Activity Log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activityLog.length === 0 ? (
                <div className="rounded-lg border border-white/70 bg-white/80 p-4 text-sm text-muted-foreground">
                  No activity available.
                </div>
              ) : (
                activityLog.map((entry, idx) => (
                  <div key={`${entry.source}-${idx}`} className="rounded-lg border border-white/70 bg-white/80 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{entry.action}</span>
                      <Badge variant="outline">{entry.source}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.date || '-'}</p>
                    {entry.remarks ? <p className="mt-1">{entry.remarks}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
