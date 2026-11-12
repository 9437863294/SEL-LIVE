/**
 * What the Master Drawing List API accepts, as zod schemas. The routes parse every body with these,
 * whatever the dialog already checked; the record rules themselves are in `steps.ts`.
 */

import { z } from 'zod';

import { isIsoDate } from './derive.ts';
import { OVERALL_STATUSES, REVISION_ROUNDS, REVISION_STATUSES } from './drawings.ts';
import { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS, MDL_FORM_KEYS } from './settings.ts';

/** Trimmed text, '' / null / missing → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((value) => value || null);

/** 'YYYY-MM-DD' or ''. */
const dateOrEmpty = z
  .string()
  .trim()
  .refine((value) => value === '' || isIsoDate(value), 'Enter a valid date.');

const text = (max: number) => z.string().max(max, `Keep this under ${max} characters.`);

export const revisionSchema = z.object({
  round: z.enum(REVISION_ROUNDS),
  submissionDate: dateOrEmpty,
  status: z.union([z.enum(REVISION_STATUSES), z.literal('')]).optional(),
  comments: text(2000),
  commentsDate: dateOrEmpty,
  transmittalNo: text(120).optional(),
  fileName: text(300).optional(),
  filePath: text(600).optional(),
});

/** The Drawing Details dialog, for an item's own drawing or one of its sub-drawings. */
export const drawingFormSchema = z.object({
  title: text(200),
  assignedToId: text(200),
  docNo: text(200),
  drawingNo: text(200),
  plannedStartDate: dateOrEmpty,
  plannedEndDate: dateOrEmpty,
  revisions: z.array(revisionSchema).max(REVISION_ROUNDS.length),
  approveDate: dateOrEmpty,
  status: z.enum(OVERALL_STATUSES),
  remark: text(2000),
});

/** Which record a save is for: the item's own drawing, or a sub-drawing (new or existing). */
export const drawingSaveInputSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item') }),
    z.object({ kind: z.literal('sub'), subId: z.string().trim().min(1).max(100), isNew: z.boolean() }),
  ]),
  form: drawingFormSchema,
});

/**
 * Edit item details: the item's description and the group it sits under. Kept apart from the
 * Drawing Details dialog, so recording a submission or a status never changes what the item is.
 */
export const itemDetailsInputSchema = z.object({
  description: z.string().trim().min(3, 'Enter a description.').max(2000, 'Keep the description under 2000 characters.'),
  group: optionalText(200),
});

/** Add drawing item. The Sl. No. and position are given by the server. */
export const newItemInputSchema = z.object({
  projectCode: z.string().trim().min(1, 'Choose a project.'),
  // Checked against Settings › Schedules & Scopes by the server.
  schedule: z.string().trim().min(1, 'Choose a schedule.').max(60),
  scope: z.string().trim().min(1, 'Choose a scope.').max(60),
  group: optionalText(200),
  description: z.string().trim().min(3, 'Enter a description.').max(2000, 'Keep the description under 2000 characters.'),
  docNo: z.string().trim().max(200).default(''),
  drawingNo: z.string().trim().max(200).default(''),
  plannedStartDate: dateOrEmpty.default(''),
  plannedEndDate: dateOrEmpty.default(''),
});

/** A new drawing list for an ERP project. The code becomes its document id, so it is kept to safe characters. */
export const newProjectInputSchema = z.object({
  projectId: z.string().trim().min(1, 'Choose the ERP project.').max(200),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(40, 'Keep the code under 40 characters.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _ only in the code.'),
  short: z.string().trim().min(1, 'Enter a short name.').max(60, 'Keep the short name under 60 characters.'),
  name: z.string().trim().min(1, 'Enter the full name.').max(300),
  client: optionalText(200),
  drgPrefix: optionalText(60),
});

/** The workbook's three sheets as text cells (`ImportGrid`), and whether to write or only preview. */
const gridCell = z.string().max(5000).nullable();
const gridSheet = z.object({
  headings: z.array(z.string().max(300)).max(200),
  rows: z.array(z.object({ n: z.number().int().positive(), cells: z.record(gridCell) })).max(20000),
});
const COLUMN_ROLE = /^(ignore|slNo|description|drgNo|plannedStart|plannedEnd|approval|status|remarks|sub-[0-9]|com-[0-9])$/;
const rawSheet = z.object({
  name: z.string().max(200),
  rows: z.array(z.object({ n: z.number().int().positive(), cells: z.array(gridCell).max(60) })).max(20000),
});
const sheetMapping = z.object({
  sheet: z.string().max(200),
  include: z.boolean(),
  headerRow: z.number().int().positive(),
  schedule: z.string().trim().min(1).max(60),
  scope: z.string().trim().min(1).max(60),
  // Checked as "sub-0" so that no bracketed colon appears in this file (Tailwind scans src/).
  columns: z.array(z.string().refine((role) => COLUMN_ROLE.test(role.replace(':', '-')), 'Unknown column role.')).max(60),
  skipRows: z.array(z.number().int().positive()).max(20000).optional(),
  templateId: z.string().max(200).optional(),
});

/**
 * The Excel Import: the consolidated three-sheet workbook (`grid`, as before), or a project's own
 * MDL workbook (`source.kind: 'project'`) read into an existing drawing list with the column
 * mapping the page showed. `mode` previews or imports.
 */
export const importInputSchema = z.object({
  mode: z.enum(['preview', 'import']),
  overwrite: z.boolean().default(false),
  /** Keep the confirmed column mappings for the next workbook with the same headings. */
  rememberMappings: z.boolean().default(true),
  /** The file's name, for the import history. */
  fileName: z.string().max(300).optional(),
  grid: z.record(gridSheet).optional(),
  source: z
    .object({
      kind: z.literal('project'),
      projectCode: z.string().trim().min(1, 'Choose the drawing list to import into.'),
      fileName: z.string().max(300),
      sheets: z.array(rawSheet).max(50),
      mappings: z.array(sheetMapping).max(50),
    })
    .optional(),
}).refine((value) => Boolean(value.grid) !== Boolean(value.source), 'Send either the consolidated workbook or a project workbook.');

/** Days, 1–365, or null for none. */
const period = z.number().int().min(1, 'Enter at least 1 day.').max(365, 'Keep it within 365 days.').nullable();

/** Settings › Projects: link a drawing list to an ERP project (null unlinks), and its review periods. */
export const projectLinkInputSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200).nullable().optional(),
    reviewDays: period.optional(),
    resubmitDays: period.optional(),
  })
  .refine((value) => value.projectId !== undefined || value.reviewDays !== undefined || value.resubmitDays !== undefined, 'Nothing to change.');

export type DrawingSaveInput = z.output<typeof drawingSaveInputSchema>;
export type NewItemInput = z.output<typeof newItemInputSchema>;
export type ItemDetailsInput = z.output<typeof itemDetailsInputSchema>;
export type ProjectLinkInput = z.output<typeof projectLinkInputSchema>;
export type NewProjectInput = z.output<typeof newProjectInputSchema>;
export type ImportInput = z.output<typeof importInputSchema>;

/* ── Settings ──────────────────────────────────────────────────────────── */

const masterValue = z.object({ id: z.string().trim().min(1).max(80), name: z.string().trim().min(1, 'Every value needs a name.').max(60), active: z.boolean() });

/** Settings › Schedules & Scopes. */
export const masterDataInputSchema = z.object({
  schedules: z.array(masterValue).min(1).max(50),
  scopes: z.array(masterValue).min(1).max(50),
});

const fieldOverride = z.object({ label: z.string().trim().max(80).optional(), visible: z.boolean().optional(), required: z.boolean().optional() });

/** Settings › Field Control: per form, per field. Unknown forms and fields are dropped by the server. */
export const fieldControlInputSchema = z.object({
  forms: z.record(z.enum(MDL_FORM_KEYS as [string, ...string[]]), z.record(fieldOverride)),
});

const dateRule = z.object({
  enabled: z.boolean(),
  backdateDays: z.number().int().min(0).max(MAX_BACKDATE_DAYS),
  futureDays: z.number().int().min(0).max(MAX_FUTURE_DAYS),
  applySubmission: z.boolean(),
  applyComments: z.boolean(),
  applyApproval: z.boolean(),
});

/** Settings › Date Control: the rule for every drawing list, and lists with their own. */
export const dateControlInputSchema = dateRule.extend({ projects: z.record(dateRule).default({}) });

export type MasterDataInput = z.output<typeof masterDataInputSchema>;
export type FieldControlInput = z.output<typeof fieldControlInputSchema>;
export type DateControlInput = z.output<typeof dateControlInputSchema>;
