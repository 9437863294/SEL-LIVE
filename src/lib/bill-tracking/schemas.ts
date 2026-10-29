/**
 * Request payload schemas for the Bill Tracking API.
 *
 * The API never trusts a value because the form produced it: every route parses its body with one
 * of these, then recomputes anything derived (gross, net, outstanding, status) itself. Derived
 * fields are therefore deliberately absent from the input schemas — a client that sends
 * `outstandingAmount` has it ignored, not honoured.
 */

import { z } from 'zod';

import {
  AGEING_BASES,
  COMMITMENT_STATUSES,
  DEDUCTION_KINDS,
  DOCUMENT_CATEGORIES,
  FOLLOW_UP_METHODS,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  TRANSACTION_TYPES,
  SUMMARY_COLUMNS,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_PERMISSIONS,
} from './types.ts';
import { WORKFLOW_ACTIONS } from './workflow.ts';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-MM-dd date.');
const optionalDate = z.union([dateKey, z.literal('')]).optional().transform((value) => value || undefined);
const money = z.coerce.number().finite('Enter a valid amount.').transform((value) => Math.round(value * 100) / 100);
const optionalText = (max = 500) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : undefined));
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(1000);

/**
 * A deduction line as the form sends it. For a percentage line only the % matters — the server takes
 * it of the configured base; for a fixed line the base amount (before any GST on it) is the input.
 * `amount` is accepted for lines that carry nothing else (legacy rows) and is otherwise recomputed.
 */
export const deductionLineSchema = z.object({
  id: z.string().min(1).max(64),
  deductionTypeId: z.string().min(1).max(64),
  amount: money.optional(),
  baseAmount: money.optional(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  /** GST amounts typed to match the client's deduction (else computed from the rate). */
  cgstAmount: money.optional(),
  sgstAmount: money.optional(),
  igstAmount: money.optional(),
  percentage: z.coerce.number().min(-100).max(100).optional(),
  /** On a debit note under a note rule: take this line of the note's own value instead. */
  ownBase: z.boolean().optional(),
  remarks: optionalText(300),
  deductionDate: optionalDate,
});

export const billInputSchema = z.object({
  billSerialNumber: optionalText(80),
  /** Generate the next number from the configured pattern instead of typing one. */
  autoNumber: z.boolean().optional(),
  serialNumber: z.coerce.number().int().positive().optional(),
  transactionType: z.enum(TRANSACTION_TYPES),
  gstInvoiceNumber: optionalText(80),
  billDate: dateKey,
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  submissionDate: optionalDate,
  passedDate: optionalDate,
  dueDate: optionalDate,
  expectedPaymentDate: optionalDate,
  projectId: z.string().min(1, 'Choose a project.').max(128),
  clientId: optionalText(128),
  dgmOffice: optionalText(120),
  description: optionalText(1000),
  billTypeId: z.string().min(1, 'Choose a sub category.').max(64),
  taxableAmount: money,
  /** Total GST — used only when no GST type is given (the components decide otherwise). */
  gstAmount: money.default(0),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  gstType: z.enum(['cgst-sgst', 'igst', 'none']).optional(),
  cgstAmount: money.optional(),
  sgstAmount: money.optional(),
  igstAmount: money.optional(),
  /** SEL's issuing registration; blank lets the attribution chain decide. */
  gstRegistrationId: optionalText(64),
  /** Credit / debit note: the invoice it adjusts. Required for a credit note. */
  againstBillId: optionalText(128),
  /**
   * The deductions as raised. A credit / debit note may carry its own (TDS on a debit note) but
   * needs none: a certification's deductions apply to the invoice itself, not through a note.
   */
  // Line ids key the computed lines: two alike would collapse into one, stored twice.
  deductions: z
    .array(deductionLineSchema)
    .max(60)
    .default([])
    .refine((lines) => new Set(lines.map((line) => line.id)).size === lines.length, 'Two deduction lines share an id — reload the form and enter them again.'),
  targetWeek: optionalText(10),
  collectionOwnerId: optionalText(128),
  currentStage: optionalText(120),
  remarks: optionalText(2000),
  retentionExpectedReleaseDate: optionalDate,
  retentionDisputed: z.boolean().optional(),
  /**
   * Retention bill only: the slab it releases (head + rate; rate null = the head's fixed amounts).
   * Not coerced — `z.coerce.number()` would turn null into 0%.
   */
  // A slab's rate is above 0 and at most 100 (`retention.ts`); null is the head's fixed amounts.
  releasesRetention: z.object({ deductionTypeId: z.string().min(1).max(64), rate: z.union([z.number().gt(0).max(100), z.null()]) }).optional(),
  taxableOrAdvance: optionalText(20),
  /** Required when a protected field changes on an approved bill, or the change lands in a closed month. */
  changeReason: optionalText(1000),
  /** Optimistic concurrency: the version the editor loaded. */
  expectedVersion: z.coerce.number().int().optional(),
});
export type BillInput = z.infer<typeof billInputSchema>;

/**
 * The client's certification of a bill. The GST type defaults to the raised bill's; a bill imported
 * with one unsplit GST figure is split here (CGST + SGST or IGST) the way the certificate shows it.
 * Its deductions replace the raised ones in what the bill is paid; a different taxable or GST is
 * settled by a credit / debit note against the bill.
 */
export const certificationInputSchema = z.object({
  certifiedDate: dateKey,
  reference: optionalText(120),
  certifiedBy: optionalText(120),
  taxableAmount: money,
  /** Total GST — used only when no GST type is given (a raised bill imported unsplit, kept unsplit). */
  gstAmount: money.default(0),
  /** Omitted = the raised bill's type. */
  gstType: z.enum(['cgst-sgst', 'igst', 'none']).optional(),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  cgstAmount: money.optional(),
  sgstAmount: money.optional(),
  igstAmount: money.optional(),
  deductions: z
    .array(deductionLineSchema)
    .max(60)
    .default([])
    .refine((lines) => new Set(lines.map((line) => line.id)).size === lines.length, 'Two deduction lines share an id — reload the form and enter them again.'),
  remarks: optionalText(2000),
  /** Optimistic concurrency: the certification revision the form loaded (0 = none yet). */
  expectedRevision: z.coerce.number().int().min(0).optional(),
});
export type CertificationInput = z.infer<typeof certificationInputSchema>;

/** A move: `advance` into a configured step (`to`), a named move into a default step, or a side move. */
export const workflowActionSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  to: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  remarks: optionalText(1000),
});
export type WorkflowAction = z.infer<typeof workflowActionSchema>['action'];

export const statusOverrideSchema = z.object({
  status: z.enum(PAYMENT_STATUSES).nullable(),
  reason,
});

export const resolveMismatchSchema = z.object({
  resolution: z.enum(['accept_calculated', 'keep_imported_note']),
  reason,
});

export const dueDateChangeSchema = z.object({ dueDate: dateKey, reason });

export const deleteSchema = z.object({ reason });

export const collectionAllocationSchema = z.object({
  billId: z.string().min(1).max(128),
  amount: money.refine((value) => value !== 0, 'An allocation cannot be zero.'),
});

export const collectionInputSchema = z.object({
  receiptDate: dateKey,
  amount: money.refine((value) => value !== 0, 'Enter the amount received.'),
  allocations: z.array(collectionAllocationSchema).min(1, 'Allocate the receipt to at least one bill.').max(200),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  bankReference: optionalText(120),
  utrNumber: optionalText(60),
  bankAccountName: optionalText(120),
  /** Bank Balance account (`bankAccounts`) the money landed in; set, a verified receipt posts a Credit there. */
  bankAccountId: optionalText(128),
  remarks: optionalText(1000),
  /** Verify in the same step (needs Collections · Verify). */
  verifyNow: z.boolean().optional(),
  /** Hold `amount − Σ allocations` unallocated (needs Collections · Hold Unallocated). */
  allowUnallocated: z.boolean().optional(),
});
export type CollectionInput = z.infer<typeof collectionInputSchema>;

export const collectionActionSchema = z.object({
  action: z.enum(['verify', 'cancel']),
  reason: optionalText(1000),
});

export const followUpInputSchema = z.object({
  followUpDate: dateKey,
  method: z.enum(FOLLOW_UP_METHODS),
  contactPerson: optionalText(120),
  discussion: z.string().trim().min(2, 'Describe the discussion.').max(4000),
  nextFollowUpDate: optionalDate,
  ownerId: optionalText(128),
  commitment: z
    .object({
      date: dateKey,
      amount: money.refine((value) => value > 0, 'Commitment amount must be positive.'),
      confidence: z.enum(['low', 'medium', 'high']).optional(),
    })
    .optional(),
});

export const commitmentUpdateSchema = z.object({
  status: z.enum(COMMITMENT_STATUSES),
  fulfilledAmount: money.optional(),
  fulfilledDate: optionalDate,
  closeFollowUp: z.boolean().optional(),
});

export const commentInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().max(128)).max(20).default([]),
});

export const documentMetaSchema = z.object({ category: z.enum(DOCUMENT_CATEGORIES) });

export const retentionReleaseSchema = z.object({
  projectId: z.string().min(1).max(128),
  againstBillId: optionalText(128),
  retentionBillId: optionalText(128),
  kind: z.enum(DEDUCTION_KINDS).default('retention_invoice'),
  /** The slab released: the retention head and its rate (null = the head's fixed amounts). Both optional. */
  deductionTypeId: optionalText(64),
  rate: z.union([z.number().gt(0).max(100), z.null()]).optional(),
  releaseDate: dateKey,
  amount: money.refine((value) => value > 0, 'Release amount must be positive.'),
  remarks: optionalText(1000),
});

export const targetInputSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/, 'Use an ISO week such as 2026-W41.'),
  projectId: optionalText(128),
  billId: optionalText(128),
  amount: money.refine((value) => value > 0, 'Target must be positive.'),
  responsibleId: optionalText(128),
  probability: z.coerce.number().min(0).max(100).optional(),
  expectedDate: optionalDate,
  remarks: optionalText(1000),
});

export const bulkActionSchema = z.object({
  billIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  action: z.enum(['assign_owner', 'set_target_week', 'set_next_follow_up', 'set_expected_date']),
  ownerId: optionalText(128),
  targetWeek: optionalText(10),
  date: optionalDate,
});

export const billCategorySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Name every main category.').max(80),
  code: z.string().trim().max(40).default(''),
  summaryColumn: z.enum(SUMMARY_COLUMNS),
  sequence: z.coerce.number().int(),
  active: z.boolean(),
});

export const billTypeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Name every sub category.').max(80),
  code: z.string().trim().max(40).default(''),
  categoryId: z.string().min(1).max(64),
  /** Empty = enabled for every project. */
  projectIds: z.array(z.string().min(1).max(128)).max(2000).default([]),
  isRetentionBill: z.boolean(),
  isPriceVariation: z.boolean(),
  active: z.boolean(),
});

export const deductionTypeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Every deduction type needs a name.').max(80),
  /** Blank takes the name in capitals (as main categories and sub categories do) — `saveConfig`. */
  code: z.string().trim().max(40),
  kind: z.enum(DEDUCTION_KINDS),
  calculation: z.enum(['fixed', 'percentage']),
  percentBase: z.enum(['taxable', 'gross']),
  baseLessTypeIds: z.array(z.string().min(1).max(64)).max(20).default([]),
  defaultPercent: z.coerce.number().min(0).max(100).optional(),
  gstApplicable: z.boolean().default(false),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  sequence: z.coerce.number().int(),
  active: z.boolean(),
});

export const configInputSchema = z.object({
  settings: z.object({
    tolerance: z.coerce.number().min(0).max(1000),
    roundNetToRupee: z.boolean(),
    defaultGstRate: z.coerce.number().min(0).max(100),
    roundDeductionsToRupee: z.boolean(),
    defaultCreditDays: z.coerce.number().int().min(0).max(730),
    defaultAgeingBasis: z.enum(AGEING_BASES),
    ageingBuckets: z.array(z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0).nullable(), label: z.string().trim().min(1).max(30) })).min(1).max(12),
    noFollowUpDays: z.coerce.number().int().min(1).max(365),
    oldOutstandingDays: z.coerce.number().int().min(1).max(3650),
    highValueThreshold: z.coerce.number().min(0),
    numbering: z.object({ enabled: z.boolean(), pattern: z.string().trim().min(1).max(80), padding: z.coerce.number().int().min(1).max(10) }),
    certificationBeforeReceipt: z
      .object({
        enabled: z.boolean(),
        transactionTypes: z.array(z.enum(TRANSACTION_TYPES)).max(TRANSACTION_TYPES.length),
        exemptImported: z.boolean(),
        fromDate: optionalDate,
      })
      .optional(),
    workflowSteps: z
      .array(
        z.object({
          // A default step's key, or the id of a step added in Settings → Workflow.
          status: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/),
          label: z.string().trim().min(1, 'Every step needs a name.').max(40).optional(),
          actionLabel: z.string().trim().max(40).optional(),
          description: z.string().trim().max(300).optional(),
          permissions: z.array(z.enum(WORKFLOW_STEP_PERMISSIONS)).min(1, 'Give every step at least one permission.').max(WORKFLOW_STEP_PERMISSIONS.length).optional(),
          // Older clients sent one.
          permission: z.enum(WORKFLOW_STEP_PERMISSIONS).optional(),
          locksAmounts: z.boolean().optional(),
          canReturn: z.boolean().optional(),
          enabled: z.boolean(),
          assignment: z.enum(['permission', 'users', 'collection_owner']),
          userIds: z.array(z.string().min(1).max(128)).max(50),
          onlyAssigned: z.boolean(),
          notify: z.boolean(),
        }),
      )
      .max(30)
      .optional(),
    /** Settings → Note rules (`note-rules.ts`); checked against the sub categories and heads saved with them. */
    noteRules: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(64),
          name: z.string().trim().max(80),
          active: z.boolean(),
          billTypeIds: z.array(z.string().min(1).max(64)).max(1000),
          deductionTypeIds: z.array(z.string().min(1).max(64)).max(60),
          countInCertification: z.boolean(),
        }),
      )
      .max(50)
      .optional(),
    piMarker: z.string().trim().max(20),
  }),
  billCategories: z.array(billCategorySchema).min(1, 'Keep at least one main category.').max(100),
  billTypes: z.array(billTypeSchema).max(1000),
  deductionTypes: z.array(deductionTypeSchema).min(1).max(60),
  stages: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().trim().min(1).max(80), sequence: z.coerce.number().int(), active: z.boolean() })).max(60),
  projectProfiles: z
    .array(
      z.object({
        projectId: z.string().min(1).max(128),
        dgmOffice: optionalText(120),
        clientId: optionalText(128),
        clientName: optionalText(200),
        creditDays: z.coerce.number().int().min(0).max(730).optional(),
      }),
    )
    .max(2000),
  projectMappings: z
    .array(z.object({ key: z.string().min(1).max(200), excelName: z.string().max(300), projectId: z.string().min(1).max(128), projectName: z.string().max(300) }))
    .max(2000)
    .optional(),
  /**
   * The `settings.updatedAt` the page loaded. A save from an older copy is refused (409), so an import
   * or another administrator's save in between is never overwritten. Absent = not checked.
   */
  expectedUpdatedAt: z.string().max(40).optional(),
});
export type ConfigInput = z.infer<typeof configInputSchema>;

export const monthCloseSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), action: z.enum(['close', 'reopen']), reason: optionalText(1000) });

/* ── import ──────────────────────────────────────────────────────────────── */

const cellSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.object({ date: z.string().max(10) }), z.object({ formula: z.literal(true) })]);

export const importPreviewSchema = z.object({
  jobId: optionalText(64),
  fileName: z.string().trim().min(1).max(260),
  fileSize: z.number().int().nonnegative().optional(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  sheetName: z.string().max(120),
  headerRow: z.number().int().min(1).max(50),
  /** Overrides of the automatic column mapping: field key → column index (−1 to unmap). */
  columnOverrides: z.record(z.number().int().min(-1).max(200)).default({}),
  grid: z.array(z.array(cellSchema).max(120)).max(5100),
  projectOverrides: z.record(z.string().max(128)).default({}),
  confirmedFuzzy: z.array(z.string().max(300)).max(2000).default([]),
  rowActions: z.record(z.enum(['import', 'skip', 'update', 'import_new'])).default({}),
});
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

/** Confirming the preview: the same payload (re-parsed on the server) plus the import options. */
export const importStartSchema = importPreviewSchema.extend({
  rememberMappings: z.boolean().default(true),
  addUnknownBillTypes: z.boolean().default(true),
});

export const importProcessSchema = z.object({
  chunkSize: z.number().int().min(1).max(200).default(40),
  retryFailed: z.boolean().default(false),
});

export const importRollbackSchema = z.object({ reason });

export { WORKFLOW_STATUSES };
