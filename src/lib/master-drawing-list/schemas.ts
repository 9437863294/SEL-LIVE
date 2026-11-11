/**
 * What the Master Drawing List API accepts, as zod schemas. The routes parse every body with these,
 * whatever the form already checked. Blank text and blank dates arrive as '' from a form and are
 * stored as null.
 */

import { z } from 'zod';

import { isIsoDate } from './derive.ts';
import { SCHEDULES, SCOPES } from './types.ts';

/** Trimmed text, '' / null / missing → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((value) => value || null);

/** 'YYYY-MM-DD', '' / null / missing → null. */
const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || null)
  .refine((value) => value === null || isIsoDate(value), 'Enter a valid date.');

export const isoDateSchema = z.string().trim().refine(isIsoDate, 'Enter a valid date.');

/** Record a submission: the date, and the transmittal (covering letter) number if there is one. */
export const submissionInputSchema = z.object({
  date: isoDateSchema,
  transmittalNo: optionalText(120),
});

/** Record the client's comments, or the approval: the date only. */
export const datedInputSchema = z.object({ date: isoDateSchema });

/** The fields the item's Edit form changes. Planned and target dates are plans, so they may be ahead. */
export const detailsInputSchema = z.object({
  drgNo: optionalText(200),
  plannedSubmission: optionalDate,
  targetApproval: optionalDate,
  remarks: optionalText(2000),
  vendorFinalised: z.boolean(),
  onHold: z.boolean(),
});

export const newItemInputSchema = z.object({
  projectCode: z.string().trim().min(1, 'Choose a project.'),
  schedule: z.enum(SCHEDULES, { errorMap: () => ({ message: 'Choose a schedule.' }) }),
  scope: z.enum(SCOPES, { errorMap: () => ({ message: 'Choose a scope.' }) }),
  group: optionalText(200),
  description: z.string().trim().min(3, 'Enter a description.').max(2000, 'Keep the description under 2000 characters.'),
  drgNo: optionalText(200),
  plannedSubmission: optionalDate,
  targetApproval: optionalDate,
  vendorFinalised: z.boolean(),
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

export type SubmissionInput = z.output<typeof submissionInputSchema>;
export type DatedInput = z.output<typeof datedInputSchema>;
export type DetailsInput = z.output<typeof detailsInputSchema>;
export type NewItemInput = z.output<typeof newItemInputSchema>;
export type ProjectLinkInput = z.output<typeof projectLinkInputSchema>;
export type NewProjectInput = z.output<typeof newProjectInputSchema>;
export type ImportInput = z.output<typeof importInputSchema>;
