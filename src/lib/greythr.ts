/**
 * GreytHR integration rules: what the HR system's data *means* (`docs/greythr-integration.md`).
 *
 * Dependency-free on purpose, exactly as `hr-policy.ts` and `access-control.ts` are: this module
 * runs in the browser (the sync settings screen), inside the Admin-SDK cron, and under
 * `node --test` with no network and no Firestore. Anything that calls GreytHR belongs in
 * `greythr-client.ts`; anything that writes Firestore belongs in `greythr-sync-service.ts`.
 *
 * ── The mistake this module exists to prevent ───────────────────────────────────────────────────
 *
 * **GreytHR's `status` field is employment *type*, not employment *state*.** Its values come from
 * the tenant's `lov::status` list — `1 Probation, 2 Confirmed, 3 Contract, 4 Trainee` — and they say
 * nothing about whether the person still works here. Whether somebody has left is carried by
 * `leftorg`, `leavingDate` and the separation record.
 *
 * Conflating the two is how the previous sync came to mark every single employee `Inactive`: it
 * compared a number against the string `'Active'`, which is never true. So this module keeps them
 * strictly apart — `employmentType` for the payroll category, `employmentState` for "are they
 * still here", each derived from its own inputs.
 *
 * Four other decisions worth knowing before reading on:
 *
 *   1. **Categories are time-windowed, so "current designation" is a query, not a field.** A
 *      category row carries `effectiveFrom`/`effectiveTo`, and an employee promoted last year has
 *      two Designation rows. `resolveCategoryAt` picks the window containing the date being asked
 *      about; taking the first row in the array gives you whichever one the API happened to return
 *      first, which is how a promoted engineer keeps their old title forever.
 *
 *   2. **Dates from GreytHR are not trustworthy.** The API's own documented samples contain
 *      `"0018-05-31"` and `"0014-02-17"` — two-digit years widened wrongly somewhere upstream. A
 *      year outside a sane range is treated as absent rather than as the first century, because
 *      `0014-02-17 <= today` would otherwise mark a working employee as relieved fourteen centuries
 *      ago.
 *
 *   3. **Losing access is a policy decision, never a side effect of a sync.** `resolveAccessDecision`
 *      returns what *should* happen under the configured policy and why; the service applies it only
 *      when the policy says to. The default policy changes nobody's access — an integration that
 *      locks people out on its first run because the upstream data was wrong is a worse failure than
 *      one that needs a click.
 *
 *   4. **The schedule lives in data, not in the deploy.** `vercel.json` crons are static, so the
 *      frequency an administrator picks cannot be a cron expression. A fixed frequent trigger asks
 *      `isSyncDue` whether this tick is the one, which also makes the answer testable without
 *      waiting an hour.
 */

/* ------------------------------------------------------------------------------------------------
 * Wire shapes — exactly what the API returns
 * ---------------------------------------------------------------------------------------------- */

/** `GET /employee/v2/employees` — one row of the roster. */
export interface GreytHREmployeeRow {
  employeeId: number;
  name?: string | null;
  email?: string | null;
  employeeNo?: string | null;
  dateOfJoin?: string | null;
  leavingDate?: string | null;
  originalHireDate?: string | null;
  /** Lower-case `o`. The separation endpoint spells the same fact `leftOrg`. */
  leftorg?: boolean | null;
  lastModified?: string | null;
  /** Employment *type* code — resolve against `lov::status`. Not active/inactive. */
  status?: number | string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  probationPeriod?: number | null;
  mobile?: string | null;
  personalEmail2?: string | null;
  personalEmail3?: string | null;
}

/** `GET /employee/v2/employees/separation` — exit and resignation detail. */
export interface GreytHRSeparationRow {
  employeeId: number;
  /** Upper-case `O` here. Same fact as the roster's `leftorg`. */
  leftOrg?: boolean | null;
  leavingDate?: string | null;
  retirementDate?: string | null;
  tentativeRelieveDate?: string | null;
  tentativeLeavingDate?: string | null;
  exitInterviewDate?: string | null;
  submittedResignation?: boolean | null;
  submissionDate?: string | null;
  fitToBeRehired?: boolean | null;
  finalSettlementDate?: string | null;
  leavingReason?: number | string | null;
}

/** One category assignment. `categoryDesc`/`valueDesc` appear only with `?descRequired=true`. */
export interface GreytHRCategoryEntry {
  id?: number;
  category?: number | string | null;
  value?: number | string | null;
  categoryDesc?: string | null;
  valueDesc?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/** `GET /employee/v2/employees/categories?descRequired=true` — one row per employee. */
export interface GreytHRCategoryRow {
  employeeId: number;
  categoryList?: GreytHRCategoryEntry[] | null;
}

/** `GET /employee/v2/employees/work` — confirmation and notice-period detail. */
export interface GreytHRWorkRow {
  employeeId: number;
  extension?: string | null;
  confirmDate?: string | null;
  lastPromotionDate?: string | null;
  lastPrevEmployment?: string | null;
  noticePeriod?: number | null;
  originalHireDate?: string | null;
  probationExtendedBy?: string | null;
  onboardingStatus?: string | null;
}

/** The `pages` envelope every paginated GreytHR response carries. */
export interface GreytHRPageInfo {
  totalPages?: number;
  totalElements?: number;
  size?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  first?: boolean;
  last?: boolean;
}

export interface GreytHRPagedResponse<T> {
  data?: T[] | null;
  pages?: GreytHRPageInfo | null;
}

/**
 * `POST /hr/v2/lov` response. Each key is `lov::<name>` or `cat::<Name>`, each value a list of
 * `[id, description]` or `[id, description, extra]` tuples.
 */
export type GreytHRLovResponse = Record<string, Array<Array<string | number | null>>>;

/* ------------------------------------------------------------------------------------------------
 * Category names
 * ---------------------------------------------------------------------------------------------- */

/**
 * The category names this integration reads.
 *
 * `Designation`, `Department`, `Location` and `Grade` are GreytHR built-ins (category ids 6, 2, 1
 * and 8 in `lov::transitiontype`). `Project Name`, `Project Division`, `Cost Center` and
 * `EMPLOYEE TYPE` are this tenant's own additions, with tenant-specific ids — which is exactly why
 * everything here matches on the *description* from `descRequired=true` rather than on the numeric
 * id. A hardcoded id map would break the moment somebody adds a category in greytHR.
 */
export const GREYTHR_CATEGORY = {
  designation: 'Designation',
  department: 'Department',
  location: 'Location',
  grade: 'Grade',
  company: 'Company',
  projectName: 'Project Name',
  projectDivision: 'Project Division',
  costCenter: 'Cost Center',
  costCenterCode: 'COST CENTER CODE',
  employeeType: 'EMPLOYEE TYPE',
  shift: 'Shift',
} as const;

export type GreytHRCategoryKey = keyof typeof GREYTHR_CATEGORY;

/** Every `cat::` key to request from the LOV endpoint. */
export const GREYTHR_CATEGORY_LOV_KEYS = Object.values(GREYTHR_CATEGORY).map(
  (name) => `cat::${name}`,
);

/** Built-in `lov::` keys worth caching — status is the one that matters for employment type. */
export const GREYTHR_LOV_KEYS = ['lov::status', 'lov::transitiontype'] as const;

/* ------------------------------------------------------------------------------------------------
 * The full employee record — detail groups
 * ---------------------------------------------------------------------------------------------- */

/** The five address types greytHR documents. */
export const GREYTHR_ADDRESS_TYPES = [
  'presentaddress',
  'contactaddress',
  'emergencyaddress',
  'spouseaddress',
  'permanentaddress',
] as const;

export type GreytHRAddressType = (typeof GREYTHR_ADDRESS_TYPES)[number];

/** The ten identity codes greytHR documents. Several are national identifiers. */
export const GREYTHR_IDENTITY_CODES = [
  'PAN',
  'AADHAR',
  'PASSPORT',
  'BANKACCNO',
  'PRAN',
  'NPR',
  'LWF',
  'DL',
  'RC',
  'EC',
] as const;

export type GreytHRIdentityCode = (typeof GREYTHR_IDENTITY_CODES)[number];

/**
 * A group of employee detail this integration can fetch.
 *
 * Grouped rather than per-endpoint because the decision an administrator actually makes is "do we
 * hold people's bank details in this system", not "do we call `/employees/bank`".
 */
export type EmployeeDetailGroup =
  | 'profile'
  | 'personal'
  | 'reporting'
  | 'qualifications'
  | 'assets'
  | 'addresses'
  | 'statutory'
  | 'identities'
  | 'bank'
  | 'travel'
  | 'leave'
  | 'attendance';

/**
 * Where a group's data is stored, and therefore who can read it.
 *
 * `operational` lands in `employees/{id}`, which every signed-in user can read — it is what the HR
 * module, the access screens and half a dozen pickers already read. `sensitive` lands in
 * `employeeSensitive/{id}`, behind its own permission and its own security rule.
 *
 * The split is not fussiness. Aadhaar and PAN numbers, bank account numbers, religion and disability
 * status are special-category personal data; putting them in a collection readable by every
 * employee because it was convenient would be a serious failure, and one that is very hard to undo
 * once the documents exist.
 */
export type DetailDestination = 'operational' | 'sensitive';

export interface EmployeeDetailGroupSpec {
  group: EmployeeDetailGroup;
  label: string;
  description: string;
  destination: DetailDestination;
  /** Off by default for everything sensitive — holding the data has to be a decision. */
  defaultEnabled: boolean;
  /** Shown on the settings screen so the choice is informed. */
  contains: string;
}

export const EMPLOYEE_DETAIL_GROUPS: EmployeeDetailGroupSpec[] = [
  {
    group: 'profile',
    label: 'Profile',
    description: 'Nickname, biography and the social links greytHR holds.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'nickname, biography, LinkedIn, Twitter, Facebook',
  },
  {
    group: 'personal',
    label: 'Personal',
    description: 'Blood group and marital status. Blood group is genuinely useful on site.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'blood group, marital status, marriage date, spouse name',
  },
  {
    group: 'reporting',
    label: 'Reporting structure',
    description: "greytHR's org tree, which is where a reporting manager actually comes from.",
    destination: 'operational',
    defaultEnabled: true,
    contains: 'reporting manager, org tree',
  },
  {
    group: 'qualifications',
    label: 'Qualifications',
    description: 'Education history — degree, institute, year, grade.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'qualifications, institutes, years',
  },
  {
    group: 'assets',
    label: 'Company assets',
    description: 'Assets issued to the employee and when they are due back.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'asset type, id, value, issue and return dates',
  },
  {
    group: 'addresses',
    label: 'Addresses & emergency contact',
    description:
      'Present, permanent, contact, spouse and emergency addresses. Home addresses are personal ' +
      'data, so these are stored with restricted access — but the emergency contact name and phone ' +
      'are also mirrored into the operational record, because the reason to hold them at all is that ' +
      'somebody may need them urgently.',
    destination: 'sensitive',
    defaultEnabled: false,
    contains: 'home address, phone numbers, emergency contact',
  },
  {
    group: 'statutory',
    label: 'Statutory details',
    description:
      'Includes religion and disability status — special-category personal data under most privacy ' +
      'regimes. Only enable this if the platform genuinely needs it.',
    destination: 'sensitive',
    defaultEnabled: false,
    contains: "father's and mother's name, birthplace, nationality, religion, disability, residential status",
  },
  {
    group: 'identities',
    label: 'Identity documents',
    description:
      'PAN, Aadhaar, passport, driving licence and the rest. National identifiers — masked on display ' +
      'and restricted at rest.',
    destination: 'sensitive',
    defaultEnabled: false,
    contains: 'PAN, Aadhaar, PRAN, licence and other document numbers',
  },
  {
    group: 'bank',
    label: 'Bank, PF & ESI',
    description: 'Bank account numbers and statutory identifiers. Masked on display, restricted at rest.',
    destination: 'sensitive',
    defaultEnabled: false,
    contains: 'account number, bank, branch, UAN, PF number, ESI number',
  },
  {
    group: 'travel',
    label: 'Passport & visa',
    description: 'Travel document numbers and expiry dates.',
    destination: 'sensitive',
    defaultEnabled: false,
    contains: 'passport and visa numbers, issue and expiry dates',
  },
  {
    group: 'leave',
    label: 'Leave balances',
    description:
      "Each employee's leave position for the current year, by leave type — the question people ask " +
      'most often about themselves.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'balance, opening balance, granted, availed, lapsed and encashed per leave type',
  },
  {
    group: 'attendance',
    label: 'Attendance summary',
    description:
      'Aggregate attendance for the current month — average hours and in/out times, late arrivals, ' +
      'absences. The daily muster is deliberately not synced: at ~1,300 people it is tens of ' +
      'thousands of records a month and belongs in its own module with a retention policy.',
    destination: 'operational',
    defaultEnabled: true,
    contains: 'average work hours, in/out times, late arrivals, early departures, absent days',
  },
];

export const detailGroupSpec = (group: EmployeeDetailGroup): EmployeeDetailGroupSpec =>
  EMPLOYEE_DETAIL_GROUPS.find((spec) => spec.group === group)!;

export const isSensitiveGroup = (group: EmployeeDetailGroup): boolean =>
  detailGroupSpec(group).destination === 'sensitive';

/** The default enabled/disabled map: everything operational on, everything sensitive off. */
export const DEFAULT_DETAIL_GROUPS: Record<EmployeeDetailGroup, boolean> = Object.fromEntries(
  EMPLOYEE_DETAIL_GROUPS.map((spec) => [spec.group, spec.defaultEnabled]),
) as Record<EmployeeDetailGroup, boolean>;

/* ------------------------------------------------------------------------------------------------
 * Detail wire shapes
 * ---------------------------------------------------------------------------------------------- */

export interface GreytHRProfileRow {
  employeeId: number;
  nickname?: string | null;
  twitter?: string | null;
  linkedIn?: string | null;
  facebook?: string | null;
  googlePlus?: string | null;
  biography?: string | null;
  wishDOB?: boolean | null;
}

export interface GreytHRPersonalRow {
  employeeId: number;
  bloodGroup?: string | number | null;
  maritalStatus?: string | number | null;
  marriageDate?: string | null;
  spouseBirthday?: string | null;
  spouseName?: string | null;
  actualDOB?: string | null;
}

export interface GreytHROrgTreeRow {
  employeeId: number;
  /** greytHR returns this loosely — sometimes a list, sometimes an object. Normalised on read. */
  orgtree?: unknown;
}

export interface GreytHRAddressRow {
  employeeId: number;
  addressType?: string | null;
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pin?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  mobile?: string | null;
  email?: string | null;
  extnno?: string | null;
  fax?: string | null;
  recordId?: number | null;
}

export interface GreytHRQualificationRow {
  id?: number;
  /** Note: this endpoint calls it `employee`, not `employeeId`. */
  employee?: number;
  employeeId?: number;
  qualArea?: string | null;
  qualDescription?: string | null;
  qualLevel?: string | null;
  qualYear?: string | number | null;
  qualCompletionYear?: string | number | null;
  duration?: string | number | null;
  professionalQual?: boolean | null;
  institute?: string | null;
  university?: string | null;
  grade?: string | null;
  current?: boolean | null;
  qualSubjects?: string | null;
}

export interface GreytHRAssetRow {
  id?: number;
  employeeId: number;
  assetType?: string | null;
  assetDetails?: string | null;
  assetId?: string | null;
  assetValue?: number | string | null;
  assetStatus?: string | null;
  issuedDate?: string | null;
  validTill?: string | null;
  returnedOn?: string | null;
  remarks?: string | null;
}

export interface GreytHRStatutoryRow {
  employeeId: number;
  birthplace?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  nationality?: string | number | null;
  dispensary?: string | null;
  disabled?: boolean | null;
  expatriate?: boolean | null;
  exempted?: boolean | null;
  disabilityType?: string | number | null;
  religion?: string | number | null;
  residentialStatus?: string | number | null;
  countryOfOrigin?: string | number | null;
  isDirector?: boolean | null;
}

export interface GreytHRIdentityRow {
  id?: number;
  employeeId: number;
  idType?: string | null;
  documentNo?: string | null;
  nameAsPerDoc?: string | null;
  ifscCode?: string | null;
  expiryDate?: string | null;
  verified?: boolean | null;
  verifiedDate?: string | null;
  aadharAppNo?: string | null;
  /** greytHR's own instruction that this number should not be shown in full. Honoured. */
  enableMasking?: boolean | null;
}

export interface GreytHRBankRow {
  employeeId: number;
  bankAccountNumber?: string | null;
  accountType?: string | number | null;
  bankName?: string | number | null;
  bankBranch?: string | number | null;
  branchCode?: string | null;
  salaryPaymentMode?: string | number | null;
  ddPayableAt?: string | null;
  nameAsPerBank?: string | null;
}

export interface GreytHRPfRow {
  employeeId: number;
  pfEligible?: boolean | null;
  esiEligible?: boolean | null;
  pfNumber?: string | null;
  pfScheme?: string | number | null;
  pfJoinDate?: string | null;
  familyPfNo?: string | null;
  uan?: string | null;
  esiNumber?: string | null;
  pfExistingMember?: boolean | null;
}

export interface GreytHRTravelDocRow {
  passportId?: number;
  VisaId?: number;
  /** The employee id, which this endpoint calls `relation`. */
  relation?: number;
  country?: string | number | null;
  passportNo?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  surName?: string | null;
  middleName?: string | null;
  givenName?: string | null;
  passportType?: string | number | null;
  issuePlace?: string | null;
  issueCity?: string | null;
  currentlyWith?: string | number | null;
}

/* ------------------------------------------------------------------------------------------------
 * Assembled detail records
 * ---------------------------------------------------------------------------------------------- */

/** Operational detail — stored on `employees/{id}`, readable by any signed-in user. */
export interface EmployeeOperationalDetail {
  nickname?: string;
  biography?: string;
  linkedIn?: string;
  twitter?: string;
  facebook?: string;
  bloodGroup?: string;
  maritalStatus?: string;
  marriageDate?: string | null;
  spouseName?: string;
  /** From the org tree. The field the Add User drawer always wanted and never had a source for. */
  reportingManagerEmployeeId?: string;
  reportingManagerName?: string;
  /**
   * Mirrored out of the (restricted) address block on purpose: the reason to hold an emergency
   * contact is that somebody may need it in a hurry, and putting it behind a data-protection
   * permission defeats the point. Only the name and phone — never the address.
   */
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  qualifications?: Array<{
    description: string;
    level?: string;
    institute?: string;
    university?: string;
    year?: string;
    grade?: string;
    current?: boolean;
  }>;
  assets?: Array<{
    assetType: string;
    assetId?: string;
    details?: string;
    status?: string;
    issuedDate?: string | null;
    validTill?: string | null;
    returnedOn?: string | null;
  }>;
}

/** Restricted detail — stored on `employeeSensitive/{id}` behind its own permission and rule. */
export interface EmployeeSensitiveDetail {
  employeeId: string;
  employeeNo?: string;
  name?: string;
  addresses?: Partial<
    Record<
      GreytHRAddressType,
      {
        name?: string;
        line1?: string;
        line2?: string;
        line3?: string;
        city?: string;
        state?: string;
        country?: string;
        pin?: string;
        phone?: string;
        mobile?: string;
        email?: string;
      }
    >
  >;
  statutory?: {
    birthplace?: string;
    fatherName?: string;
    motherName?: string;
    nationality?: string;
    religion?: string;
    disabled?: boolean;
    disabilityType?: string;
    expatriate?: boolean;
    residentialStatus?: string;
    countryOfOrigin?: string;
    isDirector?: boolean;
  };
  /** Keyed by identity code. `masked` reflects greytHR's own `enableMasking`. */
  identities?: Partial<
    Record<
      GreytHRIdentityCode,
      {
        documentNo?: string;
        nameAsPerDoc?: string;
        expiryDate?: string | null;
        verified?: boolean;
        verifiedDate?: string | null;
        masked?: boolean;
      }
    >
  >;
  bank?: {
    accountNumber?: string;
    accountType?: string;
    bankName?: string;
    bankBranch?: string;
    branchCode?: string;
    nameAsPerBank?: string;
    salaryPaymentMode?: string;
  };
  pf?: {
    pfEligible?: boolean;
    esiEligible?: boolean;
    pfNumber?: string;
    uan?: string;
    esiNumber?: string;
    pfJoinDate?: string | null;
    pfExistingMember?: boolean;
  };
  passport?: {
    passportNo?: string;
    country?: string;
    issueDate?: string | null;
    expiryDate?: string | null;
    issuePlace?: string;
  };
  visa?: {
    passportNo?: string;
    country?: string;
    issueDate?: string | null;
    expiryDate?: string | null;
  };
  syncedAt: string;
}

/** Trim a value to a stored string, dropping blanks so Firestore documents stay tidy. */
const text = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
};

/** `boolean | null | undefined` → `boolean | undefined`, so `false` survives and absence does not. */
const flag = (value: unknown): boolean | undefined =>
  value === true || value === false ? value : undefined;

/**
 * Mask an identifier for display, keeping the last four characters.
 *
 * `••••••1234`. Applied in the UI regardless of greytHR's `enableMasking` — that flag says greytHR
 * itself masks it, and a platform that unmasked what the HR system chose to hide would be actively
 * unhelpful. Callers that genuinely need the full value read it from the record; this is for screens.
 */
export function maskIdentifier(value: string | null | undefined, visible = 4): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length <= visible) return '•'.repeat(raw.length);
  return '•'.repeat(Math.min(raw.length - visible, 8)) + raw.slice(-visible);
}

/**
 * Resolve the reporting manager out of greytHR's org tree.
 *
 * The `orgtree` field is loosely typed — the samples show a list, but greytHR is inconsistent about
 * whether it is an array of levels, a single object, or a nested chain. This walks whatever arrives
 * looking for the first plausible supervisor reference rather than assuming one shape, and returns
 * nothing when it cannot find one. A wrong reporting line is worse than a blank.
 */
export function resolveReportingManager(
  orgtree: unknown,
): { employeeId?: string; name?: string } | null {
  const visit = (node: unknown, depth = 0): { employeeId?: string; name?: string } | null => {
    if (!node || depth > 4) return null;

    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = visit(entry, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;

    // The several names greytHR uses for the same idea across its endpoints.
    const idKeys = ['supervisorId', 'managerId', 'reportsTo', 'reportingTo', 'parentEmployeeId', 'supervisor'];
    const nameKeys = ['supervisorName', 'managerName', 'reportsToName', 'reportingToName', 'parentName'];

    for (const key of idKeys) {
      const value = record[key];
      if (value === null || value === undefined || value === '') continue;
      // A nested object under `supervisor` is common; recurse into it rather than stringifying it.
      if (typeof value === 'object') {
        const nested = visit(value, depth + 1);
        if (nested) return nested;
        continue;
      }
      const employeeId = String(value).trim();
      if (!employeeId || employeeId === '0') continue;
      const name = nameKeys.map((nameKey) => text(record[nameKey])).find(Boolean);
      return { employeeId, name };
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        const nested = visit(value, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  };

  return visit(orgtree);
}

export interface BuildDetailInput {
  profile?: GreytHRProfileRow | null;
  personal?: GreytHRPersonalRow | null;
  orgTree?: GreytHROrgTreeRow | null;
  qualifications?: GreytHRQualificationRow[];
  assets?: GreytHRAssetRow[];
  /** Keyed by address type. */
  addresses?: Partial<Record<GreytHRAddressType, GreytHRAddressRow>>;
  /** Names for the numeric codes `personal` and `statutory` return, from the LOV endpoint. */
  labels?: {
    bloodGroup?: Record<string, string>;
    maritalStatus?: Record<string, string>;
    nationality?: Record<string, string>;
    religion?: Record<string, string>;
    bank?: Record<string, string>;
  };
}

/** Assemble the operational half of an employee's detail. */
/**
 * Recursively drop absent values.
 *
 * Firestore rejects `undefined` **at any depth** — including inside array elements — and the error it
 * gives names one field of one row out of a whole batch. Filtering only the top level, as this module
 * used to, let `qualifications[0].level` through and failed a 182-employee run at commit time with
 * nothing written.
 *
 * Three things go:
 *
 *   - `undefined`, because Firestore will not store it;
 *   - `null`, because `sanitizeGreytHRDate` returns it for an absent date, and a record full of
 *     explicit nulls is never equal to the stored one — which makes the sync's "has this changed?"
 *     comparison always true and rewrites every document on every run;
 *   - containers that end up empty, so an employee with no assets has no `assets` key rather than an
 *     `[]` that reads as "we checked and there are none".
 *
 * `false` and `0` are kept: "not a director" and "zero days' notice" are answers, not absences.
 * Empty strings are kept too — the detail builders use `''` as a sentinel their own `.filter()` then
 * removes, and pruning it here would quietly change which rows survive.
 */
export function pruneEmpty<T>(value: T): T | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    // Absent elements are dropped rather than left as holes; Firestore rejects `undefined` inside an
    // array, and a sparse array is not a thing it can store either.
    const items = value.map((item) => pruneEmpty(item)).filter((item) => item !== undefined);
    return (items.length ? items : undefined) as T | undefined;
  }

  // Only plain objects are walked. A Date, a Timestamp or a Firestore sentinel must pass through
  // untouched — recursing into one would take it apart.
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneEmpty(item);
      if (pruned !== undefined) out[key] = pruned;
    }
    return (Object.keys(out).length ? out : undefined) as T | undefined;
  }

  return value;
}

export function buildOperationalDetail(input: BuildDetailInput): EmployeeOperationalDetail {
  const label = (map: Record<string, string> | undefined, value: unknown): string | undefined => {
    const raw = text(value);
    if (!raw) return undefined;
    return map?.[raw] ?? raw;
  };

  const manager = resolveReportingManager(input.orgTree?.orgtree);
  const emergency = input.addresses?.emergencyaddress;

  const detail: EmployeeOperationalDetail = {
    nickname: text(input.profile?.nickname),
    biography: text(input.profile?.biography),
    linkedIn: text(input.profile?.linkedIn),
    twitter: text(input.profile?.twitter),
    facebook: text(input.profile?.facebook),
    bloodGroup: label(input.labels?.bloodGroup, input.personal?.bloodGroup),
    maritalStatus: label(input.labels?.maritalStatus, input.personal?.maritalStatus),
    marriageDate: sanitizeGreytHRDate(input.personal?.marriageDate),
    spouseName: text(input.personal?.spouseName),
    reportingManagerEmployeeId: manager?.employeeId,
    reportingManagerName: manager?.name,
    emergencyContactName: text(emergency?.name),
    emergencyContactPhone: text(emergency?.mobile) ?? text(emergency?.phone1),
    qualifications: (input.qualifications ?? [])
      .map((row) => ({
        description: text(row.qualDescription) ?? text(row.qualArea) ?? '',
        level: text(row.qualLevel),
        institute: text(row.institute),
        university: text(row.university),
        year: text(row.qualCompletionYear) ?? text(row.qualYear),
        grade: text(row.grade),
        current: flag(row.current),
      }))
      .filter((row) => row.description),
    assets: (input.assets ?? [])
      .map((row) => ({
        assetType: text(row.assetType) ?? '',
        assetId: text(row.assetId),
        details: text(row.assetDetails),
        status: text(row.assetStatus),
        issuedDate: sanitizeGreytHRDate(row.issuedDate),
        validTill: sanitizeGreytHRDate(row.validTill),
        returnedOn: sanitizeGreytHRDate(row.returnedOn),
      }))
      .filter((row) => row.assetType || row.assetId),
  };

  // Pruned at every depth, not just the top: the qualification and asset rows above are built with
  // optional fields, and one `undefined` inside one of them is enough to fail the whole commit.
  return (pruneEmpty(detail) ?? {}) as EmployeeOperationalDetail;
}

export interface BuildSensitiveInput extends BuildDetailInput {
  employeeId: string;
  employeeNo?: string;
  name?: string;
  statutory?: GreytHRStatutoryRow | null;
  identities?: Partial<Record<GreytHRIdentityCode, GreytHRIdentityRow>>;
  bank?: GreytHRBankRow | null;
  pf?: GreytHRPfRow | null;
  passport?: GreytHRTravelDocRow | null;
  visa?: GreytHRTravelDocRow | null;
  syncedAt?: string;
}

/** Assemble the restricted half. */
export function buildSensitiveDetail(input: BuildSensitiveInput): EmployeeSensitiveDetail {
  const label = (map: Record<string, string> | undefined, value: unknown): string | undefined => {
    const raw = text(value);
    if (!raw) return undefined;
    return map?.[raw] ?? raw;
  };

  const addresses: EmployeeSensitiveDetail['addresses'] = {};
  for (const type of GREYTHR_ADDRESS_TYPES) {
    const row = input.addresses?.[type];
    if (!row) continue;
    const entry = {
      name: text(row.name),
      line1: text(row.address1),
      line2: text(row.address2),
      line3: text(row.address3),
      city: text(row.city),
      state: text(row.state),
      country: text(row.country),
      pin: text(row.pin),
      phone: text(row.phone1) ?? text(row.phone2),
      mobile: text(row.mobile),
      email: text(row.email),
    };
    if (Object.values(entry).some(Boolean)) addresses[type] = entry;
  }

  const identities: EmployeeSensitiveDetail['identities'] = {};
  for (const code of GREYTHR_IDENTITY_CODES) {
    const row = input.identities?.[code];
    if (!row?.documentNo) continue;
    identities[code] = {
      documentNo: text(row.documentNo),
      nameAsPerDoc: text(row.nameAsPerDoc),
      expiryDate: sanitizeGreytHRDate(row.expiryDate),
      verified: flag(row.verified),
      verifiedDate: sanitizeGreytHRDate(row.verifiedDate),
      masked: flag(row.enableMasking),
    };
  }

  const record: EmployeeSensitiveDetail = {
    employeeId: input.employeeId,
    employeeNo: text(input.employeeNo),
    name: text(input.name),
    addresses: Object.keys(addresses).length ? addresses : undefined,
    statutory: input.statutory
      ? {
          birthplace: text(input.statutory.birthplace),
          fatherName: text(input.statutory.fatherName),
          motherName: text(input.statutory.motherName),
          nationality: label(input.labels?.nationality, input.statutory.nationality),
          religion: label(input.labels?.religion, input.statutory.religion),
          disabled: flag(input.statutory.disabled),
          disabilityType: text(input.statutory.disabilityType),
          expatriate: flag(input.statutory.expatriate),
          residentialStatus: text(input.statutory.residentialStatus),
          countryOfOrigin: text(input.statutory.countryOfOrigin),
          isDirector: flag(input.statutory.isDirector),
        }
      : undefined,
    identities: Object.keys(identities).length ? identities : undefined,
    bank: input.bank
      ? {
          accountNumber: text(input.bank.bankAccountNumber),
          accountType: text(input.bank.accountType),
          bankName: label(input.labels?.bank, input.bank.bankName),
          bankBranch: text(input.bank.bankBranch),
          branchCode: text(input.bank.branchCode),
          nameAsPerBank: text(input.bank.nameAsPerBank),
          salaryPaymentMode: text(input.bank.salaryPaymentMode),
        }
      : undefined,
    pf: input.pf
      ? {
          pfEligible: flag(input.pf.pfEligible),
          esiEligible: flag(input.pf.esiEligible),
          pfNumber: text(input.pf.pfNumber),
          uan: text(input.pf.uan),
          esiNumber: text(input.pf.esiNumber),
          pfJoinDate: sanitizeGreytHRDate(input.pf.pfJoinDate),
          pfExistingMember: flag(input.pf.pfExistingMember),
        }
      : undefined,
    passport: input.passport?.passportNo
      ? {
          passportNo: text(input.passport.passportNo),
          country: text(input.passport.country),
          issueDate: sanitizeGreytHRDate(input.passport.issueDate),
          expiryDate: sanitizeGreytHRDate(input.passport.expiryDate),
          issuePlace: text(input.passport.issuePlace),
        }
      : undefined,
    visa: input.visa?.passportNo
      ? {
          passportNo: text(input.visa.passportNo),
          country: text(input.visa.country),
          issueDate: sanitizeGreytHRDate(input.visa.issueDate),
          expiryDate: sanitizeGreytHRDate(input.visa.expiryDate),
        }
      : undefined,
    syncedAt: input.syncedAt ?? new Date().toISOString(),
  };

  /**
   * Same deep prune, and it matters more here.
   *
   * Every block on this record is a nested object built from optional fields — `statutory`, `bank`,
   * `pf`, `passport`, `visa`, and one entry per address type and identity code. A top-level filter
   * saw `statutory` as present and never looked inside it, so a single blank `fatherName` would have
   * failed the commit the moment those groups were switched on.
   *
   * Dropping now-empty blocks also fixes a smaller wrong answer: an employee whose statutory row
   * exists but is entirely blank used to produce `statutory: {}`, which made `hasSensitiveDetail`
   * report they had restricted data on file when they have none.
   */
  const pruned = (pruneEmpty(record) ?? {}) as EmployeeSensitiveDetail;
  // `employeeId` and `syncedAt` identify the document, so they are restored even if pruning would
  // have taken them — a sensitive record with no id is not writable.
  pruned.employeeId = record.employeeId;
  pruned.syncedAt = record.syncedAt;
  return pruned;
}

/** Whether a sensitive record holds anything at all, so the UI can say "nothing recorded". */
export const hasSensitiveDetail = (detail: EmployeeSensitiveDetail | null | undefined): boolean =>
  !!detail &&
  Boolean(detail.addresses || detail.statutory || detail.identities || detail.bank || detail.pf || detail.passport || detail.visa);

/* ------------------------------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------------------------------- */

/** Years outside this range are upstream corruption, not history. See the header, point 2. */
const MIN_SANE_YEAR = 1900;
const MAX_SANE_YEAR = 2200;

/**
 * A GreytHR date string, or null if it is absent or nonsense.
 *
 * Returns the `YYYY-MM-DD` form so callers can compare dates as strings — which is both faster and
 * safer than `Date` round-tripping through a timezone the HR system never intended.
 */
export function sanitizeGreytHRDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_SANE_YEAR || year > MAX_SANE_YEAR) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Today as `YYYY-MM-DD`, in local time — HR dates are civil dates, not instants. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Inclusive window test on `YYYY-MM-DD` strings. An absent bound is open. */
const withinWindow = (date: string, from: string | null, to: string | null): boolean => {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

/* ------------------------------------------------------------------------------------------------
 * Employment state
 * ---------------------------------------------------------------------------------------------- */

/**
 * Whether somebody still works here, and if not, how far through leaving they are.
 *
 * Deliberately distinct from `employmentType` (Probation / Confirmed / Contract / Trainee), which is
 * what GreytHR's `status` field carries.
 */
export type EmploymentState =
  /** Working, no resignation on file. */
  | 'Active'
  /** Resignation submitted or an exit date set, but that date has not arrived. Still working. */
  | 'Notice Period'
  /** Past their last working day. */
  | 'Relieved'
  /** Past a retirement date, with no separate leaving date. */
  | 'Retired'
  /** Full and final settlement done. Terminal. */
  | 'Settled'
  /** Flagged as having left, with no usable date to say when. */
  | 'Left'
  /** No roster row at all — the employee has disappeared from GreytHR. */
  | 'Unknown';

/** States in which somebody is still working and should keep their platform access. */
export const WORKING_STATES: readonly EmploymentState[] = ['Active', 'Notice Period'];

/** States in which somebody has gone. */
export const EXITED_STATES: readonly EmploymentState[] = ['Relieved', 'Retired', 'Settled', 'Left'];

export const isWorkingState = (state: EmploymentState): boolean => WORKING_STATES.includes(state);
export const hasExited = (state: EmploymentState): boolean => EXITED_STATES.includes(state);

export interface EmploymentStateInput {
  /**
   * Whether greytHR's employee roster currently includes this person.
   *
   * This is the authoritative answer to "do they still work here?". The separation endpoint can
   * retain historical exit rows after an employee is rejoined/reactivated, so those rows must not
   * override an explicit CURRENT-roster membership.
   */
  rosterCurrent?: boolean | null;
  /** From the roster (`leftorg`) or the separation record (`leftOrg`) — either spelling. */
  leftOrg?: boolean | null;
  leavingDate?: string | null;
  retirementDate?: string | null;
  tentativeLeavingDate?: string | null;
  tentativeRelieveDate?: string | null;
  submittedResignation?: boolean | null;
  submissionDate?: string | null;
  finalSettlementDate?: string | null;
  /**
   * The joining date, used only to sanity-check the exit dates.
   *
   * Nobody leaves before they arrive. greytHR populates `leavingDate` on the roster row for employees
   * who have not left — with a placeholder rather than a null — and every such placeholder is in the
   * distant past, so it reads as "last working day" and relieves the entire workforce. A date at or
   * before the joining date is not an exit; it is a field that was never filled in.
   */
  dateOfJoin?: string | null;
}

/**
 * Discard an exit date that cannot be one.
 *
 * Two rules, both about placeholders rather than genuine data:
 *
 *   - **On or before the joining date.** Logically impossible, so it is a placeholder whatever value
 *     it holds. This is the rule that matters: it needs no guess about which sentinel a tenant uses.
 *   - **Before 2000.** A backstop for employees whose own joining date is missing, where the first
 *     rule has nothing to compare against. greytHR did not exist before 2009, so an exit date in the
 *     1900s is not a record of anything.
 */
export function isPlaceholderExitDate(
  date: string | null | undefined,
  dateOfJoin?: string | null,
): boolean {
  if (!date) return false;
  if (dateOfJoin && date <= dateOfJoin) return true;
  return date < '2000-01-01';
}

function plausibleExitDate(date: string | null, dateOfJoin: string | null): string | null {
  if (!date) return null;
  return isPlaceholderExitDate(date, dateOfJoin) ? null : date;
}

/* ------------------------------------------------------------------------------------------------
 * Correcting a stored employment state
 * ---------------------------------------------------------------------------------------------- */

export interface RevisedEmploymentState {
  state: EmploymentState;
  reason: string;
  exitDate: string | null;
  /** True when the stored state was overruled, so a screen can say so rather than quietly differ. */
  corrected: boolean;
}

/**
 * Re-judge an employment state that is already stored in the mirror.
 *
 * `employmentState` is written at sync time, so fixing the *derivation* only helps records a later run
 * rewrites. Every screen meanwhile keeps reading the old conclusion — which is how "Last working day
 * was 1900-01-01" survived on 154 employees who plainly still work here.
 *
 * This applies the placeholder rule to what is already on disk: an exit date that cannot be an exit
 * date means there was no exit, so the person is current. It reads only fields the mirror already
 * stores, and it is deliberately narrow — it corrects *toward* Active and never away from it:
 *
 *   - An exit state whose date is a placeholder becomes **Active**.
 *   - `Left` has no date to judge (greytHR's `leftOrg` flag with nothing else), so it is left alone.
 *     Guessing there would mean overruling an explicit upstream statement on no evidence.
 *   - A working state is returned untouched.
 *
 * This is not a substitute for a re-sync, and it is not a second derivation: it cannot see `leftOrg`
 * or the settlement flags, so it only ever undoes the one mistake it can positively identify. A full
 * run still rewrites these records properly.
 */
export function reviseStoredEmploymentState(stored: {
  employmentState?: EmploymentState | string | null;
  employmentStateReason?: string | null;
  exitDate?: string | null;
  leavingDate?: string | null;
  dateOfJoin?: string | null;
}): RevisedEmploymentState {
  const state = (stored.employmentState ?? 'Unknown') as EmploymentState;
  const reason = stored.employmentStateReason ?? '';
  const exitDate = stored.exitDate ?? stored.leavingDate ?? null;

  if (!hasExited(state)) return { state, reason, exitDate, corrected: false };
  if (!isPlaceholderExitDate(exitDate, stored.dateOfJoin)) {
    return { state, reason, exitDate, corrected: false };
  }

  return {
    state: 'Active',
    // Names the discarded value, because "we decided you are active" is less useful than "greytHR
    // gave a leaving date of 1900-01-01, which cannot be one".
    reason:
      `greytHR recorded a leaving date of ${exitDate}, which cannot be one` +
      `${stored.dateOfJoin ? ` — they joined on ${stored.dateOfJoin}` : ''}. Treated as still employed.`,
    exitDate: null,
    corrected: true,
  };
}

/**
 * Overlay greytHR's live CURRENT roster onto a stored mirror record.
 *
 * The mirror is only ever as correct as the last sync that wrote it, and a sync that has not run —
 * or ran before a derivation fix — leaves working employees stored as `Relieved`. Every screen that
 * lists employees therefore needs the same correction, and until this existed each one applied it
 * inline: the Add User picker had its own copy, `/employee/current` sidestepped the mirror entirely,
 * and Manage Employee trusted the mirror blindly and so showed a workforce that had all left.
 *
 * Membership in the live roster is authoritative in one direction only — it can promote somebody to
 * working, never demote them. When greytHR says a person is CURRENT that outranks any stored exit
 * date or historical separation row; when the roster is silent about them (or could not be fetched at
 * all) the stored state stands, re-judged for placeholder dates by `reviseStoredEmploymentState`.
 * Demoting on absence would be wrong for a reason that matters: a paging gap, a scope difference
 * between API users, or an unreachable greytHR would silently mark the whole company as departed.
 *
 * `Notice Period` is preserved rather than flattened to `Active`. It is a working state, so the
 * overlay has nothing to correct, and it carries a real fact — a resignation is on file — that
 * overwriting would discard.
 */
export function overlayLiveRosterState<T extends Partial<SyncedEmployee>>(
  stored: T,
  isCurrentInLiveRoster: boolean,
): T & {
  status: 'Active' | 'Inactive';
  employmentState: EmploymentState;
  employmentStateReason: string;
  exitDate: string | null;
  leavingDate: string | null;
  greytHRCurrent: boolean | null;
  /** True when the live roster or the placeholder rule overruled what the mirror had stored. */
  employmentStateCorrected: boolean;
} {
  const revised = reviseStoredEmploymentState(stored);

  if (isCurrentInLiveRoster) {
    const onNotice = revised.state === 'Notice Period';
    return {
      ...stored,
      status: 'Active',
      employmentState: onNotice ? 'Notice Period' : 'Active',
      employmentStateReason: onNotice
        ? revised.reason
        : "Included in greytHR's current employee roster.",
      exitDate: onNotice ? revised.exitDate : null,
      leavingDate: onNotice ? revised.exitDate : null,
      greytHRCurrent: true,
      // A stored exit state that the live roster contradicts is a correction worth surfacing, and so
      // is one the placeholder rule already caught.
      employmentStateCorrected: revised.corrected || hasExited((stored.employmentState ?? 'Unknown') as EmploymentState),
    };
  }

  return {
    ...stored,
    status: isWorkingState(revised.state) ? 'Active' : 'Inactive',
    employmentState: revised.state,
    employmentStateReason: revised.reason,
    exitDate: revised.exitDate,
    leavingDate: revised.exitDate,
    greytHRCurrent: stored.greytHRCurrent ?? null,
    employmentStateCorrected: revised.corrected,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Replacing the stored CURRENT-roster snapshot
 * ---------------------------------------------------------------------------------------------- */

/**
 * How far a roster may shrink in one fetch before a replace is refused.
 *
 * 0.5 means "a snapshot may not lose more than half its people at once". Permissive enough for a
 * genuine restructuring at a company of this size, tight enough to catch the failure this exists for:
 * an API user whose location or category scope narrowed returns a roster that is valid, complete, and
 * much smaller, with nothing in the data to distinguish it from real attrition.
 */
export const MAX_ROSTER_SHRINK_RATIO = 0.5;

export interface RosterReplaceDecision {
  replace: boolean;
  /** Why the replace was refused. `null` when it may proceed. */
  reason: string | null;
}

/**
 * Whether a freshly fetched CURRENT roster is trustworthy enough to *delete* against.
 *
 * Pure and here rather than in the store, for the same reason every other rule in this module is:
 * the store imports the Admin SDK, so a rule living there cannot be tested without one. This is the
 * only decision in the integration that authorises deletions, which makes it the one most worth
 * being able to test exhaustively.
 *
 * Four guards, each answering a way the data can be wrong while looking right:
 *
 *   1. **Incomplete walk.** A roster truncated by the page cap is indistinguishable by content from
 *      one that genuinely shrank, so completeness has to be reported rather than inferred.
 *   2. **Empty.** Zero current employees is not a real state for a company; a permission or paging
 *      fault very much is.
 *   3. **Disagrees with greytHR's own count.** The envelope reports `totalElements`; receiving fewer
 *      rows than that means the walk lost some.
 *   4. **Collapsed.** A sudden loss of most of the roster is far more likely a narrowed API scope
 *      than mass resignation.
 *
 * Refusing to write is always recoverable — one stale snapshot. Deleting wrongly is not.
 */
export function shouldReplaceRosterSnapshot(input: {
  /** How many employees the fetch returned. */
  fetched: number;
  /** Whether the paged walk reached the last page. */
  complete: boolean;
  /** greytHR's own reported roster size, when the envelope carried one. */
  totalElements?: number | null;
  /** How many the stored snapshot currently holds. 0 or absent on a first run. */
  previousCount?: number | null;
}): RosterReplaceDecision {
  const { fetched, complete } = input;
  const totalElements = input.totalElements ?? null;
  const previousCount = input.previousCount ?? 0;

  if (!complete) {
    return {
      replace: false,
      reason:
        'greytHR did not return the whole roster (the page walk stopped early), so the stored ' +
        'snapshot was left alone rather than pruned against a partial list.',
    };
  }

  if (fetched <= 0) {
    return {
      replace: false,
      reason:
        'greytHR returned no current employees. That is not a real state for a company, so it was ' +
        'treated as a fetch fault and the stored snapshot was kept.',
    };
  }

  if (typeof totalElements === 'number' && fetched !== totalElements) {
    return {
      replace: false,
      reason:
        `greytHR reported ${totalElements} current employees but ${fetched} were received, so the ` +
        'fetch is incomplete and the stored snapshot was kept.',
    };
  }

  // Only meaningful once there is a baseline to compare against; a first run has nothing to lose.
  if (previousCount > 0 && fetched < previousCount * MAX_ROSTER_SHRINK_RATIO) {
    return {
      replace: false,
      reason:
        `The roster would have dropped from ${previousCount} to ${fetched} in one fetch. That is more ` +
        'likely a narrowed API scope than genuine attrition, so the stored snapshot was kept. Re-run ' +
        'once greytHR access is confirmed, or clear the snapshot by hand to accept it.',
    };
  }

  return { replace: true, reason: null };
}

export interface EmploymentStateResult {
  state: EmploymentState;
  /** The date the exit takes effect, when one is known. */
  exitDate: string | null;
  /** When the resignation was submitted, when known. */
  resignationDate: string | null;
  /** One sentence an administrator can read on the review screen. */
  reason: string;
}

/**
 * Derive employment state from the separation signals.
 *
 * Order matters and is chosen so the *most specific* true statement wins: a settled employee is
 * also relieved, and saying "Settled" is more useful. A future-dated exit outranks `leftOrg`,
 * because greytHR flips that flag when the resignation is recorded rather than when the person
 * actually leaves — and treating a notice-period engineer as gone is precisely the failure that
 * would lock a working colleague out of the platform.
 */
export function deriveEmploymentState(
  input: EmploymentStateInput | null | undefined,
  today: string = todayIso(),
): EmploymentStateResult {
  if (!input) {
    return { state: 'Unknown', exitDate: null, resignationDate: null, reason: 'No employee record found in greytHR.' };
  }

  const joined = sanitizeGreytHRDate(input.dateOfJoin);

  // Every exit signal is filtered, not just `leavingDate`: greytHR fills the whole group with
  // placeholders, so trusting any one of them reintroduces the same failure under another name.
  const leaving = plausibleExitDate(sanitizeGreytHRDate(input.leavingDate), joined);
  const retirement = plausibleExitDate(sanitizeGreytHRDate(input.retirementDate), joined);
  const settlement = plausibleExitDate(sanitizeGreytHRDate(input.finalSettlementDate), joined);
  const tentative = plausibleExitDate(
    sanitizeGreytHRDate(input.tentativeLeavingDate) ?? sanitizeGreytHRDate(input.tentativeRelieveDate),
    joined,
  );
  const submitted = plausibleExitDate(sanitizeGreytHRDate(input.submissionDate), joined);

  const exitDate = leaving ?? retirement ?? tentative;
  const resignationDate = submitted ?? null;

  // The roster is greytHR's supported active/resigned boundary. A separation row is useful for
  // explaining *how* somebody left, but it can be historical and must not turn a CURRENT employee
  // into a leaver. Keep genuine future/submitted resignations as Notice Period; otherwise the
  // explicit current membership wins.
  if (input.rosterCurrent === true) {
    if ((exitDate && exitDate > today) || input.submittedResignation || submitted) {
      return {
        state: 'Notice Period',
        exitDate: exitDate && exitDate > today ? exitDate : null,
        resignationDate,
        reason: exitDate && exitDate > today
          ? `Leaving on ${exitDate} — still included in greytHR's current employee roster.`
          : 'Resignation submitted, but still included in greytHR\'s current employee roster.',
      };
    }
    return {
      state: 'Active',
      exitDate: null,
      resignationDate: null,
      reason: 'Included in greytHR\'s current employee roster.',
    };
  }

  if (settlement && settlement <= today) {
    return {
      state: 'Settled',
      exitDate: exitDate ?? settlement,
      resignationDate,
      reason: `Full and final settlement completed on ${settlement}.`,
    };
  }

  // A dated exit in the future means they are working their notice, whatever `leftOrg` says.
  if (exitDate && exitDate > today) {
    return {
      state: 'Notice Period',
      exitDate,
      resignationDate,
      reason: `Leaving on ${exitDate} — still working until then.`,
    };
  }

  if (leaving && leaving <= today) {
    return { state: 'Relieved', exitDate: leaving, resignationDate, reason: `Last working day was ${leaving}.` };
  }

  if (retirement && retirement <= today) {
    return { state: 'Retired', exitDate: retirement, resignationDate, reason: `Retired on ${retirement}.` };
  }

  if (tentative && tentative <= today) {
    // A tentative date that has passed without a confirmed leaving date: they have most likely gone,
    // but HR has not closed the record. Reported as Notice Period rather than Relieved so nobody is
    // locked out on a date greytHR itself calls tentative.
    return {
      state: 'Notice Period',
      exitDate: tentative,
      resignationDate,
      reason: `Tentative last working day ${tentative} has passed but no leaving date is confirmed in greytHR.`,
    };
  }

  if (input.submittedResignation || submitted) {
    return {
      state: 'Notice Period',
      exitDate: null,
      resignationDate,
      reason: submitted
        ? `Resignation submitted on ${submitted}; no leaving date set yet.`
        : 'Resignation submitted; no leaving date set yet.',
    };
  }

  if (input.rosterCurrent === false) {
    return {
      state: 'Left',
      exitDate: null,
      resignationDate,
      reason: 'Not included in greytHR\'s current employee roster.',
    };
  }

  if (input.leftOrg) {
    return {
      state: 'Left',
      exitDate: null,
      resignationDate,
      reason: 'Marked as having left greytHR, but no leaving date is recorded.',
    };
  }

  return { state: 'Active', exitDate: null, resignationDate: null, reason: 'Active employee.' };
}

/** Merge the roster row and the separation row into one set of signals. */
export function employmentSignals(
  employee: GreytHREmployeeRow | null | undefined,
  separation: GreytHRSeparationRow | null | undefined,
  currentInRoster?: boolean | null,
): EmploymentStateInput | null {
  if (!employee && !separation) return null;
  return {
    rosterCurrent:
      currentInRoster ??
      (employee?.leftorg === false ? true : employee?.leftorg === true ? false : null),
    dateOfJoin: employee?.dateOfJoin ?? employee?.originalHireDate ?? null,
    // Either spelling counts; the roster and the separation endpoint disagree on capitalisation.
    leftOrg: separation?.leftOrg ?? employee?.leftorg ?? null,
    leavingDate: separation?.leavingDate ?? employee?.leavingDate ?? null,
    retirementDate: separation?.retirementDate ?? null,
    tentativeLeavingDate: separation?.tentativeLeavingDate ?? null,
    tentativeRelieveDate: separation?.tentativeRelieveDate ?? null,
    submittedResignation: separation?.submittedResignation ?? null,
    submissionDate: separation?.submissionDate ?? null,
    finalSettlementDate: separation?.finalSettlementDate ?? null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Employment type (`lov::status`)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Fallback labels for `lov::status`.
 *
 * The list is tenant-configurable, so the sync fetches the real one and only falls back to these —
 * which are greytHR's shipped defaults — when the LOV call fails. Showing "Confirmed" from a stale
 * default is better than showing a bare `2`.
 */
export const DEFAULT_EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  '1': 'Probation',
  '2': 'Confirmed',
  '3': 'Contract',
  '4': 'Trainee',
};

/** Turn a `lov::status` payload into a code → label map. */
export function employmentTypeLabels(lov: GreytHRLovResponse | null | undefined): Record<string, string> {
  const rows = lov?.['lov::status'];
  if (!Array.isArray(rows) || !rows.length) return { ...DEFAULT_EMPLOYMENT_TYPE_LABELS };
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const code = row[0];
    const label = row[1];
    if (code === null || code === undefined || typeof label !== 'string') continue;
    out[String(code)] = label;
  }
  return Object.keys(out).length ? out : { ...DEFAULT_EMPLOYMENT_TYPE_LABELS };
}

export const employmentTypeLabel = (
  code: number | string | null | undefined,
  labels: Record<string, string>,
): string => {
  if (code === null || code === undefined || code === '') return '';
  return labels[String(code)] ?? String(code);
};

/* ------------------------------------------------------------------------------------------------
 * Categories — designation, department, location, project
 * ---------------------------------------------------------------------------------------------- */

/** A category assignment normalised to names, with a usable window. */
export interface NormalizedCategory {
  category: string;
  value: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/**
 * Normalise one employee's `categoryList`.
 *
 * Rows without a resolvable name are dropped rather than kept as numeric ids: a designation showing
 * as `6` in a report is worse than the field being blank, because blank prompts somebody to check
 * greytHR whereas `6` looks like data. Callers that want the ids can pass a LOV map.
 */
export function normalizeCategories(
  entries: GreytHRCategoryEntry[] | null | undefined,
  options?: {
    /** `cat::Designation` → id → name, from the LOV endpoint. Only needed without `descRequired`. */
    categoryNamesById?: Record<string, string>;
    valueNamesByCategory?: Record<string, Record<string, string>>;
  },
): NormalizedCategory[] {
  if (!Array.isArray(entries)) return [];
  const out: NormalizedCategory[] = [];

  for (const entry of entries) {
    const categoryName =
      (typeof entry.categoryDesc === 'string' && entry.categoryDesc.trim()) ||
      (entry.category !== null && entry.category !== undefined
        ? options?.categoryNamesById?.[String(entry.category)]
        : undefined) ||
      '';
    if (!categoryName) continue;

    const valueName =
      (typeof entry.valueDesc === 'string' && entry.valueDesc.trim()) ||
      (entry.value !== null && entry.value !== undefined
        ? options?.valueNamesByCategory?.[categoryName]?.[String(entry.value)]
        : undefined) ||
      '';
    if (!valueName) continue;

    out.push({
      category: categoryName,
      value: valueName,
      effectiveFrom: sanitizeGreytHRDate(entry.effectiveFrom),
      effectiveTo: sanitizeGreytHRDate(entry.effectiveTo),
    });
  }

  return out;
}

/**
 * The value of one category as at `onDate`.
 *
 * The point of this function: an employee promoted in April has two Designation rows, and "their
 * designation" means the one whose window contains the date being asked about. Among several
 * matching windows the latest `effectiveFrom` wins, because that is the most recent change; a row
 * with no `effectiveFrom` at all sorts last, as it carries no evidence of when it started.
 */
export function resolveCategoryAt(
  categories: NormalizedCategory[],
  categoryName: string,
  onDate: string = todayIso(),
): NormalizedCategory | null {
  const candidates = categories.filter(
    (entry) =>
      entry.category.toLowerCase() === categoryName.toLowerCase() &&
      withinWindow(onDate, entry.effectiveFrom, entry.effectiveTo),
  );
  if (!candidates.length) return null;

  return candidates.reduce((best, entry) => {
    if (!best.effectiveFrom) return entry.effectiveFrom ? entry : best;
    if (!entry.effectiveFrom) return best;
    return entry.effectiveFrom > best.effectiveFrom ? entry : best;
  });
}

/** Every category resolved as at one date, keyed by category name. */
export function resolveAllCategoriesAt(
  categories: NormalizedCategory[],
  onDate: string = todayIso(),
): Record<string, string> {
  const out: Record<string, string> = {};
  const names = [...new Set(categories.map((entry) => entry.category))];
  for (const name of names) {
    const resolved = resolveCategoryAt(categories, name, onDate);
    if (resolved) out[name] = resolved.value;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * The record this integration maintains
 * ---------------------------------------------------------------------------------------------- */

/**
 * One employee as this application stores them.
 *
 * A superset of the existing `Employee` shape in `types.ts` — every field that was there before is
 * still there, spelled the same way, so the Employee Management screens keep working untouched.
 * Everything new is optional.
 */
export interface SyncedEmployee {
  /** greytHR's numeric employee id, as a string. The Firestore document id. */
  employeeId: string;
  /** greytHR's human employee number, e.g. `CON-005`. */
  employeeNo: string;
  name: string;
  email: string;
  phone: string;
  /** The existing Active/Inactive field, now derived from employment *state*. */
  status: 'Active' | 'Inactive';
  department: string;
  designation: string;
  dateOfJoin: string | null;
  leavingDate: string | null;
  dateOfBirth: string | null;
  gender: string;

  /* ── added by this integration ── */

  /** Where the person is in the employment lifecycle. */
  employmentState: EmploymentState;
  /** Whether greytHR's CURRENT roster contained the employee during the last sync. */
  greytHRCurrent: boolean | null;
  /** Probation / Confirmed / Contract / Trainee — greytHR's `status` code, resolved. */
  employmentType: string;
  employmentTypeCode: string;
  /** Why `employmentState` is what it is, for the review screen. */
  employmentStateReason: string;
  exitDate: string | null;
  resignationDate: string | null;
  location: string;
  grade: string;
  company: string;
  projectName: string;
  projectDivision: string;
  costCenter: string;
  employeeType: string;
  /** Every category as at the sync date, including any this integration does not name explicitly. */
  categories: Record<string, string>;
  confirmDate: string | null;
  noticePeriodDays: number | null;
  /** greytHR's own `lastModified`, for incremental sync. */
  greytHRLastModified: string | null;
  /** ISO timestamp of the run that last wrote this record. */
  syncedAt: string;
}

export interface BuildEmployeeInput {
  employee: GreytHREmployeeRow;
  /** Membership in `GET /employees?state=CURRENT`, when the caller fetched that roster. */
  currentInRoster?: boolean | null;
  separation?: GreytHRSeparationRow | null;
  categories?: GreytHRCategoryEntry[] | null;
  work?: GreytHRWorkRow | null;
  employmentTypeLabels?: Record<string, string>;
  onDate?: string;
  syncedAt?: string;
}

/**
 * Fold every greytHR source into one record.
 *
 * `status` stays `'Active' | 'Inactive'` because the Employee Management screens, the HR module and
 * the access layer's user filters all read it. What changed is how it is *decided*: from employment
 * state, not from a numeric code compared against a string.
 */
export function buildSyncedEmployee(input: BuildEmployeeInput): SyncedEmployee {
  const { employee } = input;
  const onDate = input.onDate ?? todayIso();
  const labels = input.employmentTypeLabels ?? DEFAULT_EMPLOYMENT_TYPE_LABELS;

  const rosterCurrent =
    input.currentInRoster ??
    (employee.leftorg === false ? true : employee.leftorg === true ? false : null);
  const stateResult = deriveEmploymentState(
    employmentSignals(employee, input.separation, rosterCurrent),
    onDate,
  );
  const categories = normalizeCategories(input.categories);
  const resolved = resolveAllCategoriesAt(categories, onDate);

  const pick = (key: GreytHRCategoryKey): string => resolved[GREYTHR_CATEGORY[key]] ?? '';

  return {
    employeeId: String(employee.employeeId),
    employeeNo: String(employee.employeeNo ?? '').trim(),
    name: String(employee.name ?? '').trim(),
    email: String(employee.email ?? '').trim().toLowerCase(),
    phone: String(employee.mobile ?? '').trim(),
    status: isWorkingState(stateResult.state) ? 'Active' : 'Inactive',
    department: pick('department'),
    designation: pick('designation'),
    dateOfJoin: sanitizeGreytHRDate(employee.dateOfJoin),
    /**
     * The derivation's own conclusion, not the raw field.
     *
     * Taking the raw value would store the placeholder greytHR puts here for employees who have not
     * left — so the record would say "Active" and show a last working day in 1900 at the same time,
     * and every screen reading `leavingDate` directly would draw the wrong conclusion.
     */
    leavingDate: stateResult.exitDate,
    dateOfBirth: sanitizeGreytHRDate(employee.dateOfBirth),
    gender: String(employee.gender ?? '').trim(),

    employmentState: stateResult.state,
    greytHRCurrent: rosterCurrent,
    employmentType: employmentTypeLabel(employee.status, labels),
    employmentTypeCode: employee.status === null || employee.status === undefined ? '' : String(employee.status),
    employmentStateReason: stateResult.reason,
    exitDate: stateResult.exitDate,
    resignationDate: stateResult.resignationDate,
    location: pick('location'),
    grade: pick('grade'),
    company: pick('company'),
    projectName: pick('projectName'),
    projectDivision: pick('projectDivision'),
    costCenter: pick('costCenter') || pick('costCenterCode'),
    employeeType: pick('employeeType'),
    categories: resolved,
    confirmDate: sanitizeGreytHRDate(input.work?.confirmDate),
    noticePeriodDays:
      typeof input.work?.noticePeriod === 'number' && Number.isFinite(input.work.noticePeriod)
        ? input.work.noticePeriod
        : null,
    greytHRLastModified: employee.lastModified ?? null,
    syncedAt: input.syncedAt ?? new Date().toISOString(),
  };
}

/** Fields whose change is worth writing and reporting. Excludes `syncedAt`, which always changes. */
const TRACKED_FIELDS: Array<keyof SyncedEmployee> = [
  'employeeNo',
  'name',
  'email',
  'phone',
  'status',
  'department',
  'designation',
  'dateOfJoin',
  'leavingDate',
  'dateOfBirth',
  'gender',
  'employmentState',
  'greytHRCurrent',
  'employmentType',
  'employmentTypeCode',
  'exitDate',
  'resignationDate',
  'location',
  'grade',
  'company',
  'projectName',
  'projectDivision',
  'costCenter',
  'employeeType',
  'confirmDate',
  'noticePeriodDays',
];

export interface FieldDelta {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * What changed between the stored record and the freshly built one.
 *
 * Drives both the "write only what moved" optimisation and the run report. Returning an empty array
 * for an unchanged employee is what keeps a nightly sync of 1,300 people from writing 1,300
 * documents and burning the Firestore quota on no news.
 */
export function diffSyncedEmployee(
  before: Partial<SyncedEmployee> | null | undefined,
  after: SyncedEmployee,
): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  const blank = (value: unknown) => value === null || value === undefined || value === '';

  for (const field of TRACKED_FIELDS) {
    const from = before?.[field];
    const to = after[field];
    if (blank(from) && blank(to)) continue;
    if (from === to) continue;
    deltas.push({ field, from: from ?? null, to: to ?? null });
  }
  return deltas;
}

/* ------------------------------------------------------------------------------------------------
 * Platform access policy
 * ---------------------------------------------------------------------------------------------- */

/**
 * When a greytHR exit should close somebody's platform login.
 *
 * `'Flag for review'` is the default and writes nothing. That is not timidity — the data this
 * integration inherited marked *every* employee `Inactive`, and a policy that acted on it
 * automatically would have logged the whole company out. An administrator confirming the first
 * run's findings is cheap; a company-wide lockout is not.
 */
export type ExitAccessPolicy =
  /** Record and surface it; never change a user account. */
  | 'Flag for review'
  /** Deactivate once the last working day has passed. Notice-period employees keep working. */
  | 'On last working day'
  /** Deactivate as soon as a resignation is on file, before the last working day. */
  | 'On resignation';

export const EXIT_ACCESS_POLICIES: ExitAccessPolicy[] = [
  'Flag for review',
  'On last working day',
  'On resignation',
];

export interface AccessDecisionInput {
  state: EmploymentState;
  policy: ExitAccessPolicy;
  /** The linked platform user's current status, if a user exists. */
  currentUserStatus?: 'Active' | 'Inactive' | null;
  /**
   * Whether this integration is the one that deactivated them. Only its own deactivations are ever
   * reversed — an account an administrator disabled by hand stays disabled.
   */
  deactivatedBySync?: boolean;
  /**
   * True when deactivating this user would leave nobody able to administer access. Such a user is
   * never deactivated automatically, whatever the policy says.
   */
  wouldStrandAdministration?: boolean;
}

export interface AccessDecision {
  /** What the sync should do to the user account. */
  action: 'none' | 'deactivate' | 'reactivate';
  /** Whether an administrator should be shown this row even when `action` is `none`. */
  flagForReview: boolean;
  reason: string;
}

/**
 * What should happen to a platform login, given an employment state and a policy.
 *
 * Pure, so the review screen can show exactly what the cron would do before anybody turns the
 * policy on.
 */
export function resolveAccessDecision(input: AccessDecisionInput): AccessDecision {
  const { state, policy } = input;
  const currentlyInactive = input.currentUserStatus === 'Inactive';
  const working = isWorkingState(state);

  /* ── Rejoining, or an exit that turned out not to be one ── */

  if (working && currentlyInactive) {
    if (input.deactivatedBySync) {
      return {
        action: 'reactivate',
        flagForReview: true,
        reason: `Back to ${state} in greytHR — restoring the access this sync removed.`,
      };
    }
    return {
      action: 'none',
      flagForReview: true,
      reason:
        'Active in greytHR but disabled on the platform. This account was disabled by an administrator, ' +
        'not by the sync, so it is left alone.',
    };
  }

  if (working) {
    return { action: 'none', flagForReview: false, reason: 'Working — access unchanged.' };
  }

  /* ── They have gone, or are going ── */

  if (state === 'Unknown') {
    return {
      action: 'none',
      flagForReview: true,
      reason: 'No longer present in greytHR. Review manually — an absent record is not proof of an exit.',
    };
  }

  if (currentlyInactive) {
    return { action: 'none', flagForReview: false, reason: `${state} in greytHR; platform access already disabled.` };
  }

  if (policy === 'Flag for review') {
    return {
      action: 'none',
      flagForReview: true,
      reason: `${state} in greytHR. Policy is review-only, so platform access is unchanged — disable it here when ready.`,
    };
  }

  if (input.wouldStrandAdministration) {
    return {
      action: 'none',
      flagForReview: true,
      reason:
        `${state} in greytHR, but this is the last user who can administer access. ` +
        'Grant another administrator first, then disable this account by hand.',
    };
  }

  return { action: 'deactivate', flagForReview: true, reason: `${state} in greytHR — platform access removed.` };
}

/**
 * Whether a *notice-period* employee should be deactivated under this policy.
 *
 * Split out because `resolveAccessDecision` treats Notice Period as working, which is right for
 * every policy except `'On resignation'`. Keeping the exception here rather than threading it
 * through the main function stops the common path from having to reason about it.
 */
export function shouldDeactivateOnResignation(
  state: EmploymentState,
  policy: ExitAccessPolicy,
): boolean {
  return policy === 'On resignation' && state === 'Notice Period';
}

/* ------------------------------------------------------------------------------------------------
 * Schedule
 * ---------------------------------------------------------------------------------------------- */

export type SyncFrequency = 'Manual' | 'Hourly' | 'Every 6 hours' | 'Every 12 hours' | 'Daily' | 'Weekly';

export const SYNC_FREQUENCIES: SyncFrequency[] = [
  'Manual',
  'Hourly',
  'Every 6 hours',
  'Every 12 hours',
  'Daily',
  'Weekly',
];

export interface SyncSchedule {
  enabled: boolean;
  frequency: SyncFrequency;
  /** Hour of day, 0–23, for Daily and Weekly. Local to the server. */
  hourOfDay: number;
  /** 0 = Sunday. For Weekly. */
  dayOfWeek: number;
}

export const DEFAULT_SYNC_SCHEDULE: SyncSchedule = {
  enabled: false,
  frequency: 'Daily',
  hourOfDay: 2,
  dayOfWeek: 1,
};

/** Minimum gap between runs, per frequency. `Manual` never becomes due on its own. */
const FREQUENCY_INTERVAL_MS: Record<Exclude<SyncFrequency, 'Manual'>, number> = {
  Hourly: 60 * 60 * 1000,
  'Every 6 hours': 6 * 60 * 60 * 1000,
  'Every 12 hours': 12 * 60 * 60 * 1000,
  Daily: 24 * 60 * 60 * 1000,
  Weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Is a scheduled run due right now?
 *
 * The whole reason this exists: `vercel.json` crons are static, so an administrator cannot pick a
 * cron expression from a settings screen. A fixed frequent trigger asks this on every tick, and the
 * answer is a pure function of the settings and the last run — which also means the schedule can be
 * tested without waiting for a clock.
 *
 * The interval is checked with a one-minute tolerance so a cron that fires at 02:00:03 one day and
 * 01:59:58 the next does not silently skip a day.
 */
export function isSyncDue(
  schedule: SyncSchedule,
  lastRunAt: string | Date | null | undefined,
  now: Date = new Date(),
): { due: boolean; reason: string } {
  if (!schedule.enabled) return { due: false, reason: 'Automatic sync is switched off.' };
  if (schedule.frequency === 'Manual') return { due: false, reason: 'Frequency is set to manual only.' };

  const last = lastRunAt ? new Date(lastRunAt) : null;
  const lastMs = last && !Number.isNaN(last.getTime()) ? last.getTime() : null;

  if (lastMs === null) return { due: true, reason: 'No successful run recorded yet.' };

  const interval = FREQUENCY_INTERVAL_MS[schedule.frequency];
  const TOLERANCE_MS = 60_000;
  const elapsed = now.getTime() - lastMs;
  if (elapsed + TOLERANCE_MS < interval) {
    const hours = Math.max(0, Math.round((interval - elapsed) / 3_600_000));
    return { due: false, reason: `Last run was ${Math.round(elapsed / 3_600_000)}h ago; next due in about ${hours}h.` };
  }

  // Daily and weekly additionally hold until their configured hour, so a nightly sync does not drift
  // an hour later every day as each run's timestamp pushes the next window out.
  if (schedule.frequency === 'Daily' || schedule.frequency === 'Weekly') {
    if (now.getHours() < schedule.hourOfDay) {
      return { due: false, reason: `Waiting for ${String(schedule.hourOfDay).padStart(2, '0')}:00.` };
    }
    if (schedule.frequency === 'Weekly' && now.getDay() !== schedule.dayOfWeek) {
      return { due: false, reason: 'Waiting for the configured day of the week.' };
    }
  }

  return { due: true, reason: 'Due.' };
}

/** Human description of a schedule, for the settings screen. */
export function describeSchedule(schedule: SyncSchedule): string {
  if (!schedule.enabled) return 'Automatic sync is off — run it manually when needed.';
  const at = `${String(schedule.hourOfDay).padStart(2, '0')}:00`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (schedule.frequency) {
    case 'Manual':
      return 'Automatic sync is enabled but the frequency is manual — nothing will run on its own.';
    case 'Hourly':
      return 'Runs every hour.';
    case 'Every 6 hours':
      return 'Runs every 6 hours.';
    case 'Every 12 hours':
      return 'Runs every 12 hours.';
    case 'Daily':
      return `Runs once a day, on or after ${at}.`;
    case 'Weekly':
      return `Runs once a week, on ${days[schedule.dayOfWeek] ?? 'Monday'} on or after ${at}.`;
  }
}

/**
 * The two timestamp formats greytHR accepts for `modifiedSince`.
 *
 * Straight from the server's own rejection message:
 *
 *     {"code":"INVALID-DATE-FORMAT",
 *      "message":"Date should be in YYYY-MM-DD format or yyyy-MM-dd'T'HH:mm:ss'Z'"}
 *
 * The quotes around `'Z'` in that pattern are Java `SimpleDateFormat` syntax for a **literal**, so
 * the trailing `Z` is required rather than optional — and there is no room for the milliseconds
 * `toISOString()` produces. The published Postman sample shows the value without the `Z`, which is
 * where this got it wrong: the sample does not match what the server accepts.
 */
export const GREYTHR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

export const isGreytHRTimestamp = (value: string | null | undefined): boolean =>
  typeof value === 'string' && GREYTHR_TIMESTAMP.test(value);

/**
 * The `modifiedSince` value for an incremental run.
 *
 * Overlapped against the last run, deliberately, and the overlap is generous for two reasons:
 *
 *   1. greytHR's `lastModified` is set by its clock, not this app's. An exact boundary drops any
 *      record modified in the seconds around the previous run.
 *   2. The value carries `Z`, but whether greytHR *honours* it or reads the instant in tenant-local
 *      time is not documented. For an IST tenant that is a 5½-hour disagreement, and getting it
 *      wrong in that direction means silently skipping records — which nothing would report, and
 *      which no later incremental run would recover. Only a full resync would.
 *
 * Twelve hours covers that ambiguity with margin. The cost is re-reading half a day of
 * modifications, which for a 1,300-person company is a handful of records; the sync is idempotent, so
 * re-reading is free of consequence. Losing a resignation is not.
 */
/**
 * Version of the derived employee mirror, not the greytHR API.
 *
 * Increment this whenever an unchanged upstream employee would produce a materially different
 * stored record. An incremental sync will never fetch that employee, so a version change is the
 * signal that one full rebuild is required. Version 2 corrected numeric status and placeholder exit
 * dates; version 3 makes greytHR's CURRENT roster authoritative over historical separation rows.
 */
export const GREYTHR_MIRROR_VERSION = 3;

/**
 * Whether this run must fetch everything, whatever the watermark says.
 *
 * An incremental run maintains a complete mirror; it cannot build one. So a watermark is only
 * meaningful once a *full* run has succeeded, and until then every run is full — otherwise a mirror
 * that was incomplete when the first run happened to succeed stays incomplete forever, and the only
 * employees that trickle in are the ones whose records change: leavers and people on notice.
 *
 * Self-healing by design. Any installation without `baselineCompletedAt`, or with an older mirror
 * version, rebuilds on its next run and then goes incremental.
 */
export function shouldForceFullResync(settings: {
  baselineCompletedAt?: string | null;
  lastSuccessfulRunAt?: string | null;
  mirrorVersion?: number | null;
}): { force: boolean; reason: string | null } {
  if (!settings.baselineCompletedAt) {
    return {
      force: true,
      reason: settings.lastSuccessfulRunAt
        ? 'No complete baseline has been recorded, so this run fetches every employee. Incremental ' +
          'runs only return what changed, which cannot fill gaps left by an earlier partial run.'
        : 'First run — fetching every employee to establish the baseline.',
    };
  }
  if (settings.mirrorVersion !== GREYTHR_MIRROR_VERSION) {
    return {
      force: true,
      reason:
        `Employee mirror version ${settings.mirrorVersion ?? 0} is out of date; version ` +
        `${GREYTHR_MIRROR_VERSION} rebuilds every employee using greytHR's CURRENT roster as the active-state authority.`,
    };
  }

  return { force: false, reason: null };
}

export function modifiedSinceFor(
  lastSuccessfulRunAt: string | Date | null | undefined,
  options?: { overlapMs?: number; fullResync?: boolean },
): string | null {
  if (options?.fullResync) return null;
  if (!lastSuccessfulRunAt) return null;
  const last = new Date(lastSuccessfulRunAt);
  if (Number.isNaN(last.getTime())) return null;
  const overlap = options?.overlapMs ?? 12 * 60 * 60 * 1000;
  // `slice(0, 19)` drops the milliseconds; the `Z` is then required, not decorative.
  return `${new Date(last.getTime() - overlap).toISOString().slice(0, 19)}Z`;
}

/* ------------------------------------------------------------------------------------------------
 * Settings and run records
 * ---------------------------------------------------------------------------------------------- */

/** Which greytHR facts may drive platform membership. See `docs/greythr-integration.md`. */
export interface GreytHRMappingPolicy {
  /** Write designation/department/project onto the employee record. Always safe; always on. */
  syncEmployeeFacts: boolean;
  /**
   * Keep the linked user's department and designation membership in step with greytHR, so the
   * Department and Designation rules configured in Access Management apply automatically.
   */
  syncAccessMembership: boolean;
  /** Grant project-scoped access from the greytHR "Project Name" category. Off by default. */
  syncProjectAccess: boolean;
  /**
   * Link platform logins to greytHR employees automatically, on every run.
   *
   * On by default, and the default matters more than it looks. The sync can only act on a
   * resignation for a user it can *identify* — `resolveAccessDecision` is reached through
   * `matchUserForEmployee`, so an unlinked account is invisible to it. Linking was previously a
   * button on a screen reachable only from inside one user's profile card, which meant the
   * deactivate-on-exit policy quietly did nothing for every account nobody had got round to linking.
   *
   * Only the confident subset is applied: `planBulkLink` returns rows the matcher marked `auto`,
   * which `AUTO_LINK_METHODS` restricts to greytHR employee id, employee number and official email.
   * Name and phone matches are excluded by design and stay in the review queue, as does anything
   * that matched more than one employee. So this automates the identifications a human would have
   * rubber-stamped and none of the judgement calls.
   */
  autoLinkUsers: boolean;
}

export const DEFAULT_MAPPING_POLICY: GreytHRMappingPolicy = {
  syncEmployeeFacts: true,
  syncAccessMembership: true,
  syncProjectAccess: false,
  autoLinkUsers: true,
};

export interface GreytHRSyncSettings {
  schedule: SyncSchedule;
  exitPolicy: ExitAccessPolicy;
  mapping: GreytHRMappingPolicy;
  /**
   * Which detail groups to fetch. Everything operational defaults on; everything sensitive defaults
   * off, because holding somebody's Aadhaar number has to be a decision rather than a side effect of
   * turning on a sync.
   */
  detailGroups: Record<EmployeeDetailGroup, boolean>;
  /** ISO timestamp of the last run that completed without error. Drives `modifiedSince`. */
  lastSuccessfulRunAt?: string | null;
  /**
   * When a **full** run last completed successfully.
   *
   * Separate from `lastSuccessfulRunAt`, and the distinction is the point. An incremental run only
   * ever fetches what greytHR says changed, so it can only *maintain* a complete mirror — it cannot
   * build one. Without this field, one successful run of any kind turned every later run incremental
   * forever, and a mirror that was incomplete at that moment stayed incomplete indefinitely.
   *
   * That is not hypothetical: `commitBatched` writes in chunks of 400, so a run that failed partway
   * left the earlier chunks in place. And the employees an incremental run *does* return are the ones
   * whose records get edited — leavers and people on notice. So the gap fills with exactly the people
   * you do not want, and the active majority never arrives.
   */
  baselineCompletedAt?: string | null;
  /** Version of the derivation used to build the current full baseline. */
  mirrorVersion?: number;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export const DEFAULT_SYNC_SETTINGS: GreytHRSyncSettings = {
  schedule: DEFAULT_SYNC_SCHEDULE,
  exitPolicy: 'Flag for review',
  mapping: DEFAULT_MAPPING_POLICY,
  detailGroups: DEFAULT_DETAIL_GROUPS,
  lastSuccessfulRunAt: null,
  baselineCompletedAt: null,
  mirrorVersion: 0,
  lastRunAt: null,
  lastRunId: null,
};

/* ------------------------------------------------------------------------------------------------
 * Employee documents
 * ---------------------------------------------------------------------------------------------- */

/**
 * `GET /employee/v2/emp-docs/{employeeId}[/{categoryId}]` — one entry per document category.
 *
 * `categoryId` is optional, so omitting it returns every category the employee has. That matters:
 * greytHR publishes no endpoint to *list* document categories and no LOV key for them, so the only
 * way to discover which categories an employee actually has is to ask for all of them.
 */
export interface GreytHRDocumentCategoryRow {
  category?: number | string | null;
  document?: Array<{
    id?: string | null;
    files?: Array<{
      id?: string | null;
      name?: string | null;
      createdDate?: string | null;
    }> | null;
  }> | null;
}

export interface EmployeeDocumentFile {
  fileId: string;
  documentId: string;
  name: string;
  /** Lower-case, no dot. `''` when the name has no extension. */
  extension: string;
  createdAt: string | null;
}

export interface EmployeeDocumentCategory {
  categoryId: string;
  /** `Category 3` unless a label is supplied — see `documentCategoryLabel`. */
  label: string;
  files: EmployeeDocumentFile[];
}

export interface EmployeeDocumentTree {
  employeeId: string;
  categories: EmployeeDocumentCategory[];
  totalFiles: number;
  fetchedAt: string;
}

/**
 * A display label for a numeric document category.
 *
 * greytHR has a `POST /emp-docs/category` to *create* categories with a name and code, but publishes
 * nothing to read them back and no LOV key — so the id is all there is. `Category 3` at least tells
 * somebody what to look up in greytHR; a blank heading does not. An optional caller-supplied map
 * lets an administrator name them without this module pretending to know.
 */
export const documentCategoryLabel = (
  categoryId: string,
  labels?: Record<string, string>,
): string => labels?.[categoryId]?.trim() || `Category ${categoryId}`;

/** The file extension, for choosing an icon. */
export function fileExtension(name: string | null | undefined): string {
  const clean = String(name ?? '').trim();
  const at = clean.lastIndexOf('.');
  if (at <= 0 || at === clean.length - 1) return '';
  return clean.slice(at + 1).toLowerCase();
}

/**
 * Flatten greytHR's category → document → files nesting into something a screen can render.
 *
 * The middle level exists because greytHR groups files into "documents" (one upload can carry
 * several files), but nobody browsing thinks in those terms — they want "the files in this
 * category". `documentId` is kept on every file because the download path needs it.
 *
 * Files are ordered newest first, since the most recent upload is nearly always the one wanted.
 */
export function buildDocumentTree(
  employeeId: string,
  rows: GreytHRDocumentCategoryRow[] | null | undefined,
  options?: { labels?: Record<string, string>; fetchedAt?: string },
): EmployeeDocumentTree {
  const categories: EmployeeDocumentCategory[] = [];
  let totalFiles = 0;

  for (const row of rows ?? []) {
    const categoryId =
      row?.category === undefined || row?.category === null ? '' : String(row.category).trim();
    if (!categoryId) continue;

    const files: EmployeeDocumentFile[] = [];
    for (const document of row.document ?? []) {
      const documentId = String(document?.id ?? '').trim();
      if (!documentId) continue;
      for (const file of document.files ?? []) {
        const fileId = String(file?.id ?? '').trim();
        if (!fileId) continue;
        const name = String(file?.name ?? '').trim() || fileId;
        files.push({
          fileId,
          documentId,
          name,
          extension: fileExtension(name),
          createdAt: file?.createdDate ?? null,
        });
      }
    }

    if (!files.length) continue;

    files.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    totalFiles += files.length;
    categories.push({
      categoryId,
      label: documentCategoryLabel(categoryId, options?.labels),
      files,
    });
  }

  categories.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    employeeId,
    categories,
    totalFiles,
    fetchedAt: options?.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * Is this an opaque greytHR id, safe to interpolate into a request path?
 *
 * The download path is built from three caller-supplied ids. They are hex strings and UUIDs in
 * practice, so anything outside `[A-Za-z0-9_-]` is rejected rather than escaped — a value containing
 * a slash or a dot-dot would let a caller reshape the upstream URL, and there is no legitimate reason
 * for one.
 */
export const isSafeGreytHRId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);

/**
 * A safe `Content-Disposition` filename.
 *
 * greytHR filenames come from whoever uploaded them, so they can contain quotes, newlines and
 * semicolons — all of which break or hijack the header. Reduced to a conservative set, with a
 * fallback so the download is never nameless.
 */
export function safeDownloadName(name: string | null | undefined, fallback = 'document'): string {
  const clean = String(name ?? '')
    .replace(/[\r\n"\\;]/g, ' ')
    .replace(/[^\w .()-]/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return clean || fallback;
}

/** Content types worth serving inline rather than forcing a download. */
const INLINE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * The content type to serve a document file as.
 *
 * greytHR returns everything as a stream without a useful type, so it is inferred from the name.
 * Anything not recognised is served as `application/octet-stream` — guessing a type for an unknown
 * extension is how a browser gets talked into rendering something it should have downloaded.
 */
export function documentContentType(name: string | null | undefined): {
  contentType: string;
  inline: boolean;
} {
  const extension = fileExtension(name);
  const inlineType = INLINE_TYPES[extension];
  if (inlineType) return { contentType: inlineType, inline: true };
  if (extension === 'txt') return { contentType: 'text/plain; charset=utf-8', inline: false };
  return { contentType: 'application/octet-stream', inline: false };
}

/* ------------------------------------------------------------------------------------------------
 * Leave balances
 * ---------------------------------------------------------------------------------------------- */

/**
 * `GET /leave/v2/employee/years/{year}/balance` — one row per employee.
 *
 * `leaveTypeCategory` is a bare numeric id here. The *single-employee* variant of the same endpoint
 * returns it as an object carrying `description` and `code` — which is how the id→name dictionary is
 * obtained without a LOV key for leave types (there isn't one). See `leaveTypeNamesFrom`.
 */
export interface GreytHRLeaveBalanceRow {
  employeeId: number;
  summaries?: Array<{
    leaveTypeCategory?: number | null;
    balance?: number | null;
    ob?: number | null;
    grant?: number | null;
    availed?: number | null;
    applied?: number | null;
    lapsed?: number | null;
    deducted?: number | null;
    encashed?: number | null;
  }> | null;
}

/** The single-employee shape, used only to learn the leave-type names. */
export interface GreytHRLeaveBalanceDetail {
  list?: Array<{
    leaveTypeCategory?: { id?: number; description?: string; code?: string } | null;
  }> | null;
}

/**
 * Build the leave-type id → name dictionary from one employee's detailed balance.
 *
 * There is no `lov::leavetype` key, and the bulk endpoint returns ids only — so a report would read
 * "leave type 3: 5 days". One extra call for a single employee yields the whole org's dictionary,
 * because leave types are organisation-wide.
 */
export function leaveTypeNamesFrom(
  detail: GreytHRLeaveBalanceDetail | null | undefined,
): Record<string, { name: string; code: string }> {
  const out: Record<string, { name: string; code: string }> = {};
  for (const row of detail?.list ?? []) {
    const category = row?.leaveTypeCategory;
    if (!category || category.id === undefined || category.id === null) continue;
    const name = String(category.description ?? '').trim();
    if (!name) continue;
    out[String(category.id)] = { name, code: String(category.code ?? '').trim() };
  }
  return out;
}

/** One leave type's position for one employee, as stored and displayed. */
export interface LeaveBalanceLine {
  leaveTypeId: string;
  leaveType: string;
  code: string;
  /** What is left. The number anybody actually asks for. */
  balance: number;
  openingBalance: number;
  granted: number;
  availed: number;
  applied: number;
  lapsed: number;
  encashed: number;
}

export interface EmployeeLeaveBalance {
  employeeId: string;
  year: string;
  lines: LeaveBalanceLine[];
  /** Sum of `balance` across types — a headline figure, not a substitute for the breakdown. */
  totalBalance: number;
  syncedAt: string;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Normalise one employee's leave balance.
 *
 * `availed` and `deducted` arrive negative from greytHR (they are ledger movements), so they are
 * reported as absolute magnitudes — "availed: 4 days" reads correctly and "availed: −4" does not.
 * `balance` is left signed, because a negative balance is a real and meaningful state.
 */
export function buildLeaveBalance(
  row: GreytHRLeaveBalanceRow,
  options: {
    year: string;
    leaveTypeNames?: Record<string, { name: string; code: string }>;
    syncedAt?: string;
  },
): EmployeeLeaveBalance {
  const lines: LeaveBalanceLine[] = [];

  for (const summary of row.summaries ?? []) {
    const id = summary?.leaveTypeCategory;
    if (id === undefined || id === null) continue;
    const key = String(id);
    const known = options.leaveTypeNames?.[key];
    lines.push({
      leaveTypeId: key,
      // Falls back to the id rather than blank: "Leave type 7" at least tells the reader what to
      // look up, whereas an empty cell looks like missing data.
      leaveType: known?.name ?? `Leave type ${key}`,
      code: known?.code ?? '',
      balance: num(summary.balance),
      openingBalance: num(summary.ob),
      granted: num(summary.grant),
      availed: Math.abs(num(summary.availed)),
      applied: Math.abs(num(summary.applied)),
      lapsed: Math.abs(num(summary.lapsed)),
      encashed: Math.abs(num(summary.encashed)),
    });
  }

  lines.sort((a, b) => a.leaveType.localeCompare(b.leaveType));

  return {
    employeeId: String(row.employeeId),
    year: options.year,
    lines,
    totalBalance: lines.reduce((sum, line) => sum + line.balance, 0),
    syncedAt: options.syncedAt ?? new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Attendance summary
 * ---------------------------------------------------------------------------------------------- */

/**
 * `GET /attendance/v2/employee/insights?start&end` — one row per employee.
 *
 * Note the field is `employee`, not `employeeId`. greytHR is inconsistent about this across modules.
 */
export interface GreytHRAttendanceInsightRow {
  employee: number;
  insights?: {
    averages?: Array<{ type?: string | null; average?: string | number | null }> | null;
    days?: Array<{ type?: string | null; days?: number | null }> | null;
  } | null;
}

export interface EmployeeAttendanceSummary {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  /** `workHours` → `"9:00"`, `inTime` → `"9:31"`. Kept as greytHR's own `H:mm` strings. */
  averages: Record<string, string>;
  /** `lateIn` → 2, `penalty` → 0. */
  days: Record<string, number>;
  syncedAt: string;
}

/**
 * Normalise one employee's attendance insights.
 *
 * The averages are kept as greytHR's `H:mm` strings rather than parsed to minutes. They are only
 * displayed, and "9:00" is what an HR user recognises — converting to 540 and back would introduce
 * rounding for no gain. `"00:00"` is dropped, because greytHR emits it for "no data" and a screen
 * showing an average in-time of midnight is worse than showing nothing.
 */
export function buildAttendanceSummary(
  row: GreytHRAttendanceInsightRow,
  options: { periodStart: string; periodEnd: string; syncedAt?: string },
): EmployeeAttendanceSummary {
  const averages: Record<string, string> = {};
  for (const entry of row.insights?.averages ?? []) {
    const type = String(entry?.type ?? '').trim();
    const average = entry?.average;
    if (!type || average === null || average === undefined) continue;
    const value = String(average).trim();
    if (!value || value === '00:00' || value === '0:00') continue;
    averages[type] = value;
  }

  const days: Record<string, number> = {};
  for (const entry of row.insights?.days ?? []) {
    const type = String(entry?.type ?? '').trim();
    if (!type) continue;
    // Zero is kept here — "late in: 0 days" is a useful, positive statement about somebody.
    days[type] = num(entry?.days);
  }

  return {
    employeeId: String(row.employee),
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    averages,
    days,
    syncedAt: options.syncedAt ?? new Date().toISOString(),
  };
}

/** Whether a summary holds anything worth storing. */
export const hasAttendanceData = (summary: EmployeeAttendanceSummary): boolean =>
  Object.keys(summary.averages).length > 0 || Object.values(summary.days).some((value) => value !== 0);

/** Human labels for greytHR's insight type codes. */
export const ATTENDANCE_LABELS: Record<string, string> = {
  workHours: 'Average work hours',
  actualWorkHours: 'Average actual hours',
  inTime: 'Average in-time',
  outTime: 'Average out-time',
  workHoursDiff: 'Work-hours variance',
  actualWorkHoursDiff: 'Actual-hours variance',
  penalty: 'Penalty days',
  lateIn: 'Late arrivals',
  earlyOut: 'Early departures',
  excess: 'Excess-hours days',
  absent: 'Absent days',
  present: 'Present days',
  leave: 'Leave days',
  holiday: 'Holidays',
  weeklyOff: 'Weekly offs',
  onDuty: 'On-duty days',
};

export const attendanceLabel = (type: string): string => ATTENDANCE_LABELS[type] ?? type;

/**
 * The month to fetch attendance for.
 *
 * The current month to date, because that is the question a supervisor asks ("how has this person
 * been this month"). A fixed lookback would drift out of step with payroll periods, and fetching
 * more than a month of muster-backed insights for 1,300 people on every run is not worth it.
 */
export function currentAttendancePeriod(now: Date = new Date()): { start: string; end: string } {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return { start: `${year}-${month}-01`, end: todayIso(now) };
}

/** The leave year to fetch. greytHR keys balances by calendar year. */
export const currentLeaveYear = (now: Date = new Date()): string => String(now.getFullYear());

/* ------------------------------------------------------------------------------------------------
 * Telling employee records apart from salary rows
 * ---------------------------------------------------------------------------------------------- */

/**
 * Is this `employees` document an actual employee, or a salary row?
 *
 * The `employees` collection holds two different kinds of document, which is not a design anybody
 * chose. `sync-salary-flow.ts` writes **one extra document per employee per month** into it —
 * `addDoc`, so a random id, `employeeId` set to the employee *number* rather than greytHR's numeric
 * id, `salaryMonth` set, and department/designation/email deliberately blank. At a few months ×
 * ~1,300 people that is thousands of documents that look like employees and are not.
 *
 * Everything that reads the collection as a roster has to filter them out, or:
 *
 *   - a full resync reports every salary row as "exists here but greytHR did not return it";
 *   - the "create a user for this person" picker offers them, because they are `status: 'Active'`;
 *   - headcounts are wrong by a multiple of the number of months synced.
 *
 * `salaryMonth` is the discriminator: a real employee record never has it, and every salary row
 * does. Checked positively rather than inferred from a blank designation, because a genuine employee
 * can legitimately have no designation on file.
 */
export function isEmployeeMasterRecord(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  const salaryMonth = data.salaryMonth;
  return salaryMonth === undefined || salaryMonth === null || salaryMonth === '';
}

/** The inverse, for code that wants the salary rows — reporting, or a future migration. */
export const isSalaryRow = (data: Record<string, unknown> | null | undefined): boolean =>
  !!data && !isEmployeeMasterRecord(data);

/** Tolerant reader, so a settings document written before a field existed still loads. */
export function normalizeSyncSettings(
  raw: Partial<GreytHRSyncSettings> | null | undefined,
): GreytHRSyncSettings {
  const schedule: Partial<SyncSchedule> = raw?.schedule ?? {};
  const frequency = SYNC_FREQUENCIES.includes(schedule.frequency as SyncFrequency)
    ? (schedule.frequency as SyncFrequency)
    : DEFAULT_SYNC_SCHEDULE.frequency;
  const hour = Number(schedule.hourOfDay);
  const day = Number(schedule.dayOfWeek);

  return {
    schedule: {
      enabled: schedule.enabled === true,
      frequency,
      hourOfDay: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SYNC_SCHEDULE.hourOfDay,
      dayOfWeek: Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_SYNC_SCHEDULE.dayOfWeek,
    },
    exitPolicy: EXIT_ACCESS_POLICIES.includes(raw?.exitPolicy as ExitAccessPolicy)
      ? (raw!.exitPolicy as ExitAccessPolicy)
      : 'Flag for review',
    mapping: {
      // Facts are always synced — an integration that fetches employee data and declines to record
      // it has no purpose, and every screen downstream reads these fields.
      syncEmployeeFacts: true,
      syncAccessMembership: raw?.mapping?.syncAccessMembership !== false,
      syncProjectAccess: raw?.mapping?.syncProjectAccess === true,
      // `!== false` rather than `=== true`, so a settings document written before this field existed
      // adopts the default rather than silently disabling the linking every exit policy depends on.
      autoLinkUsers: raw?.mapping?.autoLinkUsers !== false,
    },
    // Read per group against each one's own default, so a settings document written before a group
    // existed picks up that group's default rather than silently enabling a sensitive fetch.
    detailGroups: Object.fromEntries(
      EMPLOYEE_DETAIL_GROUPS.map((spec) => {
        const stored = raw?.detailGroups?.[spec.group];
        return [spec.group, typeof stored === 'boolean' ? stored : spec.defaultEnabled];
      }),
    ) as Record<EmployeeDetailGroup, boolean>,
    lastSuccessfulRunAt: raw?.lastSuccessfulRunAt ?? null,
    // Absent on every installation that predates this field, which is correct: none of them has a
    // baseline this code can vouch for, so the next run rebuilds one.
    baselineCompletedAt: raw?.baselineCompletedAt ?? null,
    mirrorVersion:
      Number.isInteger(raw?.mirrorVersion) && Number(raw?.mirrorVersion) >= 0
        ? Number(raw?.mirrorVersion)
        : 0,
    lastRunAt: raw?.lastRunAt ?? null,
    lastRunId: raw?.lastRunId ?? null,
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
    updatedByName: raw?.updatedByName,
  };
}

/** One employee's outcome in a run, for the review screen. */
export interface SyncEmployeeOutcome {
  employeeId: string;
  employeeNo: string;
  name: string;
  email: string;
  employmentState: EmploymentState;
  employmentStateReason: string;
  changes: FieldDelta[];
  /** The linked platform user, when one was matched. */
  userId?: string | null;
  accessAction: AccessDecision['action'];
  accessReason: string;
  flagged: boolean;
}

export interface GreytHRSyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  /** `'cron'` or `'manual'`. */
  trigger: 'cron' | 'manual';
  triggeredBy?: string | null;
  triggeredByName?: string | null;
  /** Whether this run refetched everything rather than using `modifiedSince`. */
  fullResync: boolean;
  modifiedSince: string | null;
  ok: boolean;
  error?: string | null;
  employeesFetched: number;
  employeesCreated: number;
  employeesUpdated: number;
  employeesUnchanged: number;
  usersDeactivated: number;
  usersReactivated: number;
  flaggedForReview: number;
  membershipUpdated: number;
  /**
   * Logins linked to a greytHR employee by this run, and how many the matcher declined to guess at.
   *
   * Reported as a pair on purpose. "12 linked" alone reads as success; "12 linked, 3 left for
   * review" says there is a queue somebody has to work through — and those three are precisely the
   * accounts an exit policy still cannot act on.
   */
  usersAutoLinked?: number;
  usersLeftForReview?: number;
  /** Restricted-data documents written. 0 when no sensitive group is enabled. */
  sensitiveRecordsWritten?: number;
  /** Which detail groups this run actually fetched, for the report. */
  detailGroupsRun?: string[];
  tookMs: number;
  /** Only the rows worth showing — changed or flagged. A full 1,300-row dump is not a report. */
  outcomes: SyncEmployeeOutcome[];
  warnings: string[];
}

/** Roll a run's per-employee outcomes into its counters. */
export function summarizeRun(
  outcomes: SyncEmployeeOutcome[],
  created: Set<string>,
): Pick<
  GreytHRSyncRun,
  'employeesCreated' | 'employeesUpdated' | 'employeesUnchanged' | 'usersDeactivated' | 'usersReactivated' | 'flaggedForReview'
> {
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;
  let reactivated = 0;
  let flagged = 0;

  for (const outcome of outcomes) {
    if (created.has(outcome.employeeId)) {
      // Counted as created, not updated — a new employee's every field is a "change".
    } else if (outcome.changes.length) updated += 1;
    else unchanged += 1;

    if (outcome.accessAction === 'deactivate') deactivated += 1;
    if (outcome.accessAction === 'reactivate') reactivated += 1;
    if (outcome.flagged) flagged += 1;
  }

  return {
    employeesCreated: created.size,
    employeesUpdated: updated,
    employeesUnchanged: unchanged,
    usersDeactivated: deactivated,
    usersReactivated: reactivated,
    flaggedForReview: flagged,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Linking greytHR employees to platform users
 * ---------------------------------------------------------------------------------------------- */

/**
 * Match an employee to a platform user.
 *
 * Two joins, in order of trust:
 *
 *   1. **An explicit link.** A user created by picking a greytHR employee carries that employee's id
 *      on their own record. That is a decision an administrator made, so it beats any inference.
 *   2. **Email**, case-insensitively and trimmed, because greytHR and Firebase Auth disagree about
 *      both often enough to matter.
 *
 * The explicit link exists because email alone is fragile: a person whose work address changes, or
 * who has none, silently stops matching — and the failure is invisible until their resignation does
 * not take effect. Returns null rather than guessing; a wrong match would apply one person's
 * resignation to another person's login.
 */
export function matchUserForEmployee(
  employee: Pick<SyncedEmployee, 'email' | 'employeeId'>,
  usersByEmail: Map<string, string>,
  usersByEmployeeId?: Map<string, string>,
): string | null {
  const linked = employee.employeeId ? usersByEmployeeId?.get(String(employee.employeeId)) : undefined;
  if (linked) return linked;

  const email = (employee.email || '').trim().toLowerCase();
  if (!email) return null;
  return usersByEmail.get(email) ?? null;
}

/**
 * The explicit employeeId → userId index.
 *
 * Duplicates are dropped for the same reason email duplicates are: two accounts claiming one
 * employee is a data problem, and picking either would silently apply that employee's exit to the
 * wrong login.
 */
export function indexUsersByEmployeeId(
  users: Array<{ id: string; employeeId?: string | null }>,
): { index: Map<string, string>; duplicates: string[] } {
  const index = new Map<string, string>();
  const duplicates: string[] = [];
  for (const user of users) {
    const employeeId = String(user.employeeId ?? '').trim();
    if (!employeeId) continue;
    if (index.has(employeeId)) {
      duplicates.push(employeeId);
      continue;
    }
    index.set(employeeId, user.id);
  }
  for (const employeeId of duplicates) index.delete(employeeId);
  return { index, duplicates: [...new Set(duplicates)] };
}

/* ------------------------------------------------------------------------------------------------
 * Picking a greytHR employee when creating a user
 * ---------------------------------------------------------------------------------------------- */

/**
 * An employee offered in the "create a user for this person" picker.
 *
 * A projection of `SyncedEmployee` rather than the whole thing: this crosses the wire to a screen
 * that only needs to show and prefill, and the full record carries category history and audit
 * stamps that screen has no use for.
 */
export interface LinkableEmployee {
  employeeId: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  location: string;
  projectName: string;
  projectDivision: string;
  grade: string;
  costCenter: string;
  employeeType: string;
  employmentType: string;
  employmentState: EmploymentState;
  dateOfJoin: string | null;
  /**
   * Why the mirror thinks they are in that state, and the date behind it.
   *
   * Carried to the picker specifically so an exclusion can be argued with. "154 excluded (relieved)"
   * reads as a fact about the workforce; "Last working day was 1900-01-01" reads as the data problem
   * it actually is. Without this the only way to tell the two apart was to open Firestore.
   */
  employmentStateReason: string;
  exitDate: string | null;
  /**
   * Whether the stored exit state was overruled as a placeholder.
   *
   * Surfaced rather than applied silently: an employee shown as Active because this app disbelieved
   * greytHR's leaving date is a different claim from one greytHR itself calls Active, and an
   * administrator deciding whether to give somebody a login should be able to tell them apart.
   */
  employmentStateCorrected: boolean;
  /** The user this employee is already linked to, if any. */
  linkedUserId: string | null;
  /** How the link was established, for the picker to explain itself. */
  linkedBy: 'employeeId' | 'email' | null;
}

export function toLinkableEmployee(
  employee: Partial<SyncedEmployee> & { employeeId: string },
  link?: { userId: string | null; via: 'employeeId' | 'email' | null },
): LinkableEmployee {
  /**
   * The stored state, re-judged on the way out.
   *
   * Applied here rather than in each caller because every screen that reads the mirror goes through
   * this projection, and a correction some callers apply is a correction two screens will disagree
   * about. A record whose leaving date is 1900-01-01 is reported as Active by all of them or none.
   */
  const revised = reviseStoredEmploymentState(employee);

  return {
    employeeId: String(employee.employeeId),
    employeeNo: employee.employeeNo ?? '',
    name: employee.name ?? '',
    email: employee.email ?? '',
    phone: employee.phone ?? '',
    department: employee.department ?? '',
    designation: employee.designation ?? '',
    location: employee.location ?? '',
    projectName: employee.projectName ?? '',
    projectDivision: employee.projectDivision ?? '',
    grade: employee.grade ?? '',
    costCenter: employee.costCenter ?? '',
    employeeType: employee.employeeType ?? '',
    employmentType: employee.employmentType ?? '',
    employmentState: revised.state,
    dateOfJoin: employee.dateOfJoin ?? null,
    employmentStateReason: revised.reason,
    exitDate: revised.exitDate,
    /** True when the mirror said they had left and the date said otherwise. */
    employmentStateCorrected: revised.corrected,
    linkedUserId: link?.userId ?? null,
    linkedBy: link?.via ?? null,
  };
}

/**
 * Should this employee be offered when creating a new user?
 *
 * Only people who still work here, and only those without a login already. Offering a relieved
 * employee invites creating an account for somebody who has left; offering a linked one invites a
 * duplicate account, which then breaks the email join for both.
 *
 * An employee with no email address is still offered — the administrator can type one. Excluding
 * them would hide site staff whose address is being created at the same time as their login.
 */
export function isOfferableForNewUser(employee: LinkableEmployee): boolean {
  if (employee.linkedUserId) return false;
  return isWorkingState(employee.employmentState);
}

/** Why an employee is not offerable, for the picker's "showing N of M" explanation. */
export function offerExclusionReason(employee: LinkableEmployee): string | null {
  if (employee.linkedUserId) return 'Already has a platform login';
  if (!isWorkingState(employee.employmentState)) return `Not currently working (${employee.employmentState})`;
  return null;
}

/** Text a picker search box matches against. */
export const employeeSearchText = (employee: LinkableEmployee): string =>
  [
    employee.name,
    employee.employeeNo,
    employee.employeeId,
    employee.email,
    employee.phone,
    employee.department,
    employee.designation,
    employee.location,
    employee.projectName,
    employee.projectDivision,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

/* ------------------------------------------------------------------------------------------------
 * Category id maps
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two-way maps between category/value names and greytHR's numeric ids.
 *
 * Needed for two things:
 *
 *   1. **Reading a single employee.** `GET /employees/{id}/categories` returns a bare array of
 *      `{category: 6, value: 31}` with no descriptions — unlike the bulk endpoint, which honours
 *      `descRequired=true`. Resolving one employee therefore needs these maps.
 *   2. **Writing back.** `POST`/`PUT /employees/{id}/categories` takes numeric ids in the same
 *      shape, so anything that pushes a designation into greytHR must translate names to ids first.
 *
 * The ids are tenant-specific and change when somebody adds a category in greytHR, which is exactly
 * why they are looked up rather than hardcoded.
 */
export interface CategoryIdMaps {
  /** `"Designation"` → `6`. From `lov::transitiontype`. */
  categoryIdByName: Record<string, number>;
  /** `6` → `"Designation"`. */
  categoryNameById: Record<string, string>;
  /** `"Designation"` → `{ "31": "Site Engineer" }`. From each `cat::<Name>` list. */
  valueNamesByCategory: Record<string, Record<string, string>>;
  /** `"Designation"` → `{ "site engineer": 31 }`, lower-cased for lookup by name. */
  valueIdsByCategory: Record<string, Record<string, number>>;
}

/**
 * A greytHR list id, or null.
 *
 * `Number(null)` is `0` and `Number('')` is `0`, both of which pass `Number.isFinite` — so a
 * malformed `[null, "X"]` row would otherwise register as category id 0 and shadow nothing useful
 * while polluting the map. greytHR ids are positive integers, so anything else is rejected.
 */
const lovId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function buildCategoryIdMaps(lov: GreytHRLovResponse | null | undefined): CategoryIdMaps {
  const categoryIdByName: Record<string, number> = {};
  const categoryNameById: Record<string, string> = {};
  const valueNamesByCategory: Record<string, Record<string, string>> = {};
  const valueIdsByCategory: Record<string, Record<string, number>> = {};

  for (const row of lov?.['lov::transitiontype'] ?? []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = lovId(row[0]);
    const name = typeof row[1] === 'string' ? row[1].trim() : '';
    if (id === null || !name) continue;
    categoryIdByName[name] = id;
    categoryNameById[String(id)] = name;
  }

  for (const [key, rows] of Object.entries(lov ?? {})) {
    if (!key.startsWith('cat::') || !Array.isArray(rows)) continue;
    const categoryName = key.slice('cat::'.length);
    const byId: Record<string, string> = {};
    const byName: Record<string, number> = {};
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = lovId(row[0]);
      const name = typeof row[1] === 'string' ? row[1].trim() : '';
      if (id === null || !name) continue;
      byId[String(id)] = name;
      byName[name.toLowerCase()] = id;
    }
    valueNamesByCategory[categoryName] = byId;
    valueIdsByCategory[categoryName] = byName;
  }

  return { categoryIdByName, categoryNameById, valueNamesByCategory, valueIdsByCategory };
}

/** One entry of the `POST`/`PUT /employees/{id}/categories` body. */
export interface CategoryWriteEntry {
  category: number;
  value: number;
  /** `YYYY-MM-DD`. greytHR's own docs disagree about the key name — see `buildCategoryWriteBody`. */
  effectiveDate: string;
}

/**
 * Translate `{ Designation: 'Site Engineer' }` into the numeric body greytHR's write API expects.
 *
 * Note the field name: greytHR's published request bodies use `effectiveDate`, while the parameter
 * table on the same page documents `EffectiveFrom`. The bodies are the thing that was actually
 * captured from a working request, so `effectiveDate` is what this sends — but that inconsistency is
 * why anything using this should be verified against the tenant before being trusted.
 *
 * Names that do not resolve to an id are returned as `unresolved` rather than silently dropped:
 * writing three of four requested categories and reporting success is worse than refusing.
 */
export function buildCategoryWriteBody(
  assignments: Record<string, string>,
  maps: CategoryIdMaps,
  effectiveDate: string,
): { list: CategoryWriteEntry[]; unresolved: Array<{ category: string; value: string; reason: string }> } {
  const list: CategoryWriteEntry[] = [];
  const unresolved: Array<{ category: string; value: string; reason: string }> = [];

  for (const [categoryName, valueName] of Object.entries(assignments)) {
    if (!valueName) continue;
    const categoryId = maps.categoryIdByName[categoryName];
    if (!Number.isFinite(categoryId)) {
      unresolved.push({ category: categoryName, value: valueName, reason: 'Unknown category in greytHR' });
      continue;
    }
    const valueId = maps.valueIdsByCategory[categoryName]?.[valueName.trim().toLowerCase()];
    if (!Number.isFinite(valueId)) {
      unresolved.push({
        category: categoryName,
        value: valueName,
        reason: `"${valueName}" is not a configured value for ${categoryName} in greytHR`,
      });
      continue;
    }
    list.push({ category: categoryId, value: valueId, effectiveDate });
  }

  return { list, unresolved };
}

/** Build the email → userId index, skipping blanks and reporting duplicates. */
export function indexUsersByEmail(
  users: Array<{ id: string; email?: string | null }>,
): { index: Map<string, string>; duplicates: string[] } {
  const index = new Map<string, string>();
  const duplicates: string[] = [];
  for (const user of users) {
    const email = (user.email || '').trim().toLowerCase();
    if (!email) continue;
    if (index.has(email)) {
      // Two accounts on one address: linking either would be a coin flip, so neither is linked.
      duplicates.push(email);
      continue;
    }
    index.set(email, user.id);
  }
  for (const email of duplicates) index.delete(email);
  return { index, duplicates: [...new Set(duplicates)] };
}
