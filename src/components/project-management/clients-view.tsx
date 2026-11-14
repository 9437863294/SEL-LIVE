"use client";

/**
 * Settings › Clients, from the user's mock-up (`sel-pm-projects-settings`): an iris band with the
 * count and "New Client", then one card per client — initials avatar, GSTIN, status, and its
 * contract terms as mini-tiles — with edit and delete; an empty state with its own "New Client".
 *
 * Props-only: the page loads and writes (`onSave`, `onDelete`) and decides permissions, so this
 * view can be rendered with fabricated data.
 */

import { useMemo, useState } from "react";
import { Building2, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { Client } from "@/lib/types";
import type { PMFieldSetting } from "@/components/project-management/use-field-control";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { HERO_PRIMARY_BUTTON, HeroBand } from "@/components/project-management/hero-band";
import { DprReportCard, DprReportZero } from "@/components/project-management/dpr/reports-parts";
import { ClientDialog, type ClientForm } from "@/components/project-management/client-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ClientsViewProps {
  clients: readonly Client[];
  isLoading: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Field Control's live setting for a Client Master field (label, visible, required). */
  fieldControl: (key: string) => PMFieldSetting;
  /** Writes a new (`id` null) or changed client; resolves true when it saved. */
  onSave: (input: { id: string | null; form: ClientForm }) => Promise<boolean>;
  /** Deletes a client; resolves true when it went (false when blocked or failed — the page says why). */
  onDelete: (client: Client) => Promise<boolean>;
}

const CREST = { from: "#a5b4fc", to: "#4f46e5" } as const;

/** The avatar's gradient follows the client (a hash of its id), never its place in the list. */
const AVATARS = [
  ["#818cf8", "#4f46e5"],
  ["#f472b6", "#db2777"],
  ["#34d399", "#059669"],
  ["#fb923c", "#ea580c"],
  ["#38bdf8", "#0284c7"],
] as const;
const avatarFor = (seed: string) => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return AVATARS[Math.abs(hash) % AVATARS.length];
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

const term = (value: number | null | undefined, unit: string) =>
  value == null ? null : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}${unit}`;

export function ClientsView({
  clients,
  isLoading,
  canAdd,
  canEdit,
  canDelete,
  fieldControl,
  onSave,
  onDelete,
}: ClientsViewProps) {
  const back = useBackNavigation("/project-management/settings", { fallbackLabel: "Settings" });
  const [editing, setEditing] = useState<Client | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeCount = useMemo(() => clients.filter((client) => client.status === "Active").length, [clients]);
  const otherNames = useMemo(
    () =>
      clients
        .filter((client) => client.id !== editing?.id)
        .map((client) => client.name.trim().toLowerCase()),
    [clients, editing?.id],
  );

  const openNew = () => {
    setEditing(null);
    setIsDialogOpen(true);
  };
  const openEdit = (client: Client) => {
    setEditing(client);
    setIsDialogOpen(true);
  };
  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (await onDelete(deleteTarget)) setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const newButton = (className?: string) => (
    <Button className={className} onClick={openNew} disabled={!canAdd}>
      <Plus className="mr-2 h-4 w-4" />
      New Client
    </Button>
  );

  return (
    <div className="space-y-4">
      <HeroBand
        back={back}
        icon={Building2}
        crumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Settings", href: "/project-management/settings" },
        ]}
        title="Clients"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} · ${activeCount} active`}
        actions={newButton(HERO_PRIMARY_BUTTON)}
        band="iris"
      />

      <DprReportCard
        icon={Building2}
        colours={[CREST.from, CREST.to]}
        title="All clients"
        subtitle="Contract terms default into each project from here"
      >
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3.5 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-48 rounded-[18px]" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="pb-6">
            <DprReportZero
              icon={Users}
              colours={["#a5b4fc", "#4f46e5"]}
              glow={["rgba(165, 180, 252, 0.6)", "rgba(244, 114, 182, 0.4)"]}
              title="No clients yet"
              text="Add the customers projects are executed for."
            />
            <div className="-mt-4 flex justify-center">{newButton()}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={() => openEdit(client)}
                onDelete={() => setDeleteTarget(client)}
              />
            ))}
          </div>
        )}
      </DprReportCard>

      <ClientDialog
        open={isDialogOpen}
        client={editing}
        otherNames={otherNames}
        fieldControl={fieldControl}
        onClose={closeDialog}
        onSave={(form) => onSave({ id: editing?.id ?? null, form })}
      />

      {/* One confirmation for the whole list, so a card never owns a dialog of its own. */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Projects still linked to this client will block the delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // Kept open until the delete settles; a blocked delete leaves it to be cancelled.
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ClientCard({
  client,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  client: Client;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [from, to] = avatarFor(client.id);
  const active = client.status === "Active";
  const tiles: Array<[string, string | null]> = [
    ["Pay terms", term(client.paymentTermsDays, " d")],
    ["Retention", term(client.retentionPct, "%")],
    ["TDS", term(client.defaultTdsPct, "%")],
    ["Warranty", term(client.warrantyMonths, " m")],
    ["LD rate", term(client.ldRatePct, "%/wk")],
    ["LD cap", term(client.ldCapPct, "%")],
  ];
  const security = term(client.performanceSecurityPct, "%");
  const address = client.addresses?.[0]?.trim() ?? "";
  return (
    <article
      className="flex min-w-0 flex-col rounded-[18px] border border-border/70 bg-card p-4"
      style={{ backgroundImage: `linear-gradient(135deg, ${to}0f, transparent 60%)` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="keep-light flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-sm font-extrabold text-white"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
          aria-hidden="true"
        >
          {initials(client.name) || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px]" title={client.name}>
            {client.name}
          </b>
          <small className="block truncate text-xs font-bold text-muted-foreground" title={client.gstin || undefined}>
            {client.gstin ? `GSTIN ${client.gstin}` : "No GSTIN"}
          </small>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
            active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {client.status}
        </span>
      </div>

      {address ? (
        <p className="mt-2 truncate text-xs text-muted-foreground" title={address}>
          {address}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-1.5">
        {tiles.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-[10px] border border-border/70 bg-background px-2 py-1.5">
            <dt className="truncate text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className={cn("truncate text-sm font-extrabold tabular-nums", value ? "" : "text-muted-foreground/60")}>
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex min-w-0 items-end gap-2">
        <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
          {[
            security ? `Performance security ${security}` : null,
            client.inspectionRegime?.trim() ? `Inspection: ${client.inspectionRegime.trim()}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0 rounded-[10px]"
          aria-label={`Edit ${client.name}`}
          title="Edit"
          disabled={!canEdit}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${client.name}`}
          title="Delete"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
