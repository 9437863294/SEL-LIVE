"use client";

/**
 * Tower master maintenance: the add/edit form, the bulk import, and the delete confirmation.
 *
 * The import is the one that matters. A tower schedule arrives as a client spreadsheet and nobody is
 * going to key 186 rows, so the flow is: pick the file, see exactly what will be created and what
 * will be skipped and why, then commit. Nothing is written until that preview has been seen — an
 * import that silently drops fourteen rows for a coordinate typo is worse than one that refuses.
 */

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { exportWorkbook } from "@/lib/report-excel";
import {
  validateTowerDraft,
  type ProjectTower,
  type ProjectTowerDraft,
} from "@/lib/project-management-tower-progress";
import {
  TOWER_IMPORT_COLUMNS,
  TOWER_IMPORT_TEMPLATE_HEADERS,
  TOWER_IMPORT_TEMPLATE_SAMPLE,
  detectDelimiter,
  parseDelimitedText,
  parseTowerImportRows,
  type TowerImportResult,
} from "@/lib/project-management-tower-import";
import {
  TOWER_CONCURRENT_UPDATE,
  TOWER_HAS_HISTORY,
  deleteTower,
  importTowers,
  saveTower,
} from "@/lib/project-management-tower-service";
import { useTowerProgress } from "./tower-progress-provider";

/* ── Add / edit ─────────────────────────────────────────────────────────────────────────────── */

const emptyDraft = (): ProjectTowerDraft => ({
  towerNo: "",
  towerType: "",
  section: "",
  location: "",
  latitude: undefined,
  longitude: undefined,
  contractor: "",
  spanToNextM: undefined,
});

const draftOf = (tower: ProjectTower): ProjectTowerDraft => ({
  towerNo: tower.towerNo,
  towerType: tower.towerType ?? "",
  section: tower.section ?? "",
  location: tower.location ?? "",
  latitude: tower.latitude,
  longitude: tower.longitude,
  contractor: tower.contractor ?? "",
  spanToNextM: tower.spanToNextM,
});

/** Empty means "not recorded", which is different from zero — so a blank never becomes 0. */
const numberOrUndefined = (value: string): number | undefined => {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export function TowerFormDialog({
  tower,
  open,
  onOpenChange,
  onSaved,
}: {
  tower: ProjectTower | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { project, towers, actor, reload } = useTowerProgress();
  const { toast } = useToast();
  const [draft, setDraft] = useState<ProjectTowerDraft>(() => (tower ? draftOf(tower) : emptyDraft()));
  const [isSaving, setIsSaving] = useState(false);
  const [lastOpenKey, setLastOpenKey] = useState("");

  // Re-seeds when the dialog opens for a different tower, without an effect that would fight the
  // user's own edits on every render.
  const openKey = `${open}:${tower?.id ?? "new"}`;
  if (open && openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    setDraft(tower ? draftOf(tower) : emptyDraft());
  }

  const otherTowerNos = useMemo(
    () => towers.filter((entry) => entry.id !== tower?.id).map((entry) => entry.towerNo),
    [towers, tower?.id],
  );

  const errors = useMemo(() => validateTowerDraft(draft, otherTowerNos), [draft, otherTowerNos]);

  const set = <K extends keyof ProjectTowerDraft>(key: K, value: ProjectTowerDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (!project || !actor) return;
    if (errors.length) {
      toast({ title: "Complete the tower", description: errors[0].message, variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await saveTower(project, draft, actor, tower ?? undefined);
      toast({ title: `Tower ${draft.towerNo} ${tower ? "updated" : "added"}` });
      onOpenChange(false);
      await reload();
      onSaved?.();
    } catch (error) {
      console.error("Failed to save the tower:", error);
      const concurrent = error instanceof Error && error.message === TOWER_CONCURRENT_UPDATE;
      toast({
        title: concurrent ? "This tower changed" : "Could not save the tower",
        description: concurrent
          ? "Another user updated or removed it. Refresh the register before editing again."
          : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isSaving ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tower ? `Edit ${tower.towerNo}` : "Add tower"}</DialogTitle>
          <DialogDescription>
            {tower
              ? "Editing tower details never changes recorded progress or photographs."
              : "A tower starts with all seven activities Not Started."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tower-no">Tower number *</Label>
            <Input
              id="tower-no"
              value={draft.towerNo}
              onChange={(event) => set("towerNo", event.target.value)}
              maxLength={40}
              placeholder="T-037"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-type">Tower type</Label>
            <Input
              id="tower-type"
              value={draft.towerType ?? ""}
              onChange={(event) => set("towerType", event.target.value)}
              maxLength={60}
              placeholder="DA+3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-section">Section</Label>
            <Input
              id="tower-section"
              value={draft.section ?? ""}
              onChange={(event) => set("section", event.target.value)}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-location">Location</Label>
            <Input
              id="tower-location"
              value={draft.location ?? ""}
              onChange={(event) => set("location", event.target.value)}
              maxLength={160}
              placeholder="Village ABC"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-lat">Latitude</Label>
            <Input
              id="tower-lat"
              type="number"
              step="0.000001"
              value={draft.latitude ?? ""}
              onChange={(event) => set("latitude", numberOrUndefined(event.target.value))}
              placeholder="20.345600"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-lon">Longitude</Label>
            <Input
              id="tower-lon"
              type="number"
              step="0.000001"
              value={draft.longitude ?? ""}
              onChange={(event) => set("longitude", numberOrUndefined(event.target.value))}
              placeholder="85.456700"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-contractor">Contractor</Label>
            <Input
              id="tower-contractor"
              value={draft.contractor ?? ""}
              onChange={(event) => set("contractor", event.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tower-span">Span to next tower (m)</Label>
            <Input
              id="tower-span"
              type="number"
              min={0}
              step={1}
              value={draft.spanToNextM ?? ""}
              onChange={(event) => set("spanToNextM", numberOrUndefined(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Turns strung spans into kilometres on the progress reports.
            </p>
          </div>
        </div>

        {errors.length ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Fix before saving</AlertTitle>
            <AlertDescription>{errors[0].message}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || errors.length > 0}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tower ? "Save changes" : "Add tower"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Delete ─────────────────────────────────────────────────────────────────────────────────── */

export function TowerDeleteDialog({
  tower,
  onOpenChange,
  onDeleted,
}: {
  tower: ProjectTower | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { project, actor, reload } = useTowerProgress();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!project || !actor || !tower) return;
    setIsDeleting(true);
    try {
      await deleteTower(project, tower, actor);
      toast({ title: `Tower ${tower.towerNo} removed` });
      onOpenChange(false);
      await reload();
      onDeleted?.();
    } catch (error) {
      const hasHistory = error instanceof Error && error.message === TOWER_HAS_HISTORY;
      if (!hasHistory) console.error("Failed to delete the tower:", error);
      toast({
        title: hasHistory ? "This tower holds recorded progress" : "Could not remove the tower",
        description: hasHistory
          ? "Its progress updates and photographs are somebody's evidence of work done. Remove those from the tower's timeline first, one at a time."
          : undefined,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={Boolean(tower)} onOpenChange={(open) => !open && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove tower {tower?.towerNo}?</AlertDialogTitle>
          <AlertDialogDescription>
            The tower leaves the register and every report. This is only possible while it holds no
            recorded progress; its audit-log entry remains either way.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Import ─────────────────────────────────────────────────────────────────────────────────── */

/** Reads an .xlsx into a string grid. exceljs is loaded on demand — it is a large dependency and
 *  only this dialog needs it, so it stays out of the module's route chunks. */
async function readWorkbookRows(file: File): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    // exceljs row values are 1-based with a leading hole, and a cell can hold a formula object or a
    // rich-text run rather than a scalar — both flatten to their visible text here.
    const values = (row.values as unknown[]).slice(1);
    rows.push(
      values.map((value) => {
        if (value === null || value === undefined) return "";
        if (typeof value === "object") {
          const cell = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
          if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text ?? "").join("");
          if (cell.text !== undefined) return String(cell.text);
          if (cell.result !== undefined) return String(cell.result);
          return "";
        }
        return String(value);
      }),
    );
  });
  return rows;
}

export function TowerImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}) {
  const { project, towers, actor, reload } = useTowerProgress();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<TowerImportResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const existingTowerNos = useMemo(() => towers.map((tower) => tower.towerNo), [towers]);

  const reset = () => {
    setFileName("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsParsing(true);
    setResult(null);
    setFileName(file.name);
    try {
      const isExcel = /\.xlsx?$/i.test(file.name);
      const rows = isExcel
        ? await readWorkbookRows(file)
        : await file.text().then((text) => parseDelimitedText(text, detectDelimiter(text)));
      setResult(parseTowerImportRows(rows, existingTowerNos));
    } catch (error) {
      console.error("Failed to read the tower schedule:", error);
      toast({
        title: "Could not read the file",
        description: "Save it as .xlsx or .csv and try again.",
        variant: "destructive",
      });
      reset();
    } finally {
      setIsParsing(false);
    }
  };

  const handleTemplate = async () => {
    await exportWorkbook("tower-import-template.xlsx", [
      {
        name: "Towers",
        columns: TOWER_IMPORT_TEMPLATE_HEADERS.map((header) => ({
          header,
          key: header,
          width: Math.max(14, header.length + 4),
        })),
        rows: [
          Object.fromEntries(
            TOWER_IMPORT_TEMPLATE_HEADERS.map((header, index) => [
              header,
              TOWER_IMPORT_TEMPLATE_SAMPLE[index] ?? "",
            ]),
          ),
        ],
      },
    ]);
  };

  const handleImport = async () => {
    if (!project || !actor || !result?.towers.length) return;
    setIsImporting(true);
    try {
      const written = await importTowers(project, result.towers, actor);
      toast({
        title: `${written} tower${written === 1 ? "" : "s"} imported`,
        description: result.duplicates.length
          ? `${result.duplicates.length} already existed and were left untouched.`
          : undefined,
      });
      reset();
      onOpenChange(false);
      await reload();
      onImported?.();
    } catch (error) {
      console.error("Failed to import towers:", error);
      toast({
        title: "The import did not finish",
        description: "Some towers may have been created. Reload the register before retrying.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isImporting) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import tower schedule</DialogTitle>
          <DialogDescription>
            Load the client&apos;s schedule as .xlsx or .csv. Column order does not matter — headings are
            matched by name.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isParsing}>
            {isParsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            Choose file
          </Button>
          <Button variant="ghost" onClick={() => void handleTemplate()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Download template
          </Button>
          {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Recognised columns</p>
          <p className="mt-1">
            {TOWER_IMPORT_COLUMNS.map((column) => `${column.label}${column.required ? " (required)" : ""}`).join(
              " · ",
            )}
          </p>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-100 text-emerald-700">
                {result.towers.length} to create
              </Badge>
              {result.duplicates.length ? (
                <Badge className="bg-amber-100 text-amber-800">
                  {result.duplicates.length} already in project
                </Badge>
              ) : null}
              {result.issues.length ? (
                <Badge className="bg-red-100 text-red-700">{result.issues.length} rejected</Badge>
              ) : null}
              {result.unmappedHeadings.length ? (
                <Badge variant="outline">
                  Ignored columns: {result.unmappedHeadings.join(", ")}
                </Badge>
              ) : null}
            </div>

            {result.issues.length ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>These rows will not be imported</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs">
                    {result.issues.map((issue) => (
                      <li key={`${issue.row}-${issue.message}`}>
                        Row {issue.row}
                        {issue.towerNo ? ` (${issue.towerNo})` : ""}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {result.duplicates.length ? (
              <Alert>
                <Copy className="h-4 w-4" />
                <AlertTitle>{result.duplicates.length} already exist and will be skipped</AlertTitle>
                <AlertDescription className="text-xs">
                  {result.duplicates
                    .slice(0, 25)
                    .map((duplicate) => duplicate.towerNo)
                    .join(", ")}
                  {result.duplicates.length > 25 ? ` and ${result.duplicates.length - 25} more` : ""}
                  . Their recorded progress and photographs are left untouched.
                </AlertDescription>
              </Alert>
            ) : null}

            {result.towers.length ? (
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Tower</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>GPS</TableHead>
                      <TableHead>Contractor</TableHead>
                      <TableHead className="text-right">Span (m)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.towers.map((tower) => (
                      <TableRow key={tower.towerNo}>
                        <TableCell className="font-medium">{tower.towerNo}</TableCell>
                        <TableCell className="text-xs">{tower.towerType || "—"}</TableCell>
                        <TableCell className="text-xs">{tower.section || "—"}</TableCell>
                        <TableCell className="text-xs">{tower.location || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {tower.latitude !== undefined && tower.longitude !== undefined
                            ? `${tower.latitude.toFixed(4)}, ${tower.longitude.toFixed(4)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{tower.contractor || "—"}</TableCell>
                        <TableCell className="text-right text-xs">{tower.spanToNextM ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleImport()}
            disabled={isImporting || !result?.towers.length}
          >
            {isImporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Import {result?.towers.length ?? 0} tower{result?.towers.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
