/**
 * What the Master Drawing List API accepts, as zod schemas. The routes parse every body with these,
 * whatever the dialog already checked; the record rules themselves are in `steps.ts`.
 */

import { z } from 'zod';

import { isIsoDate } from './derive.ts';
import { OVERALL_STATUSES, REVISION_ROUNDS, REVISION_STATUSES } from './drawings.ts';
import { SCHEDULES, SCOPES } from './types.ts';

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
  fileName: text(300).optional(),
  filePath: text(600).optional(),
});

/** The Drawing Details dialog, for an item's own drawing or one of its sub-drawings. */
export const drawingFormSchema = z.object({
  title: text(200),
  assignedToId: text(200),
  description: text(2000),
  group: text(200),
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

/** Add drawing item. The Sl. No. and position are given by the server. */
export const newItemInputSchema = z.object({
  projectCode: z.string().trim().min(1, 'Choose a project.'),
  schedule: z.enum(SCHEDULES, { errorMap: () => ({ message: 'Choose a schedule.' }) }),
  scope: z.enum(SCOPES, { errorMap: () => ({ message: 'Choose a scope.' }) }),
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
export const importInputSchema = z.object({
  grid: z.record(gridSheet),
  mode: z.enum(['preview', 'import']),
  overwrite: z.boolean().default(false),
});

/** Link a drawing list to an ERP project, or unlink it (null). */
export const projectLinkInputSchema = z.object({
  projectId: z.string().trim().min(1).max(200).nullable(),
});

export type DrawingSaveInput = z.output<typeof drawingSaveInputSchema>;
export type NewItemInput = z.output<typeof newItemInputSchema>;
export type ProjectLinkInput = z.output<typeof projectLinkInputSchema>;
export type NewProjectInput = z.output<typeof newProjectInputSchema>;
export type ImportInput = z.output<typeof importInputSchema>;
