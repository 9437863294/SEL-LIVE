'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  AlertTriangle,
  Camera,
  Loader2,
  Plane,
  PlaneTakeoff,
  Plus,
  ReceiptIndianRupee,
  Trash2,
  Wallet,
} from 'lucide-react';
import { storage } from '@/lib/firebase-storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_MODES,
  TT_COLLECTIONS,
  calculateMileage,
  parseTravelDateTime,
  roundMoney,
  type ExpenseCategory,
  type ExpensePaymentMode,
  type OwnVehicleType,
  type TravelAdvance,
  type TravelClaim,
  type TravelExpense,
  type TravelRequest,
} from '@/lib/tour-travel';
import { TravelControlError, captureTravelExpense, deleteTravelExpense } from '@/lib/tour-travel-service';
import { useTravelActor, useTravelCollection, useTravelConfig, useTravelOrganization } from './use-travel-config';
import {
  Money,
  TravelEmptyState,
  TravelField,
  TravelLoader,
  TravelPageHeader,
  TravelSection,
  TravelStatusBadge,
  TravelDataList,
  travelDialog,
} from './travel-ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The employee's own travel screen (spec sections 14, 15, 28).
 *
 * Built for a phone first, because that is where it's used: the point of instant expense capture is
 * that a bill gets photographed and filed while the employee is still standing at the counter, not
 * reconstructed from a pocketful of receipts a week later. So the current tour and a single
 * prominent "Add Expense" action sit at the top, and everything else is behind tabs.
 *
 * Duplicate and out-of-window flags come back from `captureTravelExpense` and are shown immediately
 * on the saved expense rather than surfacing for the first time at verification — the employee is
 * the cheapest person to correct a mistake.
 */
export default function MyTravel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const actor = useTravelActor();
  const config = useTravelConfig();
  const { organizationId } = useTravelOrganization();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { records: allRequests, loading: requestsLoading } = useTravelCollection<TravelRequest>(TT_COLLECTIONS.requests);
  const { records: allAdvances } = useTravelCollection<TravelAdvance>(TT_COLLECTIONS.advances);
  const { records: allClaims } = useTravelCollection<TravelClaim>(TT_COLLECTIONS.claims);
  const { records: allExpenses } = useTravelCollection<TravelExpense>(TT_COLLECTIONS.expenses);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseTour, setExpenseTour] = useState<TravelRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Expense form
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [category, setCategory] = useState<ExpenseCategory>('Taxi');
  const [amount, setAmount] = useState<number | ''>('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [gstAmount, setGstAmount] = useState<number | ''>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [gstin, setGstin] = useState('');
  const [paymentMode, setPaymentMode] = useState<ExpensePaymentMode>('Cash');
  const [city, setCity] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [billAvailable, setBillAvailable] = useState(true);
  const [billFile, setBillFile] = useState<File | null>(null);

  // Mileage sub-form
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<OwnVehicleType>('car');
  const [startKm, setStartKm] = useState<number | ''>('');
  const [endKm, setEndKm] = useState<number | ''>('');

  const mine = useMemo(
    () => ({
      requests: allRequests.filter(request => request.employeeUserId === user?.id && !request.deleted),
      advances: allAdvances.filter(advance => advance.employeeUserId === user?.id),
      claims: allClaims.filter(claim => claim.employeeUserId === user?.id),
      expenses: allExpenses.filter(expense => expense.employeeUserId === user?.id && !expense.deleted),
    }),
    [allRequests, allAdvances, allClaims, allExpenses, user?.id],
  );

  /** The tour the employee is on right now, by itinerary window rather than by status flag. */
  const currentTour = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return (
      mine.requests.find(request => {
        if (!['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status)) return false;
        const from = parseTravelDateTime(request.departureDate);
        const to = parseTravelDateTime(request.returnDate);
        return !!from && !!to && from <= midnight && to >= midnight;
      }) ||
      // Falling back to any live tour means an employee whose dates slipped can still file expenses.
      mine.requests.find(request => ['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status)) ||
      null
    );
  }, [mine.requests]);

  const upcoming = useMemo(
    () =>
      mine.requests
        .filter(request => {
          const from = parseTravelDateTime(request.departureDate);
          return !!from && from > new Date() && !['CANCELLED', 'REJECTED', 'CLOSED'].includes(request.status);
        })
        .sort((a, b) => a.departureDate.localeCompare(b.departureDate)),
    [mine.requests],
  );

  const claimsDue = useMemo(
    () => mine.requests.filter(request => request.status === 'COMPLETED' && !request.claimId),
    [mine.requests],
  );

  const currentTourExpenses = useMemo(
    () => mine.expenses.filter(expense => expense.travelRequestId === currentTour?.id),
    [mine.expenses, currentTour?.id],
  );

  const currentTourAdvance = useMemo(() => {
    const open = mine.advances.filter(advance => advance.travelRequestId === currentTour?.id);
    return {
      paid: roundMoney(open.reduce((sum, advance) => sum + Number(advance.paidAmount || 0), 0)),
      outstanding: roundMoney(open.reduce((sum, advance) => sum + Math.max(0, Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0)), 0)),
    };
  }, [mine.advances, currentTour?.id]);

  const mileage = useMemo(() => {
    const entitlement = config.entitlementFor(currentTour?.grade || config.settings.general.defaultGrade, city);
    return calculateMileage({
      startKm: Number(startKm || 0),
      endKm: Number(endKm || 0),
      vehicleType,
      rates: entitlement?.mileage || { bike: 0, car: 0 },
    });
  }, [startKm, endKm, vehicleType, config, currentTour?.grade, city]);

  const resetExpenseForm = () => {
    setExpenseDate(todayIso());
    setCategory('Taxi');
    setAmount('');
    setVendor('');
    setDescription('');
    setGstAmount('');
    setInvoiceNumber('');
    setGstin('');
    setPaymentMode('Cash');
    setCity('');
    setQuantity('');
    setBillAvailable(true);
    setBillFile(null);
    setVehicleNumber('');
    setVehicleType('car');
    setStartKm('');
    setEndKm('');
  };

  const openExpenseDialog = (tour: TravelRequest) => {
    setExpenseTour(tour);
    resetExpenseForm();
    setCity(tour.itinerary?.[tour.itinerary.length - 1]?.toCity || '');
    setExpenseOpen(true);
  };

  const handleSaveExpense = async () => {
    if (!actor || !expenseTour) return;
    const isMileage = category === 'Mileage';
    const finalAmount = isMileage ? mileage.amount : Number(amount || 0);
    if (finalAmount <= 0) {
      toast({ variant: 'destructive', title: 'Enter an amount', description: isMileage ? 'Enter the odometer readings.' : 'Enter the expense amount.' });
      return;
    }

    setSaving(true);
    try {
      let billReference = '';
      let fileHash = '';
      if (billFile) {
        setUploading(true);
        const safeName = billFile.name.replace(/[^A-Za-z0-9._-]/g, '_');
        const path = `organizations/${organizationId}/tour-travel/${expenseTour.id}/bills/${Date.now()}-${safeName}`;
        const target = storageRef(storage, path);
        await uploadBytes(target, billFile);
        billReference = await getDownloadURL(target);
        // Size+name is a weak fingerprint, but it catches the common "uploaded the same photo twice"
        // case without reading the file into memory on a phone. A real content hash is Phase 4,
        // alongside OCR.
        fileHash = `${billFile.size}-${safeName}`;
        setUploading(false);
      }

      const result = await captureTravelExpense(
        {
          travelRequestId: expenseTour.id,
          expenseDate,
          category,
          amount: finalAmount,
          vendor,
          description: isMileage ? `${mileage.distanceKm} km × ${mileage.ratePerKm}/km` : description,
          gstAmount: Number(gstAmount || 0),
          invoiceNumber,
          invoiceDate: expenseDate,
          gstin,
          paymentMode,
          city,
          quantity: Number(quantity || 1),
          billAvailable,
          billReference,
          billFileName: billFile?.name,
          billFileType: billFile?.type,
          billFileSize: billFile?.size,
          fileHash,
          mileage: isMileage
            ? {
                vehicleNumber,
                vehicleType,
                startKm: Number(startKm || 0),
                endKm: Number(endKm || 0),
                distanceKm: mileage.distanceKm,
                ratePerKm: mileage.ratePerKm,
              }
            : null,
        },
        actor,
      );

      if (result.flags.length) {
        toast({
          title: 'Expense saved with flags',
          description: result.flags.join(' '),
        });
      } else {
        toast({ title: 'Expense saved' });
      }
      setExpenseOpen(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not save the expense',
        description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  if (requestsLoading || config.loading) return <TravelLoader label="Loading your travel…" />;

  const capturedTotal = roundMoney(currentTourExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0));

  return (
    <div className="space-y-4">
      <TravelPageHeader
        title="My Travel"
        description="Your tours, expenses, advances and claims."
        actions={
          <Button asChild className="gap-2 bg-gradient-to-r from-sky-500 to-cyan-600">
            <Link href="/tour-travel/requests/new">
              <PlaneTakeoff className="h-4 w-4" /> New Tour Request
            </Link>
          </Button>
        }
      />

      {claimsDue.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">
            {claimsDue.length} completed tour(s) need an expense claim
          </p>
          <p className="text-xs">
            Claims are due within {config.settings.general.claimSubmissionDeadlineDays} days of returning.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {claimsDue.map(request => (
              <Button key={request.id} asChild size="sm" variant="outline" className="h-7 bg-white px-2 text-xs">
                <Link href={`/tour-travel/requests/${request.id}`}>{request.referenceNumber}</Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ── Current tour card ────────────────────────────────────────────────────────────────── */}
      {currentTour ? (
        <TravelSection
          title="My Current Tour"
          description={`${currentTour.projectName || currentTour.tourType} · ${currentTour.departureDate} → ${currentTour.returnDate}`}
          actions={<TravelStatusBadge status={currentTour.status} />}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TravelField label="Reference">
              <Link href={`/tour-travel/requests/${currentTour.id}`} className="text-sky-700 hover:underline">
                {currentTour.referenceNumber}
              </Link>
            </TravelField>
            <TravelField label="Approved Budget"><Money value={currentTour.approvedAmount ?? currentTour.estimate?.total ?? 0} /></TravelField>
            <TravelField label="Advance Held"><Money value={currentTourAdvance.outstanding} /></TravelField>
            <TravelField label="Expenses Captured">
              <Money value={capturedTotal} />
              <span className="ml-1 text-xs text-muted-foreground">({currentTourExpenses.length})</span>
            </TravelField>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => openExpenseDialog(currentTour)} className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600">
              <Plus className="h-4 w-4" /> Add Expense
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/tour-travel/requests/${currentTour.id}`}>
                <Plane className="h-4 w-4" /> View Itinerary
              </Link>
            </Button>
          </div>

          {currentTourExpenses.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <TravelDataList
                rows={currentTourExpenses.slice().sort((a, b) => (b.expenseDate || '').localeCompare(a.expenseDate || ''))}
                rowClassName={expense => ((expense.flags?.length || 0) > 0 ? 'bg-amber-50/40 border-amber-200' : undefined)}
                columns={[
                  {
                    header: 'Expense',
                    mobile: 'title',
                    cell: expense => (
                      <>
                        <span className="font-medium">{expense.category}</span>
                        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{expense.expenseDate}</span>
                        {(expense.flags?.length || 0) > 0 && (
                          <p className="flex items-start gap-1 text-[11px] font-normal text-amber-800">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {expense.flags!.join(' ')}
                          </p>
                        )}
                      </>
                    ),
                  },
                  {
                    header: 'Amount',
                    align: 'right',
                    mobile: 'aside',
                    cell: expense => <span className="font-semibold"><Money value={expense.amount} /></span>,
                  },
                  { header: 'Date', className: 'hidden sm:table-cell', mobile: 'omit', cell: expense => <span className="tabular-nums">{expense.expenseDate}</span> },
                  { header: 'Vendor', cell: expense => expense.vendor || '—' },
                  {
                    header: 'Bill',
                    cell: expense =>
                      expense.billReference ? (
                        <a href={expense.billReference} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">
                          View bill
                        </a>
                      ) : (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">No bill</Badge>
                      ),
                  },
                  {
                    header: 'Action',
                    mobile: 'footer',
                    cell: expense =>
                      expense.claimed ? (
                        <span className="text-[11px] text-muted-foreground">Claimed</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-rose-600"
                          onClick={async () => {
                            if (!actor) return;
                            try {
                              await deleteTravelExpense(expense.id, actor, 'Removed by employee before claim');
                              toast({ title: 'Expense removed' });
                            } catch (error) {
                              toast({
                                variant: 'destructive',
                                title: 'Could not remove',
                                description: error instanceof TravelControlError ? error.message : '',
                              });
                            }
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                        </Button>
                      ),
                  },
                ]}
              />
            </div>
          )}
        </TravelSection>
      ) : (
        <TravelEmptyState
          title="No tour in progress"
          description="Raise a tour request before travelling — approval and entitlement are checked up front."
          icon={Plane}
          action={
            <Button asChild size="sm">
              <Link href="/tour-travel/requests/new">New Tour Request</Link>
            </Button>
          }
        />
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests ({mine.requests.length})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="claims">Claims ({mine.claims.length})</TabsTrigger>
          <TabsTrigger value="advances">Advances ({mine.advances.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-3">
          <TourTable requests={mine.requests} emptyLabel="You have not raised any tour requests yet." />
        </TabsContent>

        <TabsContent value="upcoming" className="mt-3">
          <TourTable requests={upcoming} emptyLabel="No upcoming travel." />
        </TabsContent>

        <TabsContent value="claims" className="mt-3">
          <TravelDataList
            rows={mine.claims}
            cardHref={claim => `/tour-travel/claims/${claim.id}`}
            empty={<TravelEmptyState title="No claims yet" description="A claim is created from a completed tour." icon={ReceiptIndianRupee} />}
            columns={[
              {
                header: 'Claim',
                mobile: 'title',
                cell: claim => (
                  <Link href={`/tour-travel/claims/${claim.id}`} className="font-medium text-sky-700 hover:underline">
                    {claim.referenceNumber}
                  </Link>
                ),
              },
              { header: 'Status', mobile: 'aside', cell: claim => <TravelStatusBadge status={claim.status} /> },
              { header: 'Tour', cell: claim => claim.travelRequestNumber },
              { header: 'Claimed', align: 'right', cell: claim => <Money value={claim.totalClaimed} /> },
              { header: 'Approved', align: 'right', cell: claim => <Money value={claim.totalApproved} /> },
              {
                header: 'Net',
                align: 'right',
                cell: claim =>
                  claim.netRecoverable > 0 ? (
                    <span className="text-rose-600">You owe <Money value={claim.netRecoverable} /></span>
                  ) : (
                    <span className="text-emerald-700"><Money value={claim.netPayable} /></span>
                  ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="advances" className="mt-3">
          <TravelDataList
            rows={mine.advances}
            empty={<TravelEmptyState title="No advances" description="Request an advance from an approved tour." icon={Wallet} />}
            columns={[
              { header: 'Advance', mobile: 'title', cell: advance => <span className="font-medium">{advance.referenceNumber}</span> },
              { header: 'Status', mobile: 'aside', cell: advance => <TravelStatusBadge status={advance.status} /> },
              { header: 'Tour', cell: advance => advance.travelRequestNumber },
              { header: 'Approved', align: 'right', cell: advance => <Money value={advance.approvedAmount} /> },
              { header: 'Paid', align: 'right', cell: advance => <Money value={advance.paidAmount} /> },
              {
                header: 'You hold',
                align: 'right',
                cell: advance => (
                  <Money value={Math.max(0, roundMoney(Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0)))} />
                ),
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* ── Expense capture dialog ───────────────────────────────────────────────────────────── */}
      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>{expenseTour?.referenceNumber} · {expenseTour?.projectName || expenseTour?.tourType}</DialogDescription>
          </DialogHeader>

          <div className={travelDialog.bodyGrid}>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={value => setCategory(value as ExpenseCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {category === 'Mileage' ? (
              <>
                <div>
                  <Label className="text-xs">Vehicle number</Label>
                  <Input value={vehicleNumber} onChange={event => setVehicleNumber(event.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Vehicle type</Label>
                  <Select value={vehicleType} onValueChange={value => setVehicleType(value as OwnVehicleType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="bike">Bike</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Start KM</Label>
                  <Input type="number" inputMode="decimal" min={0} value={startKm} onChange={event => setStartKm(event.target.value === '' ? '' : Number(event.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">End KM</Label>
                  <Input type="number" inputMode="decimal" min={0} value={endKm} onChange={event => setEndKm(event.target.value === '' ? '' : Number(event.target.value))} />
                </div>
                <div className="col-span-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  {mileage.distanceKm} km × <Money value={mileage.ratePerKm} />/km = <span className="font-semibold"><Money value={mileage.amount} /></span>
                  {mileage.ratePerKm === 0 && <p className="text-xs text-amber-700">No mileage rate configured for your grade — ask HR to set one.</p>}
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" inputMode="decimal" min={0} value={amount} onChange={event => setAmount(event.target.value === '' ? '' : Number(event.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">GST amount</Label>
                  <Input type="number" inputMode="decimal" min={0} value={gstAmount} onChange={event => setGstAmount(event.target.value === '' ? '' : Number(event.target.value))} />
                </div>
              </>
            )}

            <div>
              <Label className="text-xs">Vendor</Label>
              <Input value={vendor} onChange={event => setVendor(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">City</Label>
              <Input value={city} onChange={event => setCity(event.target.value)} />
              <p className="mt-0.5 text-[11px] text-muted-foreground">Class: {config.cityClassFor(city)}</p>
            </div>

            {(category === 'Hotel' || category === 'Local Conveyance' || category === 'Daily Allowance') && (
              <div>
                <Label className="text-xs">{category === 'Hotel' ? 'Nights' : 'Days'}</Label>
                <Input type="number" inputMode="decimal" min={1} value={quantity} onChange={event => setQuantity(event.target.value === '' ? '' : Number(event.target.value))} placeholder="1" />
                <p className="mt-0.5 text-[11px] text-muted-foreground">Used to scale your entitlement cap.</p>
              </div>
            )}

            <div>
              <Label className="text-xs">Payment mode</Label>
              <Select value={paymentMode} onValueChange={value => setPaymentMode(value as ExpensePaymentMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_PAYMENT_MODES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Invoice number</Label>
              <Input value={invoiceNumber} onChange={event => setInvoiceNumber(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Vendor GSTIN</Label>
              <Input value={gstin} onChange={event => setGstin(event.target.value)} />
            </div>

            <div className="col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={description} onChange={event => setDescription(event.target.value)} rows={2} />
            </div>

            <div className="col-span-2 flex items-center gap-3">
              <Switch id="bill-available" checked={billAvailable} onCheckedChange={setBillAvailable} />
              <Label htmlFor="bill-available" className="text-xs">
                Bill available
                {!billAvailable && Number(amount || 0) > config.settings.controls.requireBillAbove && (
                  <span className="ml-1 text-rose-600">— a bill is required above {config.settings.controls.requireBillAbove}</span>
                )}
              </Label>
            </div>

            <div className="col-span-2">
              <Label className="text-xs">Bill / receipt</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={event => setBillFile(event.target.files?.[0] || null)}
              />
              <div className="mt-1 flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="h-4 w-4" /> {billFile ? 'Change' : 'Capture or choose'}
                </Button>
                {billFile && <span className="truncate text-xs text-muted-foreground">{billFile.name}</span>}
              </div>
            </div>
          </div>

          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setExpenseOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveExpense} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {uploading ? 'Uploading bill…' : 'Save expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TourTable({ requests, emptyLabel }: { requests: TravelRequest[]; emptyLabel: string }) {
  const sorted = requests.slice().sort((a, b) => (b.departureDate || '').localeCompare(a.departureDate || ''));
  return (
    <TravelDataList
      rows={sorted}
      cardHref={request => `/tour-travel/requests/${request.id}`}
      empty={<TravelEmptyState title={emptyLabel} icon={Plane} />}
      columns={[
        {
          header: 'Reference',
          mobile: 'title',
          cell: request => (
            <Link href={`/tour-travel/requests/${request.id}`} className="font-medium text-sky-700 hover:underline">
              {request.referenceNumber}
            </Link>
          ),
        },
        { header: 'Status', mobile: 'aside', cell: request => <TravelStatusBadge status={request.status} /> },
        { header: 'Type', cell: request => request.tourType },
        { header: 'Departure', cell: request => <span className="tabular-nums">{request.departureDate}</span> },
        { header: 'Return', cell: request => <span className="tabular-nums">{request.returnDate}</span> },
        { header: 'Estimate', align: 'right', cell: request => <Money value={request.estimate?.total || 0} /> },
      ]}
    />
  );
}
