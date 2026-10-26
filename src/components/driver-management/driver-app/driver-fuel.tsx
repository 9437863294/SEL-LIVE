'use client';

/**
 * Fuel Entries — a driver logs a fill-up of a company vehicle (SEL Fleet, Phase 2).
 *
 * ── Why it moved behind the API ─────────────────────────────────────────────────────────────────
 *
 * This page used to write the fuel log straight into Firestore from the browser, with the mileage
 * worked out here from a "previous reading" the driver could type. A fill-up decides money twice —
 * the bill is paid or reimbursed, and the mileage judges the vehicle and its driver — so the figures
 * now come from the server (`POST /api/fleet/fuel`, src/lib/fleet/server/fuel.ts): full-tank-to-
 * full-tank mileage from every fuel log of the vehicle, the flags (low mileage, more than the tank
 * holds, an unusual price, no trip since the last fill, the reading going down), and the vehicle's
 * odometer. The entry still lands in Vehicle Management's fuel register with its own field names.
 *
 * ── What the driver gives ───────────────────────────────────────────────────────────────────────
 *
 * The vehicle (company vehicles from Vehicle Master only — a personal vehicle's running is claimed
 * per km in My Trips), the reading, litres and the bill amount (the rate per litre is derived), full
 * tank or not, who paid, and two photos: the bill and the odometer. Both photos are mandatory and are
 * uploaded through the API, never to an open Storage path. When OCR is switched on, the odometer
 * photo is read as soon as it is taken and its reading offered.
 *
 * A form session has one `clientEntryId`, so pressing Save twice — or retrying after a dropped
 * connection — saves one entry. A photo already uploaded is not uploaded again on a retry.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { CarFront, Fuel, Loader2, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useToast } from '@/hooks/use-toast';
import { SearchSelect } from '@/components/driver-management/trips/trip-ui';
import { FleetApiError, fleetErrorMessage, fleetFetch, newClientId } from '@/components/fleet/fleet-api';
import { useFleet } from '@/components/fleet/fleet-provider';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { uploadFleetPhoto } from '@/components/fleet/photo';
import { FleetEmpty, FuelFlagChips, PhotoCapture } from '@/components/fleet/fleet-ui';
import { getCurrentDriverPosition } from '@/lib/driver-mobile-geolocation';
import { addDays, shortDateLabel } from '@/lib/fleet/dates';
import { FUEL_PAID_BY_LABELS, formatINR, round2, type FuelPaidBy } from '@/lib/fleet/types';
import type { FuelEntryView } from '@/lib/fleet/server/fuel';
import { cn } from '@/lib/utils';

/** Payment modes offered for each payer; the first is the default. */
const PAYMENT_MODES: Record<FuelPaidBy, string[]> = {
  company: ['Fuel Card', 'Company Account', 'UPI', 'Card'],
  driver: ['Cash', 'UPI', 'Card'],
  advance: ['Cash', 'UPI'],
};

const PAID_BY_ORDER: FuelPaidBy[] = ['company', 'driver', 'advance'];

/** A photo and, once sent, the upload it became — so a retry does not send it again. */
interface PhotoState {
  blob: Blob;
  uploadId: string | null;
  ocrKm: number | null;
}

interface FormState {
  vehicleId: string | null;
  fuelDate: string;
  odometerKm: string;
  litres: string;
  amount: string;
  fullTank: boolean;
  paidBy: FuelPaidBy;
  paymentMode: string;
  stationName: string;
  billNumber: string;
  remarks: string;
}

type Errors = Partial<Record<keyof FormState | 'bill' | 'odometerPhoto', string>>;

const blankForm = (today: string, vehicleId: string | null): FormState => ({
  vehicleId,
  fuelDate: today,
  odometerKm: '',
  litres: '',
  amount: '',
  fullTank: true,
  paidBy: 'company',
  paymentMode: PAYMENT_MODES.company[0],
  stationName: '',
  billNumber: '',
  remarks: '',
});

const toNumber = (text: string) => {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

/** Where the fill-up happened, for matching a fuel-station geofence. Never blocks saving. */
async function quickPosition(): Promise<{ lat: number; lng: number; accuracyM: number | null } | null> {
  try {
    const position = await Promise.race([
      getCurrentDriverPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy ?? null } : null;
  } catch {
    return null;
  }
}

function Field({ label, htmlFor, required, error, hint, className, children }: { label: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function DriverMobileFuelPage() {
  const { toast } = useToast();
  const { data: fleet, loading: fleetLoading, reload: reloadFleet } = useFleet();
  const history = useFleetQuery<{ entries: FuelEntryView[] }>(fleet?.canDrive ? 'fuel' : null);

  const today = fleet?.today ?? new Date().toISOString().slice(0, 10);
  // Their own vehicle first: a driver assigned one fuels it almost every time.
  const vehicles = useMemo(() => [...(fleet?.vehicles ?? [])].sort((a, b) => Number(b.assignedToMe) - Number(a.assignedToMe) || a.vehicleNumber.localeCompare(b.vehicleNumber)), [fleet?.vehicles]);
  const defaultVehicleId = vehicles.find((vehicle) => vehicle.assignedToMe)?.id ?? null;

  const [form, setForm] = useState<FormState | null>(null);
  const current = form ?? blankForm(today, defaultVehicleId);
  const [bill, setBill] = useState<PhotoState | null>(null);
  const [odometerPhoto, setOdometerPhoto] = useState<PhotoState | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [clientEntryId, setClientEntryId] = useState(() => newClientId('fuel'));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...(previous ?? blankForm(today, defaultVehicleId)), [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const vehicle = vehicles.find((entry) => entry.id === current.vehicleId) ?? null;
  const litres = toNumber(current.litres);
  const amount = toNumber(current.amount);
  const odometerKm = toNumber(current.odometerKm);
  const rate = litres && amount && litres > 0 ? round2(amount / litres) : null;
  const sinceLast = vehicle && vehicle.currentOdometerKm !== null && odometerKm !== null ? Math.round((odometerKm - vehicle.currentOdometerKm) * 10) / 10 : null;
  const earliest = addDays(today, -7);

  /** With OCR on, read the odometer photo as soon as it is taken and offer its reading. */
  const chooseOdometerPhoto = async (blob: Blob | null) => {
    setErrors((previous) => ({ ...previous, odometerPhoto: undefined }));
    if (!blob) {
      setOdometerPhoto(null);
      return;
    }
    setOdometerPhoto({ blob, uploadId: null, ocrKm: null });
    if (!fleet?.settings.ocrEnabled || !current.vehicleId) return;
    setReadingPhoto(true);
    try {
      const uploaded = await uploadFleetPhoto(blob, 'odometer', current.vehicleId);
      // The driver may have retaken the photo while this one was being read.
      setOdometerPhoto((photo) => (photo?.blob === blob ? { blob, uploadId: uploaded.uploadId, ocrKm: uploaded.ocrKm } : photo));
    } catch {
      // Uploaded again on save; the suggestion is a convenience, not a step.
    } finally {
      setReadingPhoto(false);
    }
  };

  function validate(): Errors {
    const found: Errors = {};
    if (!current.vehicleId || !vehicle) found.vehicleId = 'Choose the company vehicle.';
    if (!current.fuelDate || current.fuelDate > today) found.fuelDate = 'Not in the future.';
    else if (current.fuelDate < earliest) found.fuelDate = 'Within the last 7 days — older fill-ups are entered by the fleet office.';
    if (odometerKm === null || odometerKm <= 0) found.odometerKm = 'Enter the odometer reading.';
    if (litres === null || litres <= 0) found.litres = 'Enter the litres.';
    else if (vehicle?.tankCapacityL && litres > vehicle.tankCapacityL * 1.05) found.litres = `More than the ${vehicle.tankCapacityL} L tank holds — check the bill.`;
    if (amount === null || amount <= 0) found.amount = 'Enter the bill amount.';
    if (current.stationName.trim().length < 2) found.stationName = 'Enter the fuel station.';
    if (!bill) found.bill = 'Take a photo of the bill.';
    if (!odometerPhoto) found.odometerPhoto = 'Take a photo of the odometer.';
    return found;
  }

  // A tank over capacity is worth a second look, but the server decides; only the rest blocks.
  const blocking = (found: Errors) => Object.entries(found).filter(([key, value]) => value && !(key === 'litres' && litres !== null && litres > 0)).length > 0;

  async function submit() {
    if (submitting || !fleet) return;
    const found = validate();
    setErrors(found);
    if (blocking(found)) return;
    setSubmitting(true);
    try {
      const vehicleId = current.vehicleId as string;
      let billUpload = bill as PhotoState;
      if (!billUpload.uploadId) {
        const uploaded = await uploadFleetPhoto(billUpload.blob, 'fuel_bill', vehicleId);
        billUpload = { ...billUpload, uploadId: uploaded.uploadId };
        setBill(billUpload);
      }
      let odoUpload = odometerPhoto as PhotoState;
      if (!odoUpload.uploadId) {
        const uploaded = await uploadFleetPhoto(odoUpload.blob, 'odometer', vehicleId);
        odoUpload = { ...odoUpload, uploadId: uploaded.uploadId, ocrKm: uploaded.ocrKm };
        setOdometerPhoto(odoUpload);
      }
      const position = await quickPosition();
      const result = await fleetFetch<{ entry: FuelEntryView; reused: boolean }>('fuel', {
        method: 'POST',
        body: {
          clientEntryId,
          vehicleId,
          fuelDate: current.fuelDate,
          odometerKm,
          litres,
          amount,
          fullTank: current.fullTank,
          paidBy: current.paidBy,
          paymentMode: current.paymentMode,
          stationName: current.stationName.trim(),
          billNumber: current.billNumber.trim(),
          billUploadId: billUpload.uploadId,
          odometerUploadId: odoUpload.uploadId,
          ocrKm: odoUpload.ocrKm,
          tripId: fleet.openTrip?.vehicleId === vehicleId ? fleet.openTrip.id : null,
          position,
          remarks: current.remarks.trim(),
        },
      });
      const flags = result.entry.flagCodes.length;
      toast({
        title: result.reused ? 'Already saved' : 'Fuel entry saved',
        description: result.reused
          ? 'This fill-up was saved earlier.'
          : `${result.entry.litres} L · ${formatINR(result.entry.amount)}${result.entry.mileageKmpl ? ` · ${result.entry.mileageKmpl} km/L` : ''}${flags ? ` · ${flags} flag${flags === 1 ? '' : 's'} for a second look` : ''}`,
      });
      // The same vehicle next time; everything else starts afresh, with a new entry id.
      setForm(blankForm(today, vehicleId));
      setBill(null);
      setOdometerPhoto(null);
      setErrors({});
      setClientEntryId(newClientId('fuel'));
      history.reload();
      reloadFleet();
    } catch (error) {
      if (error instanceof FleetApiError && Object.keys(error.fields ?? {}).length) setErrors((previous) => ({ ...previous, ...(error.fields as Errors) }));
      toast({ variant: 'destructive', title: 'Fuel entry not saved', description: fleetErrorMessage(error, 'The fuel entry could not be saved.') });
    } finally {
      setSubmitting(false);
    }
  }

  if (fleetLoading && !fleet) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!fleet?.canDrive) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Fuel entries are for company-vehicle drivers</CardTitle>
          <CardDescription>Ask the fleet office to add you to Driver Master. A personal vehicle&apos;s running is claimed per km in My Trips.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const vehicleOptions = vehicles.map((entry) => ({
    value: entry.id,
    label: `${entry.vehicleNumber} · ${entry.vehicleType}`,
    hint: [entry.assignedToMe ? 'Your vehicle' : null, entry.fuelType].filter(Boolean).join(' · ') || undefined,
  }));
  const entries = history.data?.entries ?? [];
  const ocrSuggestion = odometerPhoto?.ocrKm ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title="Fuel Entries" description="Log a fill-up of a company vehicle with its bill and odometer photos." icon={Fuel} />

      <Card className="vm-panel-strong overflow-hidden">
        <CardContent className="grid grid-cols-1 gap-4 pt-[var(--card-pad,1.5rem)] md:grid-cols-2">
          <Field label="Vehicle" required error={errors.vehicleId}>
            <SearchSelect
              options={vehicleOptions}
              value={current.vehicleId}
              onChange={(value) => {
                set('vehicleId', value);
                // A photo read against another vehicle's reading is read again.
                setOdometerPhoto((photo) => (photo ? { ...photo, uploadId: null, ocrKm: null } : photo));
              }}
              placeholder="Choose a company vehicle"
              emptyText="No company vehicle matches."
              invalid={Boolean(errors.vehicleId)}
            />
          </Field>

          <Field label="Date of fill-up" htmlFor="fuel-date" required error={errors.fuelDate}>
            <Input id="fuel-date" type="date" value={current.fuelDate} min={earliest} max={today} onChange={(event) => set('fuelDate', event.target.value)} className="bg-white" />
          </Field>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <CarFront className="h-3.5 w-3.5" aria-hidden />
              From Vehicle Management
            </p>
            {vehicle ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                {[
                  ['Vehicle', vehicle.vehicleNumber],
                  ['Fuel', vehicle.fuelType || 'Not set'],
                  ['Tank', vehicle.tankCapacityL ? `${vehicle.tankCapacityL} L` : 'Not set'],
                  ['Last odometer', vehicle.currentOdometerKm !== null ? `${vehicle.currentOdometerKm.toLocaleString('en-IN')} km` : 'Not recorded'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="truncate font-medium text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Choose the vehicle to see its details.</p>
            )}
          </div>

          <Field
            label="Odometer reading (km)"
            htmlFor="fuel-odometer"
            required
            error={errors.odometerKm}
            hint={
              sinceLast !== null
                ? sinceLast < 0
                  ? `Below the last reading by ${Math.abs(sinceLast).toLocaleString('en-IN')} km — it will be flagged.`
                  : `${sinceLast.toLocaleString('en-IN')} km since the last recorded reading.`
                : undefined
            }
          >
            <Input id="fuel-odometer" type="number" inputMode="decimal" min="0" step="1" value={current.odometerKm} onChange={(event) => set('odometerKm', event.target.value)} className="bg-white" aria-invalid={Boolean(errors.odometerKm)} />
          </Field>

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <Field label="Litres" htmlFor="fuel-litres" required error={errors.litres}>
              <Input id="fuel-litres" type="number" inputMode="decimal" min="0" step="0.01" value={current.litres} onChange={(event) => set('litres', event.target.value)} className="bg-white" aria-invalid={Boolean(errors.litres)} />
            </Field>
            <Field label="Bill amount (₹)" htmlFor="fuel-amount" required error={errors.amount} hint={rate !== null ? `₹${rate.toLocaleString('en-IN')} per litre` : undefined}>
              <Input id="fuel-amount" type="number" inputMode="decimal" min="0" step="0.01" value={current.amount} onChange={(event) => set('amount', event.target.value)} className="bg-white" aria-invalid={Boolean(errors.amount)} />
            </Field>
          </div>

          <div className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
            <div className="min-w-0">
              <Label htmlFor="fuel-full" className="text-sm font-medium">
                Filled to full tank
              </Label>
              <p className="text-[11px] text-muted-foreground">Mileage is worked out from one full tank to the next; a partial fill is added to the next full one.</p>
            </div>
            <Switch id="fuel-full" checked={current.fullTank} onCheckedChange={(checked) => set('fullTank', checked)} />
          </div>

          <Field label="Who paid" required className="md:col-span-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PAID_BY_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    set('paidBy', option);
                    set('paymentMode', PAYMENT_MODES[option][0]);
                  }}
                  className={cn(
                    'min-w-0 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    current.paidBy === option ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                  aria-pressed={current.paidBy === option}
                >
                  {FUEL_PAID_BY_LABELS[option]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Payment mode" required>
            <Select value={current.paymentMode} onValueChange={(value) => set('paymentMode', value)}>
              <SelectTrigger className="bg-white text-left">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES[current.paidBy].map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fuel station" htmlFor="fuel-station" required error={errors.stationName}>
            <Input id="fuel-station" value={current.stationName} maxLength={120} onChange={(event) => set('stationName', event.target.value)} className="bg-white" aria-invalid={Boolean(errors.stationName)} />
          </Field>

          <Field label="Bill / receipt number" htmlFor="fuel-bill-no">
            <Input id="fuel-bill-no" value={current.billNumber} maxLength={60} onChange={(event) => set('billNumber', event.target.value)} className="bg-white" />
          </Field>

          <div className="hidden md:block" aria-hidden />

          <div className="min-w-0">
            <PhotoCapture
              label="Bill photo"
              required
              accept="image/*,application/pdf"
              value={bill?.blob ?? null}
              onChange={(blob: Blob | null) => {
                setBill(blob ? { blob, uploadId: null, ocrKm: null } : null);
                setErrors((previous) => ({ ...previous, bill: undefined }));
              }}
              hint="The pump's printed bill, or its PDF."
            />
            {errors.bill && <p className="mt-1 text-[11px] text-rose-600">{errors.bill}</p>}
          </div>

          <div className="min-w-0">
            <PhotoCapture
              label="Odometer photo"
              required
              accept="image/*"
              value={odometerPhoto?.blob ?? null}
              onChange={(blob: Blob | null) => void chooseOdometerPhoto(blob)}
              hint="The reading must be readable in the photo."
            />
            {errors.odometerPhoto && <p className="mt-1 text-[11px] text-rose-600">{errors.odometerPhoto}</p>}
            {readingPhoto && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Reading the photo…
              </p>
            )}
            {ocrSuggestion !== null && ocrSuggestion !== odometerKm && (
              <button type="button" onClick={() => set('odometerKm', String(ocrSuggestion))} className="mt-1 text-left text-[11px] font-medium text-primary underline-offset-2 hover:underline">
                The photo reads {ocrSuggestion.toLocaleString('en-IN')} km — use it
              </button>
            )}
          </div>

          <Field label="Remarks" htmlFor="fuel-remarks" className="md:col-span-2">
            <Textarea id="fuel-remarks" value={current.remarks} maxLength={500} rows={2} onChange={(event) => set('remarks', event.target.value)} placeholder="Optional" className="bg-white" />
          </Field>

          <div className="md:col-span-2">
            <Button type="button" onClick={() => void submit()} disabled={submitting} className="w-full sm:w-auto">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ReceiptText className="mr-2 h-4 w-4" aria-hidden />}
              {submitting ? 'Saving…' : 'Save fuel entry'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-base">Your recent fuel entries</CardTitle>
          <CardDescription>Mileage is worked out from one full tank to the next.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.loading && !history.data ? (
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)
          ) : entries.length === 0 ? (
            <FleetEmpty title="No fuel entries yet" description="Fill-ups you log appear here with their mileage." />
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-slate-800">{entry.vehicleNumber || '—'}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{entry.fuelDate ? shortDateLabel(entry.fuelDate, today) : '—'}</span>
                    {entry.status && <StatusBadge status={entry.status} />}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 sm:grid-cols-4">
                  <span>
                    {entry.litres} L{entry.fullTank ? ' · full' : ''}
                  </span>
                  <span>{formatINR(entry.amount)}</span>
                  <span>{entry.mileageKmpl ? `${entry.mileageKmpl} km/L` : 'Mileage at next full tank'}</span>
                  <span className="min-w-0 truncate">{entry.stationName || '—'}</span>
                </div>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{FUEL_PAID_BY_LABELS[entry.paidBy]}</span>
                  {entry.flagCodes.length > 0 && <FuelFlagChips flags={entry.flagCodes} />}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
