/**
 * Bulk tower import.
 *
 * A tower schedule arrives from the client as a spreadsheet — 186 rows of tower number, type,
 * location, coordinates and contractor — so that is the shape this accepts. Column order is not
 * fixed and headings vary between clients ("Tower No", "Loc No", "Structure No" all mean the same
 * thing), so headings are matched by alias rather than position.
 *
 * The parse is deliberately all-or-nothing per row and never partially applies: a row with a bad
 * coordinate is reported and skipped rather than imported with the coordinate dropped, because a
 * tower silently missing its GPS is a tower missing from the map report with no trace of why.
 *
 * Pure — no Firebase, no exceljs, no DOM — so the parsing rules are unit-testable with `node --test`.
 * The Excel/CSV file reading lives in the import dialog component.
 */

import {
  parseTowerSequence,
  validateTowerDraft,
  type ProjectTowerDraft,
} from "./project-management-tower-progress.ts";

export interface TowerImportColumn {
  key: keyof ProjectTowerDraft;
  label: string;
  /** Lower-cased heading aliases, punctuation stripped. */
  aliases: string[];
  required?: boolean;
}

export const TOWER_IMPORT_COLUMNS: TowerImportColumn[] = [
  {
    key: "towerNo",
    label: "Tower No",
    aliases: ["towerno", "tower", "towernumber", "locno", "locationno", "structureno", "no", "slno"],
    required: true,
  },
  {
    key: "towerType",
    label: "Tower Type",
    aliases: ["towertype", "type", "structuretype", "towerdesign"],
  },
  {
    key: "section",
    label: "Section",
    aliases: ["section", "reach", "stretch", "segment"],
  },
  {
    key: "location",
    label: "Location",
    aliases: ["location", "village", "place", "site", "chainage"],
  },
  {
    key: "latitude",
    label: "Latitude",
    aliases: ["latitude", "lat", "gpslat", "northing"],
  },
  {
    key: "longitude",
    label: "Longitude",
    aliases: ["longitude", "long", "lon", "lng", "gpslong", "easting"],
  },
  {
    key: "contractor",
    label: "Contractor",
    aliases: ["contractor", "agency", "subcontractor", "vendor"],
  },
  {
    key: "spanToNextM",
    label: "Span To Next (m)",
    aliases: ["spantonextm", "spantonext", "span", "spanlength", "spanm", "spanmetres", "spanmeters"],
  },
];

/** The header row a downloaded template carries. */
export const TOWER_IMPORT_TEMPLATE_HEADERS = TOWER_IMPORT_COLUMNS.map((column) => column.label);

/** A sample row, so the template shows the expected coordinate format rather than describing it. */
export const TOWER_IMPORT_TEMPLATE_SAMPLE = [
  "T-001",
  "DA+3",
  "Section 1",
  "Village ABC",
  "20.3456",
  "85.4567",
  "ABC Contractor",
  "320",
];

const normaliseHeading = (value: string): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface TowerImportIssue {
  /** 1-based row number as it appears in the user's sheet, header included. */
  row: number;
  towerNo: string;
  message: string;
}

export interface TowerImportResult {
  /** Rows that parsed and validated, ready to write. */
  towers: ProjectTowerDraft[];
  /** Rows that were rejected, each with the reason. */
  issues: TowerImportIssue[];
  /** Rows skipped because the tower already exists in the project or repeats within the file. */
  duplicates: TowerImportIssue[];
  /** Which sheet column each recognised field was read from, for the preview's header mapping. */
  columnMap: Partial<Record<keyof ProjectTowerDraft, string>>;
  /** Headings present in the sheet that this importer does not use. */
  unmappedHeadings: string[];
}

const parseCoordinate = (raw: string): number | undefined | null => {
  const text = raw.trim();
  if (!text) return undefined;
  // Accepts "20.3456", "20.3456 N", "20.3456N" and "N 20.3456"; a trailing S/W flips the sign, which
  // is how some client schedules record the southern or western hemisphere.
  const match = text.match(/^([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*([NSEW])?$/i);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  const hemisphere = (match[1] || match[3] || "").toUpperCase();
  return hemisphere === "S" || hemisphere === "W" ? -Math.abs(value) : value;
};

const parseNumber = (raw: string): number | undefined | null => {
  const text = raw.replace(/,/g, "").trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/**
 * Parses a sheet — first row headings, the rest data — into tower drafts.
 *
 * `existingTowerNos` is what makes a re-import safe: rows already in the project are reported as
 * duplicates and skipped rather than overwriting a tower whose activities and photographs are
 * already recorded against it. Re-importing a corrected schedule therefore adds the new towers and
 * leaves recorded progress untouched.
 */
export function parseTowerImportRows(
  rows: readonly (readonly string[])[],
  existingTowerNos: readonly string[] = [],
): TowerImportResult {
  const result: TowerImportResult = {
    towers: [],
    issues: [],
    duplicates: [],
    columnMap: {},
    unmappedHeadings: [],
  };

  const headerRow = rows.find((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!headerRow) {
    result.issues.push({ row: 1, towerNo: "", message: "The file is empty." });
    return result;
  }
  const headerIndex = rows.indexOf(headerRow);

  const indexByField = new Map<keyof ProjectTowerDraft, number>();
  const usedColumns = new Set<number>();
  headerRow.forEach((rawHeading, columnIndex) => {
    const heading = normaliseHeading(String(rawHeading ?? ""));
    if (!heading) return;
    const column = TOWER_IMPORT_COLUMNS.find(
      (candidate) =>
        !indexByField.has(candidate.key) &&
        (normaliseHeading(candidate.label) === heading || candidate.aliases.includes(heading)),
    );
    if (column) {
      indexByField.set(column.key, columnIndex);
      usedColumns.add(columnIndex);
      result.columnMap[column.key] = String(rawHeading).trim();
    }
  });

  result.unmappedHeadings = headerRow
    .map((heading, columnIndex) => (usedColumns.has(columnIndex) ? "" : String(heading ?? "").trim()))
    .filter(Boolean);

  const missingRequired = TOWER_IMPORT_COLUMNS.filter(
    (column) => column.required && !indexByField.has(column.key),
  );
  if (missingRequired.length) {
    result.issues.push({
      row: headerIndex + 1,
      towerNo: "",
      message: `The sheet needs a ${missingRequired.map((column) => `"${column.label}"`).join(" and ")} column.`,
    });
    return result;
  }

  const cell = (row: readonly string[], field: keyof ProjectTowerDraft): string => {
    const index = indexByField.get(field);
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };

  const seen = new Set(existingTowerNos.map((towerNo) => towerNo.trim().toLowerCase()));

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + 2 + offset;
    if (!row.some((value) => String(value ?? "").trim())) return; // blank spacer row

    const towerNo = cell(row, "towerNo");
    if (!towerNo) {
      result.issues.push({ row: rowNumber, towerNo: "", message: "Tower number is blank." });
      return;
    }
    if (seen.has(towerNo.toLowerCase())) {
      result.duplicates.push({
        row: rowNumber,
        towerNo,
        message: "Already in this project — skipped so recorded progress is not overwritten.",
      });
      return;
    }

    const latitude = parseCoordinate(cell(row, "latitude"));
    const longitude = parseCoordinate(cell(row, "longitude"));
    const span = parseNumber(cell(row, "spanToNextM"));

    if (latitude === null) {
      result.issues.push({ row: rowNumber, towerNo, message: `Latitude "${cell(row, "latitude")}" is not a coordinate.` });
      return;
    }
    if (longitude === null) {
      result.issues.push({ row: rowNumber, towerNo, message: `Longitude "${cell(row, "longitude")}" is not a coordinate.` });
      return;
    }
    if (span === null) {
      result.issues.push({ row: rowNumber, towerNo, message: `Span "${cell(row, "spanToNextM")}" is not a number.` });
      return;
    }

    const draft: ProjectTowerDraft = {
      towerNo,
      towerType: cell(row, "towerType") || undefined,
      section: cell(row, "section") || undefined,
      location: cell(row, "location") || undefined,
      latitude,
      longitude,
      contractor: cell(row, "contractor") || undefined,
      spanToNextM: span,
    };

    const errors = validateTowerDraft(draft, []);
    if (errors.length) {
      result.issues.push({ row: rowNumber, towerNo, message: errors[0].message });
      return;
    }

    seen.add(towerNo.toLowerCase());
    result.towers.push(draft);
  });

  result.towers.sort(
    (a, b) =>
      parseTowerSequence(a.towerNo) - parseTowerSequence(b.towerNo) ||
      a.towerNo.localeCompare(b.towerNo, undefined, { numeric: true }),
  );

  return result;
}

/**
 * Splits delimited text into rows of cells, honouring quoted fields that contain the delimiter or a
 * line break. Written out rather than using `split(",")` because a location column routinely holds
 * "Village ABC, Dist XYZ", which a naive split shifts every following column by one.
 */
export function parseDelimitedText(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Guesses the delimiter from the header line, so tab- and semicolon-separated exports also load. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<[string, number]> = [
    [",", (firstLine.match(/,/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}
