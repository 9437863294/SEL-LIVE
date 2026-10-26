'use client';

/**
 * Vehicle Management › Geofences: the places the fleet knows — offices, yards, fuel stations and
 * project sites — each a circle on the map.
 *
 * A trip's start and end are named after the fence they happen in, arrivals and departures are
 * recorded as a vehicle crosses one (with a two-fix margin, so parking on the edge does not flap),
 * and a project site's fence is how a site visit is proved. So a fence should be drawn round the
 * ground a vehicle actually stands on: the gate and the parking, not the whole campus. Where fences
 * overlap, the smaller one counts — a pump inside a yard is "at the pump".
 *
 * Deleting is soft: trips keep the name of the fence they started in, and the fence stops being
 * offered from then on.
 */

import { useMemo, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { LocateFixed, Map as MapIcon, MapPin, MapPinned, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { EmptyBlock, ErrorBlock, Field, LoadingBlock, SearchSelect, SegmentTabs } from '@/components/driver-management/trips/trip-ui';
import { reverseGeocode } from '@/components/driver-management/trips/trip-api';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import { getCurrentDriverPosition } from '@/lib/driver-mobile-geolocation';
import { GEOFENCE_KINDS, GEOFENCE_KIND_LABELS, GEOFENCE_RADIUS_MAX_M, GEOFENCE_RADIUS_MIN_M, type Geofence, type GeofenceKind, type ProjectOption } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';
import { fieldErrorsOf, useFleetMasters, useFleetSettingsAccess } from './fleet-masters';
import { GEOFENCE_KIND_COLOURS, GeofenceMapPicker, GeofenceOverviewMap, type MapFence } from './geofence-map-picker';

/** A sensible first radius for each kind of place. */
const DEFAULT_RADIUS: Record<GeofenceKind, number> = { office: 150, yard: 200, fuel_station: 60, project_site: 300, other: 150 };

export function KindChip({ kind }: { kind: GeofenceKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: GEOFENCE_KIND_COLOURS[kind] }} aria-hidden />
      {GEOFENCE_KIND_LABELS[kind]}
    </span>
  );
}

const radiusText = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} km` : `${metres} m`);

type KindFilter = 'all' | GeofenceKind;

export default function GeofencesPage() {
  const { canView, canEdit, isLoading: accessLoading } = useFleetSettingsAccess();
  const { data, error, loading, reload, setData } = useFleetMasters();
  const { toast } = useToast();
  const [kind, setKind] = useState<KindFilter>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  // The fence being edited (null: a new one); undefined while the dialog is closed.
  const [editing, setEditing] = useState<Geofence | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Geofence | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fences = useMemo(() => data?.geofences ?? [], [data]);
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const projectName = (id: string | null) => (id ? projects.find((project) => project.id === id)?.name ?? 'Unknown project' : '');

  const counts = useMemo(() => {
    const byKind = Object.fromEntries(GEOFENCE_KINDS.map((entry) => [entry, 0])) as Record<GeofenceKind, number>;
    for (const fence of fences) byKind[fence.kind] = (byKind[fence.kind] ?? 0) + 1;
    return byKind;
  }, [fences]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return fences
      .filter((fence) => kind === 'all' || fence.kind === kind)
      .filter((fence) => !needle || `${fence.name} ${fence.address}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [fences, kind, search]);

  const mapFences = useMemo<MapFence[]>(() => rows.filter((fence) => fence.active).map(({ id, name, kind: fenceKind, lat, lng, radiusM }) => ({ id, name, kind: fenceKind, lat, lng, radiusM })), [rows]);

  if (accessLoading || (loading && !data)) return <LoadingBlock />;
  if (!canView) return <ErrorBlock message="Geofences need Vehicle Management · Fleet Settings · View." />;
  if (!data) return <ErrorBlock message={error ?? 'Could not load geofences.'} onRetry={() => void reload()} />;

  const saved = (fence: Geofence) => {
    setData((current) => (current ? { ...current, geofences: [...current.geofences.filter((entry) => entry.id !== fence.id), fence] } : current));
    void reload();
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await fleetFetch(`geofences/${deleting.id}`, { method: 'DELETE' });
      setData((current) => (current ? { ...current, geofences: current.geofences.filter((entry) => entry.id !== deleting.id) } : current));
      toast({ title: 'Geofence deleted', description: `${deleting.name} is no longer offered. Trips that used it keep its name.` });
      setDeleting(null);
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not deleted', description: fleetErrorMessage(failure, 'The geofence could not be deleted.') });
      throw failure;
    } finally {
      setDeleteBusy(false);
    }
  };

  const columns: Array<ListColumn<Geofence>> = [
    {
      header: 'Place',
      mobile: 'title',
      cell: (fence) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-slate-800">{fence.name}</span>
          {fence.address && <span className="block max-w-[22rem] truncate text-xs text-muted-foreground">{fence.address}</span>}
        </span>
      ),
    },
    { header: 'Kind', mobile: 'aside', cell: (fence) => <KindChip kind={fence.kind} /> },
    { header: 'Radius', align: 'right', mobile: 'detail', cell: (fence) => <span className="tabular-nums">{radiusText(fence.radiusM)}</span> },
    { header: 'Project', mobile: 'detail', cell: (fence) => (fence.projectId ? <span className="block max-w-[16rem] truncate">{projectName(fence.projectId)}</span> : <span className="text-muted-foreground">—</span>) },
    { header: 'Centre', mobile: 'omit', className: 'hidden lg:table-cell', cell: (fence) => <span className="font-mono text-xs text-slate-600">{fence.lat.toFixed(5)}, {fence.lng.toFixed(5)}</span> },
    { header: 'Status', mobile: 'detail', cell: (fence) => <StatusBadge tone={fence.active ? 'success' : 'neutral'}>{fence.active ? 'Active' : 'Inactive'}</StatusBadge> },
    ...(canEdit
      ? [
          {
            header: '',
            align: 'right' as const,
            mobile: 'footer' as const,
            cell: (fence: Geofence) => (
              <span className="flex justify-end gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(fence)} aria-label={`Edit ${fence.name}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5 sm:hidden">Edit</span>
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleting(fence)} aria-label={`Delete ${fence.name}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5 sm:hidden">Delete</span>
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Geofences"
        icon={MapPinned}
        description="Offices, yards, fuel stations and project sites. Trips are named after the fence they start and end in, and site visits are recorded as vehicles arrive and leave."
        actions={
          canEdit ? (
            <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setEditing(null)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Add geofence
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentTabs<KindFilter>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[{ value: 'all', label: 'All', count: fences.length }, ...GEOFENCE_KINDS.map((entry) => ({ value: entry as KindFilter, label: GEOFENCE_KIND_LABELS[entry], count: counts[entry] }))]}
        />
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search places" className="bg-white pl-8" aria-label="Search geofences" />
          </div>
          <SegmentTabs<'list' | 'map'> label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
        </div>
      </div>

      {view === 'map' ? (
        fences.length ? (
          <div className="space-y-2">
            <GeofenceOverviewMap fences={mapFences} onSelect={canEdit ? (id) => setEditing(fences.find((fence) => fence.id === id) ?? undefined) : undefined} />
            <div className="flex flex-wrap gap-2">
              {GEOFENCE_KINDS.map((entry) => (
                <KindChip key={entry} kind={entry} />
              ))}
            </div>
            {canEdit && <p className="text-xs text-muted-foreground">Tap a circle to edit it. Inactive fences are not drawn.</p>}
          </div>
        ) : (
          <EmptyBlock icon={MapIcon} title="No geofences yet" />
        )
      ) : (
        <DataList
          rows={rows}
          columns={columns}
          rowClassName={(fence) => (fence.active ? undefined : 'opacity-60')}
          empty={
            <EmptyBlock icon={MapPin} title={fences.length ? 'No place matches' : 'No geofences yet'}>
              {fences.length ? 'Try another kind or search.' : 'Add the head office, the yards, the pumps the fleet fills at, and every project site vehicles visit.'}
            </EmptyBlock>
          }
        />
      )}

      <GeofenceDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        fence={editing ?? null}
        fences={fences}
        projects={projects}
        onSaved={(fence) => {
          saved(fence);
          setEditing(undefined);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        loading={deleteBusy}
        title={`Delete ${deleting?.name ?? 'geofence'}?`}
        description="It stops being offered and recognised on new trips. Trips that started or ended in it keep its name."
        onConfirm={remove}
      />
    </div>
  );
}

/* ── Add / edit ── */

interface FenceForm {
  name: string;
  kind: GeofenceKind;
  lat: string;
  lng: string;
  radiusM: number;
  projectId: string | null;
  address: string;
  active: boolean;
}

const formFrom = (fence: Geofence | null): FenceForm =>
  fence
    ? { name: fence.name, kind: fence.kind, lat: String(fence.lat), lng: String(fence.lng), radiusM: fence.radiusM, projectId: fence.projectId, address: fence.address, active: fence.active }
    : { name: '', kind: 'office', lat: '', lng: '', radiusM: DEFAULT_RADIUS.office, projectId: null, address: '', active: true };

const coordinate = (value: string, limit: number): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
};

/** "20.2961, 85.8245" pasted into either box fills both. */
const pastedPair = (text: string): [number, number] | null => {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
};

function GeofenceDialog({
  open,
  onOpenChange,
  fence,
  fences,
  projects,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fence: Geofence | null;
  fences: Geofence[];
  projects: ProjectOption[];
  onSaved: (fence: Geofence) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FenceForm>(() => formFrom(fence));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);

  // A fresh form each time the dialog opens or switches fence (during render, not in an effect).
  const session = open ? `open:${fence?.id ?? 'new'}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open) {
      setForm(formFrom(fence));
      setErrors({});
    }
  }

  const lat = coordinate(form.lat, 90);
  const lng = coordinate(form.lng, 180);
  const set = <K extends keyof FenceForm>(key: K, value: FenceForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const others = useMemo<MapFence[]>(() => fences.filter((entry) => entry.id !== fence?.id && entry.active), [fence?.id, fences]);
  const nearest = useMemo(() => {
    if (lat === null || lng === null) return null;
    // A rough check, in degrees → metres at India's latitudes; enough to warn about an overlap.
    const overlapping = others.filter((entry) => {
      const dy = (entry.lat - lat) * 111_320;
      const dx = (entry.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
      return Math.sqrt(dx * dx + dy * dy) < entry.radiusM + form.radiusM;
    });
    return overlapping.sort((a, b) => a.radiusM - b.radiusM)[0] ?? null;
  }, [form.radiusM, lat, lng, others]);

  const move = (point: { lat: number; lng: number }) =>
    setForm((current) => ({ ...current, lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) }));

  const locateMe = async () => {
    setLocating(true);
    try {
      const position = await getCurrentDriverPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      move({ lat: position.coords.latitude, lng: position.coords.longitude });
      toast({ title: 'Centred on your location', description: `Accurate to about ${Math.round(position.coords.accuracy)} m. Drag the pin if the place is elsewhere.` });
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Location unavailable', description: failure instanceof Error ? failure.message : 'Allow location access, or tap the map instead.' });
    } finally {
      setLocating(false);
    }
  };

  const fillAddress = async () => {
    if (lat === null || lng === null) return;
    setFinding(true);
    try {
      const address = await reverseGeocode(lat, lng);
      if (address) set('address', address);
      else toast({ title: 'No address found', description: 'Type the address instead.' });
    } finally {
      setFinding(false);
    }
  };

  const pasteInto = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const pair = pastedPair(event.clipboardData.getData('text'));
    if (!pair) return;
    event.preventDefault();
    move({ lat: pair[0], lng: pair[1] });
  };

  async function submit() {
    const missing: Record<string, string> = {};
    if (form.name.trim().length < 2) missing.name = 'Name the place.';
    if (lat === null) missing.lat = 'Enter a latitude, or tap the map.';
    if (lng === null) missing.lng = 'Enter a longitude, or tap the map.';
    if (form.kind === 'project_site' && !form.projectId) missing.projectId = 'Choose the project this site belongs to.';
    if (Object.keys(missing).length) {
      setErrors(missing);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const body = { name: form.name.trim(), kind: form.kind, lat, lng, radiusM: Math.round(form.radiusM), projectId: form.kind === 'project_site' ? form.projectId : null, address: form.address.trim(), active: form.active };
      const result = await fleetFetch<{ geofence: Geofence }>(fence ? `geofences/${fence.id}` : 'geofences', { method: fence ? 'PATCH' : 'POST', body });
      toast({ title: fence ? 'Geofence updated' : 'Geofence added', description: `${result.geofence.name} · ${radiusText(result.geofence.radiusM)}` });
      onSaved(result.geofence);
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The geofence could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={fence ? `Edit ${fence.name}` : 'Add a geofence'}
      description="Tap the map or drag the pin to the place, then size the circle to the ground a vehicle stands on there."
      onSubmit={submit}
      submitting={saving}
      submitLabel={fence ? 'Save changes' : 'Add geofence'}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-2 lg:col-span-3">
          <GeofenceMapPicker lat={lat} lng={lng} radiusM={form.radiusM} kind={form.kind} onMove={move} others={others} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void locateMe()} disabled={locating}>
              <LocateFixed className={cn('mr-1.5 h-4 w-4', locating && 'animate-pulse')} aria-hidden />
              {locating ? 'Finding you…' : 'Use my location'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void fillAddress()} disabled={finding || lat === null || lng === null}>
              <MapPin className="mr-1.5 h-4 w-4" aria-hidden />
              {finding ? 'Looking up…' : 'Fill address from the pin'}
            </Button>
          </div>
          {nearest && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              Overlaps <span className="font-medium">{nearest.name}</span>. That is fine for a pump inside a yard (the smaller fence counts), but two fences for the same place would split its visits.
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Field label="Name" required error={errors.name} htmlFor="fence-name">
            <Input id="fence-name" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={120} placeholder="e.g. Head office, Khurda yard, IOCL Rasulgarh" className="bg-white" aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Kind" required error={errors.kind}>
            <Select
              value={form.kind}
              onValueChange={(value) => {
                const next = value as GeofenceKind;
                // A new fence takes the new kind's usual size; an existing one keeps what was drawn.
                setForm((current) => ({ ...current, kind: next, radiusM: !fence && current.radiusM === DEFAULT_RADIUS[current.kind] ? DEFAULT_RADIUS[next] : current.radiusM, projectId: next === 'project_site' ? current.projectId : null }));
              }}
            >
              <SelectTrigger className="bg-white text-left [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GEOFENCE_KINDS.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {GEOFENCE_KIND_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.kind === 'project_site' && (
            <Field label="Project" required error={errors.projectId} hint="Arrivals here count as visits to this project's site.">
              <SearchSelect
                options={projects.map((project) => ({ value: project.id, label: project.name, hint: [project.code, project.clientName].filter(Boolean).join(' · ') || undefined }))}
                value={form.projectId}
                onChange={(value) => set('projectId', value)}
                placeholder="Choose project"
                invalid={Boolean(errors.projectId)}
              />
            </Field>
          )}
          <Field label={`Radius — ${radiusText(form.radiusM)}`} required error={errors.radiusM} hint={`${GEOFENCE_RADIUS_MIN_M} m to ${GEOFENCE_RADIUS_MAX_M / 1000} km. Phones are accurate to about 10–30 m outdoors; under 50 m a vehicle at the gate may not register.`}>
            <div className="flex items-center gap-3">
              <Slider
                value={[form.radiusM]}
                min={GEOFENCE_RADIUS_MIN_M}
                max={2000}
                step={10}
                onValueChange={(value) => set('radiusM', value[0] ?? form.radiusM)}
                aria-label="Radius in metres"
                className="min-w-0 flex-1"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={GEOFENCE_RADIUS_MIN_M}
                max={GEOFENCE_RADIUS_MAX_M}
                value={form.radiusM}
                onChange={(event) => set('radiusM', Math.min(GEOFENCE_RADIUS_MAX_M, Math.max(0, Number(event.target.value) || 0)))}
                onBlur={() => set('radiusM', Math.max(GEOFENCE_RADIUS_MIN_M, form.radiusM))}
                className="w-24 bg-white text-right tabular-nums"
                aria-label="Radius in metres (typed)"
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" required error={errors.lat} htmlFor="fence-lat">
              <Input id="fence-lat" inputMode="decimal" value={form.lat} onChange={(event) => set('lat', event.target.value)} onPaste={pasteInto} placeholder="20.2961" className="bg-white font-mono text-xs" aria-invalid={Boolean(errors.lat)} />
            </Field>
            <Field label="Longitude" required error={errors.lng} htmlFor="fence-lng">
              <Input id="fence-lng" inputMode="decimal" value={form.lng} onChange={(event) => set('lng', event.target.value)} onPaste={pasteInto} placeholder="85.8245" className="bg-white font-mono text-xs" aria-invalid={Boolean(errors.lng)} />
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">Paste &ldquo;lat, lng&rdquo; copied from Google Maps into either box to fill both.</p>
          <Field label="Address" error={errors.address} htmlFor="fence-address">
            <Textarea id="fence-address" value={form.address} onChange={(event) => set('address', event.target.value)} rows={2} maxLength={300} placeholder="Optional" className="bg-white" />
          </Field>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">Active</span>
              <span className="block text-xs text-muted-foreground">Off: kept for the record, but no longer recognised on trips.</span>
            </span>
            <Switch checked={form.active} onCheckedChange={(value) => set('active', value)} aria-label="Active" />
          </label>
        </div>
      </div>
    </FormDialog>
  );
}
