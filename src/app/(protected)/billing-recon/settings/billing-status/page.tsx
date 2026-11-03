'use client';

/**
 * Settings › Billing Status — which projects Billing Recon lists (`projects/{id}.billingRequired`),
 * and each one's work-order details and print signatories.
 *
 * What the prints read: the work order no (`woNo`), the name of work (`projectDescription`, else
 * the project name) and the signatories (`signatures`) — see the JMC / MVAC / RA bill print pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit, FileText, Info, Loader2, PenLine, Plus, Save, ToggleRight, Trash2, Users } from 'lucide-react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { Project, Signature } from '@/lib/types';
import { compareNatural } from '@/lib/billing-recon/lines';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { AppTile, BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Extra fields present in Firestore but not declared on core Project type */
type ProjectWithExtras = Project & {
  woNo?: string;
  refRoNo?: string;
  nameOfSs?: string;
  subWork?: string;
  billingRequired?: boolean;
  projectName?: string; // fallback
  siteInCharge?: string;
  projectDivision?: string;
  projectSite?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

/** Use Signature directly (it already has id, designation, name) */
type UISignature = Signature;

type BillingFilter = 'all' | 'on' | 'off';

/** `crypto.randomUUID` only exists on secure (https / localhost) pages. */
const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function BillingStatusPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  // The module shell's project switcher and dashboard list billing-required projects; refresh them after a change.
  const { reload: reloadShellProjects } = useBillingReconProjects();

  const canViewModule = can('View Module', 'Billing Recon');

  const [projects, setProjects] = useState<ProjectWithExtras[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [billingFilter, setBillingFilter] = useState<BillingFilter>('all');

  // Unified dialog state
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'enable' | 'edit'>('enable');
  const [pendingProject, setPendingProject] = useState<ProjectWithExtras | null>(null);

  // Form state for the dialog
  const [woInput, setWoInput] = useState('');
  const [nameOfWork, setNameOfWork] = useState('');
  const [refRoNo, setRefRoNo] = useState('');
  const [nameOfSs, setNameOfSs] = useState('');
  const [subWork, setSubWork] = useState('');
  const [signatures, setSignatures] = useState<UISignature[]>([]);
  const [projectDescription, setProjectDescription] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const resetForm = () => {
    setPendingProject(null);
    setWoInput('');
    setNameOfWork('');
    setRefRoNo('');
    setNameOfSs('');
    setSubWork('');
    setSignatures([]);
    setProjectDescription('');
    setAttempted(false);
  };

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = querySnapshot.docs.map((d) => {
        // Remove any 'id' coming from Firestore data to avoid duplicate key conflicts
        const raw = d.data() as (ProjectWithExtras & { id?: string }) | undefined;
        const { id: _ignored, ...rest } = raw ?? {};
        return { id: d.id, ...rest } as ProjectWithExtras;
      });
      projectsData.sort((a, b) => compareNatural(a.projectName, b.projectName));
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects: ', error);
      setLoadFailed(true);
      toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!authLoading && canViewModule) void fetchProjects();
  }, [fetchProjects, authLoading, canViewModule]);

  const ensureSignatureIds = (arr?: Signature[]): UISignature[] => {
    const base = arr && arr.length > 0 ? arr : [{ id: newId(), designation: 'Site In charge', name: '' }];
    return base.map((s) => ({ ...s, id: s.id ?? newId() }));
  };

  const handleSignatureChange = (id: string, field: 'designation' | 'name', value: string) => {
    setSignatures((prev) => prev.map((sig) => (sig.id === id ? { ...sig, [field]: value } : sig)));
  };

  const handleAddSignature = () => {
    setSignatures((prev) => [...prev, { id: newId(), designation: '', name: '' }]);
  };

  const handleRemoveSignature = (id: string) => {
    setSignatures((prev) => prev.filter((sig) => sig.id !== id));
  };

  const fillForm = (project: ProjectWithExtras) => {
    setPendingProject(project);
    setWoInput(project.woNo ?? '');
    setNameOfWork(project.projectName ?? '');
    setRefRoNo(project.refRoNo ?? '');
    setNameOfSs(project.nameOfSs ?? '');
    setSubWork(project.subWork ?? '');
    setSignatures(ensureSignatureIds(project.signatures));
    setProjectDescription(project.projectDescription ?? '');
    setAttempted(false);
    setIsDetailDialogOpen(true);
  };

  // Toggle handler
  const handleBillingToggle = async (project: ProjectWithExtras, nextChecked: boolean) => {
    if (!project.id) return;

    if (!nextChecked) {
      // Turning OFF immediately (no extra details required)
      setSavingId(project.id);
      try {
        const projectRef = doc(db, 'projects', project.id);
        await updateDoc(projectRef, { billingRequired: false });
        setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, billingRequired: false } : p)));
        void reloadShellProjects();
        toast({ title: 'Updated', description: `${project.projectName ?? 'Project'} billing disabled.` });
      } catch (error) {
        console.error('Error disabling billing:', error);
        toast({ title: 'Error', description: 'Failed to update billing status.', variant: 'destructive' });
      } finally {
        setSavingId(null);
      }
      return;
    }

    // Turning ON → show dialog to collect details first
    setDialogMode('enable');
    fillForm(project);
  };

  const openEditDialog = (project: ProjectWithExtras) => {
    setDialogMode('edit');
    fillForm(project);
  };

  const currentName = (pendingProject?.projectName ?? '').trim();
  const typedName = nameOfWork.trim();
  const renaming = Boolean(pendingProject) && typedName !== currentName;

  const saveProjectDetails = async () => {
    if (!pendingProject?.id) return;
    setAttempted(true);

    const woNo = woInput.trim();
    if (!woNo) {
      toast({ title: 'WO No required', description: 'Please enter a valid Work Order No.', variant: 'destructive' });
      return;
    }
    // A blank name used to be saved as the project's name, which unlinks it from every page that
    // finds a project by its name in the URL.
    if (!typedName) {
      toast({ title: 'Project name required', description: 'The project needs a name. Change it in Settings › Projects if it has really changed.', variant: 'destructive' });
      return;
    }

    setIsSavingDetails(true);
    try {
      const projectRef = doc(db, 'projects', pendingProject.id);

      const updateData: Partial<ProjectWithExtras> = {
        woNo,
        // The name is written only when it was changed, so an untouched name (even one with a
        // stray space) is never rewritten.
        ...(renaming ? { projectName: typedName } : {}),
        refRoNo,
        nameOfSs,
        subWork,
        // Keep ids so it matches Signature[]
        signatures: signatures.map(({ id, designation, name }) => ({ id, designation, name })),
        projectDescription,
      };

      if (dialogMode === 'enable') {
        updateData.billingRequired = true;
      }

      await updateDoc(projectRef, updateData);
      void reloadShellProjects();

      // Optimistic local update
      setProjects((prev) => prev.map((p) => (p.id === pendingProject.id ? { ...p, ...updateData } : p)));

      toast({
        title: 'Success',
        description: `Project details for ${typedName || pendingProject.projectName || 'project'} have been saved.`,
      });
      setIsDetailDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error saving project details:', error);
      toast({ title: 'Error', description: 'Failed to save project details.', variant: 'destructive' });
    } finally {
      setIsSavingDetails(false);
    }
  };

  /* ── figures and the list ─────────────────────────────────────────────────────────────────── */

  const figures = useMemo(() => {
    const on = projects.filter((p) => p.billingRequired);
    return {
      total: projects.length,
      on: on.length,
      noWo: on.filter((p) => !String(p.woNo ?? '').trim()).length,
      noSignatories: on.filter((p) => !(p.signatures ?? []).some((s) => String(s.name ?? '').trim() || String(s.designation ?? '').trim())).length,
    };
  }, [projects]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (billingFilter === 'on' && !p.billingRequired) return false;
      if (billingFilter === 'off' && p.billingRequired) return false;
      if (!needle) return true;
      return [p.projectName, p.woNo, p.projectDescription].some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [projects, search, billingFilter]);

  const columns: Array<ListColumn<ProjectWithExtras>> = [
    {
      header: 'Project',
      mobile: 'title',
      cell: (p) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-foreground">{p.projectName || '—'}</span>
          {p.projectDescription && p.projectDescription !== p.projectName && (
            <span className="block truncate text-xs text-muted-foreground" title={p.projectDescription}>
              {p.projectDescription}
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'WO No',
      cell: (p) =>
        String(p.woNo ?? '').trim() ? (
          <span className="whitespace-nowrap">{p.woNo}</span>
        ) : p.billingRequired ? (
          <StatusBadge tone="warning">Missing</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Signatories',
      className: 'hidden md:table-cell',
      cell: (p) => {
        const named = (p.signatures ?? []).filter((s) => String(s.name ?? '').trim() || String(s.designation ?? '').trim());
        return named.length ? (
          <span className="text-muted-foreground" title={named.map((s) => [s.designation, s.name].filter(Boolean).join(' — ')).join('\n')}>
            {named.length} on prints
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        );
      },
    },
    {
      header: 'Billing',
      mobile: 'aside',
      cell: (p) =>
        savingId === p.id ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Saving" />
        ) : (
          <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={!!p.billingRequired}
              onCheckedChange={(checked) => void handleBillingToggle(p, checked)}
              disabled={Boolean(isDetailDialogOpen && pendingProject?.id === p.id)}
              aria-label={`Billing for ${p.projectName ?? 'this project'}`}
            />
            <span className={cn('text-xs font-medium', p.billingRequired ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
              {p.billingRequired ? 'On' : 'Off'}
            </span>
          </span>
        ),
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (p) => (
        <Button variant="outline" size="sm" onClick={() => openEditDialog(p)} disabled={savingId === p.id}>
          <Edit className="mr-2 h-4 w-4" /> Details
        </Button>
      ),
    },
  ];

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  if (authLoading) return <BrPageSkeleton kpis={3} />;
  if (!canViewModule) return <BrAccessDenied message="You need Billing Recon › View Module to change which projects are billed." />;

  const dash = '—';
  const loadingFirst = isLoading && projects.length === 0;

  return (
    <BrPage tone={BR_TONE.settings}>
      <PageHeader
        title="Billing Status"
        description="Switch billing on for the projects Billing Recon should list, with the work order details and signatories its prints carry."
        icon={ToggleRight}
        backHref="/billing-recon/settings"
        backLabel="Back to settings"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Billing on"
          value={loadingFirst ? dash : figures.on}
          hint={loadingFirst ? undefined : `of ${figures.total} projects`}
          icon={ToggleRight}
          tone="cyan"
          accent
        />
        <KpiCard
          label="Without a WO No"
          value={loadingFirst ? dash : figures.noWo}
          hint={figures.noWo ? 'Prints show “N/A” as the order no' : 'Every billing project has one'}
          icon={FileText}
          tone={figures.noWo ? 'amber' : 'emerald'}
          accent
        />
        <KpiCard
          label="Without signatories"
          value={loadingFirst ? dash : figures.noSignatories}
          hint={figures.noSignatories ? 'Prints have no signature row' : 'Every billing project has some'}
          icon={Users}
          tone={figures.noSignatories ? 'amber' : 'emerald'}
          accent
        />
      </div>

      {loadFailed && (
        <BrNotice
          tone="danger"
          icon={AlertTriangle}
          title="Could not load the projects"
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchProjects()}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </BrNotice>
      )}

      <TableCard
        title="Projects"
        icon={ToggleRight}
        description="Turning billing off only hides the project from Billing Recon; its BOQ, JMC, MVAC and RA bills stay."
        count={loadingFirst ? undefined : rows.length}
        total={loadingFirst ? undefined : projects.length}
        noun="project"
        scroll="natural"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Project, WO No or name of work' }}
            activeCount={billingFilter === 'all' ? 0 : 1}
            onClear={() => {
              setSearch('');
              setBillingFilter('all');
            }}
          >
            <Select value={billingFilter} onValueChange={(v) => setBillingFilter(v as BillingFilter)}>
              <SelectTrigger aria-label="Billing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Billing on and off</SelectItem>
                <SelectItem value="on">Billing on</SelectItem>
                <SelectItem value="off">Billing off</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-4">
          {loadingFirst ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : (
            <DataList
              rows={rows}
              columns={columns}
              dense
              rowClassName={(p) => (p.billingRequired ? undefined : 'opacity-80')}
              empty={
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {projects.length === 0 ? 'No projects found. Add projects in Settings › Projects.' : 'No projects match these filters.'}
                </p>
              }
            />
          )}
        </div>
      </TableCard>

      <Dialog
        open={isDetailDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isSavingDetails) {
            setIsDetailDialogOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'enable' ? 'Switch billing on' : 'Work order details'}</DialogTitle>
            <DialogDescription>
              {pendingProject?.projectName ?? 'Project'}
              {dialogMode === 'enable' ? ' — enter its work order details; billing switches on when you save.' : ' — what the JMC, MVAC and RA bill prints carry.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] min-h-0 space-y-5 overflow-y-auto py-2 pr-1">
            <section className="space-y-3">
              <div className="flex items-center gap-2.5">
                <AppTile tone="cyan" icon={FileText} size={28} />
                <h3 className="text-sm font-bold text-foreground">Work order</h3>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="woNo">
                    WO No<span className="ml-0.5 text-rose-600">*</span>
                  </Label>
                  <Input
                    id="woNo"
                    value={woInput}
                    onChange={(e) => setWoInput(e.target.value)}
                    placeholder="e.g., WO-2025-001"
                    autoFocus
                    aria-invalid={attempted && !woInput.trim()}
                    className={cn(attempted && !woInput.trim() && 'border-rose-400')}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="refRoNo">Ref. RO No</Label>
                  <Input id="refRoNo" value={refRoNo} onChange={(e) => setRefRoNo(e.target.value)} placeholder="e.g., RO/2025/123" />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="projectDescription">Name of work (printed)</Label>
                  <Textarea
                    id="projectDescription"
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                    placeholder="e.g., 33kV Bay Extension at XYZ"
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">Printed as the name of work on JMC, MVAC and RA bill prints. Left blank, the project name is printed.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="nameOfSs">Name of S/S</Label>
                  <Input id="nameOfSs" value={nameOfSs} onChange={(e) => setNameOfSs(e.target.value)} placeholder="e.g., Berhampur 132/33kV" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="subWork">Name of Work 2</Label>
                  <Input id="subWork" value={subWork} onChange={(e) => setSubWork(e.target.value)} placeholder="e.g., Stringing + Bay Works" />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="nameOfWork">
                    Project name<span className="ml-0.5 text-rose-600">*</span>
                  </Label>
                  <Input
                    id="nameOfWork"
                    value={nameOfWork}
                    onChange={(e) => setNameOfWork(e.target.value)}
                    aria-invalid={attempted && !typedName}
                    className={cn(attempted && !typedName && 'border-rose-400')}
                  />
                  {renaming && typedName ? (
                    <BrNotice tone="warning" icon={AlertTriangle} title="This renames the project everywhere">
                      Every module shows the new name, and links to this project&apos;s pages change with it. To change only what the prints say, use Name of work above.
                    </BrNotice>
                  ) : (
                    <p className="text-xs text-muted-foreground">The project&apos;s name across the app. Leave it as it is unless the project has really been renamed.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2.5">
                <AppTile tone="indigo" icon={PenLine} size={28} />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground">Signatories for print</h3>
                  <p className="text-xs text-muted-foreground">One signature box each, left to right, at the foot of the prints.</p>
                </div>
              </div>
              {signatures.map((sig, index) => (
                <div key={sig.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border border-border bg-muted/30 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                  <Input
                    placeholder="Designation (e.g., Site In charge)"
                    aria-label={`Signatory ${index + 1} designation`}
                    value={sig.designation}
                    onChange={(e) => handleSignatureChange(sig.id, 'designation', e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:order-last"
                    onClick={() => handleRemoveSignature(sig.id)}
                    disabled={signatures.length <= 1}
                    aria-label={`Remove signatory ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                  <Input
                    placeholder="Name / Department"
                    aria-label={`Signatory ${index + 1} name`}
                    value={sig.name}
                    onChange={(e) => handleSignatureChange(sig.id, 'name', e.target.value)}
                    className="col-span-2 sm:col-span-1"
                  />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={handleAddSignature}>
                <Plus className="mr-2 h-4 w-4" /> Add signatory
              </Button>
            </section>

            {dialogMode === 'enable' && (
              <BrNotice tone="info" icon={Info}>
                Saving switches billing on: the project appears in Billing Recon&apos;s project list and dashboard.
              </BrNotice>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSavingDetails}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={() => void saveProjectDetails()} disabled={isSavingDetails}>
              {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : dialogMode === 'enable' ? <ToggleRight className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
              {dialogMode === 'enable' ? 'Save & switch on' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BrPage>
  );
}
