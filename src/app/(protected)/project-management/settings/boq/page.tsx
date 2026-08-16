"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">BOQ Settings</h1>
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

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/project-management/settings" aria-label="Back to Settings">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
            <ClipboardList className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">BOQ Column Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure labels, validation data types, order, and visibility for both BOQ views.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <Card className="mb-6 overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" />
            Add Dynamic Column
          </CardTitle>
          <CardDescription>
            The column key must exactly match the Excel header or stored BOQ field.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_220px_auto] lg:items-end">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ClipboardList className="h-5 w-5 text-primary" />
            BOQ Columns
          </CardTitle>
          <CardDescription>
            Data types are applied during BOQ import validation. Imported headers stay hidden until enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Order</TableHead>
                  <TableHead>Stored key</TableHead>
                  <TableHead className="min-w-56">Display label</TableHead>
                  <TableHead className="min-w-48">Validation type</TableHead>
                  <TableHead className="text-center">BOQ Costing</TableHead>
                  <TableHead className="text-center">Operational BOQ</TableHead>
                  <TableHead className="w-20 text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {columns.map((column, index) => {
                  const isStandard = DEFAULT_BOQ_COLUMNS.some(
                    (defaultColumn) => defaultColumn.key === column.key,
                  );

                  return (
                    <TableRow key={column.key}>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => moveColumn(index, -1)}
                            disabled={!canEdit || index === 0}
                            aria-label={`Move ${column.label} up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => moveColumn(index, 1)}
                            disabled={!canEdit || index === columns.length - 1}
                            aria-label={`Move ${column.label} down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{column.key}</TableCell>
                      <TableCell>
                        <Input
                          value={column.label}
                          onChange={(event) =>
                            updateColumn(column.key, { label: event.target.value })
                          }
                          disabled={!canEdit}
                        />
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch
                            checked={column.showInCosting}
                            onCheckedChange={(showInCosting) =>
                              updateColumn(column.key, { showInCosting })
                            }
                            disabled={!canEdit}
                            aria-label={`Show ${column.label} in BOQ Costing`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch
                            checked={column.showInOperational}
                            onCheckedChange={(showInOperational) =>
                              updateColumn(column.key, { showInOperational })
                            }
                            disabled={!canEdit}
                            aria-label={`Show ${column.label} in Operational BOQ`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeColumn(column.key)}
                          disabled={!canEdit || isStandard}
                          aria-label={`Remove ${column.label}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
