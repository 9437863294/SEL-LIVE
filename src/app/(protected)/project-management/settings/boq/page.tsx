"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { PageHeader } from "@/components/shared/page-header";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BOQ_COLUMN_SETTINGS_COLLECTION,
  BOQ_COLUMN_SETTINGS_DOC,
  DEFAULT_BOQ_COLUMNS,
  mergeBoqColumns,
  type BoqColumnDataType,
  type BoqColumnConfig,
} from "@/lib/project-management-boq-columns";

const SETTINGS_PERMISSION = "Project Management.Settings";
const PROJECT_MAPPINGS_COLLECTION = "projectManagementProjects";

/** One register row: the column config, keyed for the list, with its position for the move buttons. */
type BoqColumnRow = { id: string; column: BoqColumnConfig; index: number };

export default function ProjectManagementBoqSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const [columns, setColumns] = useState<BoqColumnConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDataType, setNewDataType] = useState<BoqColumnDataType>("text");

  const canView = can("View", SETTINGS_PERMISSION);
  const canEdit = can("Edit", SETTINGS_PERMISSION);

  const discoverImportedKeys = useCallback(async () => {
    const mappingsSnapshot = await getDocs(
      collection(db, PROJECT_MAPPINGS_COLLECTION),
    );
    const globalProjectIds = Array.from(
      new Set(
        mappingsSnapshot.docs
          .map((mappingDoc) => mappingDoc.data().globalProjectId as string | undefined)
          .filter((projectId): projectId is string => Boolean(projectId)),
      ),
    );

    const itemSnapshots = await Promise.all(
      globalProjectIds.map((projectId) =>
        getDocs(
          query(collection(db, "projects", projectId, "boqItems"), limit(50)),
        ),
      ),
    );

    return Array.from(
      new Set(
        itemSnapshots.flatMap((snapshot) =>
          snapshot.docs.flatMap((itemDoc) => Object.keys(itemDoc.data())),
        ),
      ),
    );
  }, []);

  const loadColumns = useCallback(async () => {
    setIsLoading(true);
    try {
      const [settingsSnapshot, discoveredKeys] = await Promise.all([
        getDoc(doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC)),
        discoverImportedKeys(),
      ]);
      setColumns(
        mergeBoqColumns(settingsSnapshot.data()?.columns, discoveredKeys),
      );
    } catch (error) {
      console.error("Failed to load BOQ column settings:", error);
      setColumns(mergeBoqColumns(undefined));
      toast({
        title: "Unable to load every imported column",
        description: "Default BOQ columns are available and can still be configured.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [discoverImportedKeys, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadColumns();
  }, [canView, isAuthLoading, loadColumns]);

  const updateColumn = (
    key: string,
    changes: Partial<BoqColumnConfig>,
  ) => {
    setColumns((current) =>
      current.map((column) =>
        column.key === key ? { ...column, ...changes } : column,
      ),
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    setColumns((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered.map((column, order) => ({ ...column, order }));
    });
  };

  const addColumn = () => {
    const key = newKey.trim();
    if (!key) return;
    if (columns.some((column) => column.key.toLowerCase() === key.toLowerCase())) {
      toast({
        title: "Column already exists",
        description: "Use the existing row to configure this column.",
        variant: "destructive",
      });
      return;
    }

    setColumns((current) => [
      ...current,
      {
        key,
        label: newLabel.trim() || key,
        dataType: newDataType,
        showInCosting: false,
        showInOperational: false,
        order: current.length,
      },
    ]);
    setNewKey("");
    setNewLabel("");
    setNewDataType("text");
  };

  const removeColumn = (key: string) => {
    setColumns((current) =>
      current
        .filter((column) => column.key !== key)
        .map((column, order) => ({ ...column, order })),
    );
  };

  const refreshImportedColumns = async () => {
    setIsDiscovering(true);
    try {
      const discoveredKeys = await discoverImportedKeys();
      const next = mergeBoqColumns(columns, discoveredKeys);
      const added = next.length - columns.length;
      setColumns(next);
      toast({
        title: added ? `${added} imported column${added === 1 ? "" : "s"} found` : "Columns are up to date",
      });
    } catch (error) {
      console.error("Failed to discover BOQ columns:", error);
      toast({ title: "Unable to scan imported columns", variant: "destructive" });
    } finally {
      setIsDiscovering(false);
    }
  };

  const saveColumns = async () => {
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC),
        {
          columns: columns.map((column, order) => ({ ...column, order })),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({ title: "BOQ column configuration saved" });
    } catch (error) {
      console.error("Failed to save BOQ column settings:", error);
      toast({ title: "Unable to save BOQ columns", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-9 w-56" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="BOQ Settings" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Project Management settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  const listColumns: PmListColumn<BoqColumnRow>[] = [
    {
      // On a phone card the pair becomes two full-width buttons along the foot — far easier to
      // hit than two arrows in a table cell.
      header: "Order",
      mobile: "footer",
      className: "w-28",
      cell: ({ column, index }) => (
        <div className="flex w-full gap-1 sm:w-auto">
          <Button
            variant="ghost"
            size="icon"
            className="max-sm:border"
            onClick={() => moveColumn(index, -1)}
            disabled={!canEdit || index === 0}
            aria-label={`Move ${column.label} up`}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="max-sm:border"
            onClick={() => moveColumn(index, 1)}
            disabled={!canEdit || index === columns.length - 1}
            aria-label={`Move ${column.label} down`}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
    {
      header: "Stored key",
      mobile: "title",
      className: "text-xs",
      cell: ({ column }) => <span className="break-words font-mono">{column.key}</span>,
    },
    {
      header: "Display label",
      className: "min-w-56",
      cell: ({ column }) => (
        <Input
          value={column.label}
          onChange={(event) =>
            updateColumn(column.key, { label: event.target.value })
          }
          disabled={!canEdit}
        />
      ),
    },
    {
      header: "Validation type",
      className: "min-w-48",
      cell: ({ column }) => (
        <Select
          value={column.dataType}
          onValueChange={(dataType: BoqColumnDataType) =>
            updateColumn(column.key, { dataType })
          }
          disabled={!canEdit}
        >
          <SelectTrigger aria-label={`Validation type for ${column.label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="percentage">Percentage (0–100)</SelectItem>
            <SelectItem value="date">Date</SelectItem>
            <SelectItem value="yesno">Yes/No</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      header: "BOQ Costing",
      className: "text-center",
      cell: ({ column }) => (
        // Left-aligned under its label on a phone card, centred in its column on a desktop.
        <div className="flex sm:justify-center">
          <Switch
            checked={column.showInCosting}
            onCheckedChange={(showInCosting) =>
              updateColumn(column.key, { showInCosting })
            }
            disabled={!canEdit}
            aria-label={`Show ${column.label} in BOQ Costing`}
          />
        </div>
      ),
    },
    {
      header: "Operational BOQ",
      className: "text-center",
      cell: ({ column }) => (
        <div className="flex sm:justify-center">
          <Switch
            checked={column.showInOperational}
            onCheckedChange={(showInOperational) =>
              updateColumn(column.key, { showInOperational })
            }
            disabled={!canEdit}
            aria-label={`Show ${column.label} in Operational BOQ`}
          />
        </div>
      ),
    },
    {
      header: "Remove",
      align: "right",
      mobile: "aside",
      className: "w-20",
      cell: ({ column }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeColumn(column.key)}
          disabled={
            !canEdit ||
            DEFAULT_BOQ_COLUMNS.some((defaultColumn) => defaultColumn.key === column.key)
          }
          aria-label={`Remove ${column.label}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ];

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 max-sm:[--card-pad:1rem] sm:p-6">
      {/* Sticky: Save Columns is the only save, and the column list it saves runs long. `sm:`
          margins match this page's `sm:p-6`. */}
      <PageHeader
        sticky
        title="BOQ Column Settings"
        description="Configure labels, validation data types, order, and visibility for both BOQ views."
        icon={ClipboardList}
        backHref="/project-management/settings"
        backLabel="Back to Settings"
        className="sm:-mx-6 sm:px-6"
        actions={
          <>
            <Button
              variant="outline"
              onClick={refreshImportedColumns}
              disabled={isDiscovering}
            >
              {isDiscovering ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Scan Imports
            </Button>
            <Button onClick={saveColumns} disabled={!canEdit || isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Columns
            </Button>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Add Dynamic Column
          </CardTitle>
          <CardDescription>
            The column key must exactly match the Excel header or stored BOQ field.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_220px_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="column-key">Column key</Label>
            <Input
              id="column-key"
              placeholder="For example: Drawing No"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="column-label">Display label</Label>
            <Input
              id="column-label"
              placeholder="Optional custom label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="column-data-type">Validation data type</Label>
            <Select
              value={newDataType}
              onValueChange={(dataType: BoqColumnDataType) => setNewDataType(dataType)}
              disabled={!canEdit}
            >
              <SelectTrigger id="column-data-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="percentage">Percentage (0–100)</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="yesno">Yes/No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addColumn} disabled={!canEdit || !newKey.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Column
          </Button>
        </CardContent>
      </Card>

      {/* On a phone the card drops its frame: the header reads as a section heading and the
          column cards stand on the page, rather than sitting as cards inside a card. */}
      <Card className="max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
        <CardHeader className="max-sm:px-0 max-sm:pt-0">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            BOQ Columns
          </CardTitle>
          <CardDescription>
            Data types are applied during BOQ import validation. Imported headers stay hidden until enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <PmDataList
            rows={columns.map((column, index) => ({ id: column.key, column, index }))}
            columns={listColumns}
            className="sm:rounded-none sm:border-0 sm:shadow-none"
          />
        </CardContent>
      </Card>
    </main>
  );
}
