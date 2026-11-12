'use client';

/**
 * The frame every Master Drawing List view shares — Reports, Pending Tasks, Register, Workplan
 * Calendar and Gantt Chart, the five views of Project Management's MDL page, each a page of its
 * own here with the module sidebar in place of PM's view rail. It holds the drawing list's register
 * (loaded once for all five), the header with the drawing-list switcher, Add Item and Export, and
 * the dialogs: Drawing Details, Add Drawing Item and the two removal confirmations.
 *
 * `?open=<itemId>[&sub=<subId>]` opens a drawing when the page loads; `?add=1` opens Add Item.
 */

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Download, FileBarChart2, GanttChart, ListPlus, ListTodo, Table2, type LucideIcon } from 'lucide-react';

import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { canEditSubDrawing, emptySubDrawing, type DrawingItem, type DrawingRevision, type SubDrawing } from '@/lib/master-drawing-list/drawings';
import { exportFileName, filterItems, isCourtFilter, isOverallStatus, isSchedule, isScope, registerSheet } from '@/lib/master-drawing-list/register';
import { listOrder } from '@/lib/master-drawing-list/settings';
import { exportWorkbook } from '@/lib/report-excel';

import { CalendarView, GanttView } from './calendar-view';
import { ReportsView } from './dashboard';
import { DrawingDialog, type DrawingTarget } from './details-dialog';
import { openDrawingFile, useMdl, useMdlSettings, useProjectRegister, useRegisterParams } from './mdl-client';
import { MdlError, MdlLoading, NoDrawingList, ProjectSelect } from './mdl-ui';
import { AddItemDialog, EditItemDialog } from './new-item';
import { PendingView } from './pending';
import { RegisterView } from './register';
import { DeleteItemDialog, RemoveSubDrawingDialog, type SubDrawingRef } from './step-dialogs';

export type MdlView = 'reports' | 'pending' | 'register' | 'calendar' | 'gantt';

const VIEWS: Record<MdlView, { title: string; icon: LucideIcon }> = {
  reports: { title: 'Reports', icon: FileBarChart2 },
  pending: { title: 'Pending Tasks', icon: ListTodo },
  register: { title: 'Register', icon: Table2 },
  calendar: { title: 'Workplan Calendar', icon: CalendarDays },
  gantt: { title: 'Gantt Chart', icon: GanttChart },
};

export default function MdlWorkspace({ view }: { view: MdlView }) {
  const { lookups } = useMdl();
  const settings = useMdlSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const params = useRegisterParams();
  const register = useProjectRegister(params.project);
  const data = register.data;
  const today = data?.today ?? lookups?.today ?? '';
  const can = data?.can ?? { add: false, edit: false, delete: false, export: false };

  const [drawingTarget, setDrawingTarget] = useState<DrawingTarget | null>(null);
  const [subToRemove, setSubToRemove] = useState<SubDrawingRef | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<DrawingItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<DrawingItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const openDrawing = (item: DrawingItem, sub: SubDrawing | null) => {
    const allowed = sub ? canEditSubDrawing(sub, user?.id, can.edit) : can.edit;
    if (!allowed) {
      toast({ title: 'View only', description: sub ? 'Only someone with Edit permission, or the person this sub-drawing is assigned to, can update it.' : 'Updating a drawing needs Master Drawing List · Drawings · Edit.' });
      return;
    }
    setDrawingTarget({ item, sub, isNew: false });
  };

  // One-off actions carried in the address: open a drawing, or the Add Item dialog. Closing the
  // dialog clears them, so a reload or Back does not open it again.
  const openId = search.get('open');
  const openSub = search.get('sub');
  const wantsAdd = search.get('add') === '1';
  const urlItem = openId ? data?.items.find((entry) => entry.id === openId) : undefined;
  const urlTarget: DrawingTarget | null = urlItem ? { item: urlItem, sub: openSub ? (urlItem.subDrawings.find((entry) => entry.id === openSub) ?? null) : null, isNew: false } : null;
  const activeTarget = drawingTarget ?? urlTarget;
  const closeDrawing = () => {
    setDrawingTarget(null);
    if (openId) params.set({ open: null, sub: null });
  };
  const showAdd = addOpen || (wantsAdd && can.add);
  const setShowAdd = (open: boolean) => {
    setAddOpen(open);
    if (!open && wantsAdd) params.set({ add: null });
  };

  const courtParam = search.get('court');
  const filters = {
    schedule: isSchedule(params.schedule) ? params.schedule : null,
    scope: isScope(params.scope) ? params.scope : null,
    status: isOverallStatus(params.status) ? params.status : null,
    court: isCourtFilter(courtParam) ? courtParam : null,
    q: params.q,
  };
  const items = useMemo(() => data?.items ?? [], [data]);

  const exportView = async () => {
    if (!data) return;
    try {
      await exportWorkbook(exportFileName(data.project, today), [registerSheet(filterItems(items, filters, today), data.project, today, listOrder(settings.masterData))]);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Export failed', description: error instanceof Error ? error.message : 'The workbook could not be built.' });
    }
  };

  const openFile = (item: DrawingItem, revision: DrawingRevision) => {
    if (!revision.filePath) return;
    void openDrawingFile(item.id, revision.filePath).catch((caught: unknown) => toast({ title: 'Could not open the drawing', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' }));
  };

  if (!lookups) return <MdlLoading />;
  const meta = VIEWS[view];
  if (!lookups.projects.length) {
    return (
      <>
        <PageHeader icon={meta.icon} title={meta.title} />
        <NoDrawingList />
      </>
    );
  }
  const project = data?.project ?? lookups.projects.find((entry) => entry.code === params.project) ?? null;

  return (
    <>
      <PageHeader
        icon={meta.icon}
        title={meta.title}
        description={project ? `Drawing submission and approval for ${project.displayName}${project.displayClient ? ` · ${project.displayClient}` : ''}.` : 'Drawing submission and approval.'}
        actions={
          <>
            <ProjectSelect projects={lookups.projects} value={params.project} onChange={(code) => params.set({ project: code, status: null, schedule: null, scope: null, q: null })} className="sm:w-56" />
            {view === 'register' && can.export && (
              <Button size="sm" variant="outline" onClick={() => void exportView()} disabled={!items.length}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            {can.add && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <ListPlus className="mr-2 h-4 w-4" /> Add Item
              </Button>
            )}
          </>
        }
      />

      <MdlError message={register.error} onRetry={register.reload} />

      {!data ? (
        register.loading ? <MdlLoading /> : null
      ) : view === 'reports' ? (
        <ReportsView items={items} today={today} project={data.project} canExport={can.export} onSelect={openDrawing} />
      ) : view === 'pending' ? (
        <PendingView items={items} today={today} onSelect={openDrawing} />
      ) : view === 'calendar' ? (
        <CalendarView items={items} today={today} onSelect={(item) => openDrawing(item, null)} />
      ) : view === 'gantt' ? (
        <GanttView items={items} today={today} onSelect={(item) => openDrawing(item, null)} />
      ) : (
        <RegisterView
          key={data.project.code}
          items={items}
          today={today}
          filters={{ ...filters, set: params.set }}
          actions={{
            canEdit: can.edit,
            canDelete: can.delete,
            userId: user?.id,
            onEdit: openDrawing,
            onEditDetails: setDetailsTarget,
            onAddSub: (item) => setDrawingTarget({ item, sub: emptySubDrawing(crypto.randomUUID()), isNew: true }),
            onRemoveSub: (item, sub) => setSubToRemove({ item, sub }),
            onDelete: setItemToDelete,
            onOpenFile: openFile,
          }}
        />
      )}

      <DrawingDialog target={activeTarget} today={today} canEdit={can.edit} onClose={closeDrawing} onSaved={register.replaceItem} />
      <EditItemDialog item={detailsTarget} onOpenChange={(open) => !open && setDetailsTarget(null)} onSaved={register.replaceItem} />
      <RemoveSubDrawingDialog target={subToRemove} onClose={() => setSubToRemove(null)} onRemoved={register.replaceItem} />
      <DeleteItemDialog target={itemToDelete} onClose={() => setItemToDelete(null)} onDeleted={(id) => register.replaceItem({ id, removed: true })} />
      {data && (
        <AddItemDialog
          projectCode={data.project.code}
          open={showAdd}
          onOpenChange={setShowAdd}
          onAdded={() => {
            register.reload();
            if (view !== 'register') router.push(`/master-drawing-list/register?project=${encodeURIComponent(data.project.code)}`);
          }}
        />
      )}
    </>
  );
}
