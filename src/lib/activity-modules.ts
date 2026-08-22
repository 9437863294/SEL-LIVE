/**
 * The canonical list of module names used by the activity log and the central
 * notification system.
 *
 * Before this existed, every call site passed a bare string literal, and they
 * drifted: 'insurance' and 'Insurance' were both in use and sorted as two
 * different modules in the audit viewer, while 'Subcontractors' and
 * 'Subcontractors Management' split one module's history in two. Importing a
 * constant instead of typing a literal keeps a module's trail in one place.
 *
 *   import { ACTIVITY_MODULES } from '@/lib/activity-modules';
 *   const { log } = useActivityLogger(ACTIVITY_MODULES.VEHICLE_MANAGEMENT);
 *
 * The values are the display names that were already in the database, not tidied
 * up versions of them — renaming one here orphans every historical log written
 * under the old name. Where a name has already drifted, the drifted spellings are
 * listed in MODULE_NAME_ALIASES so old rows still resolve to the current module.
 */
export const ACTIVITY_MODULES = {
  BANK_BALANCE: 'Bank Balance',
  BANK_GUARANTEE: 'Bank Guarantee',
  BILLING_RECON: 'Billing Recon',
  CHAT_SYSTEM: 'Chat System',
  DAILY_REQUISITION: 'Daily Requisition',
  DRIVER_MANAGEMENT: 'Driver Management',
  EMPLOYEE: 'Employee',
  EXPENSES: 'Expenses',
  FIXED_DEPOSIT: 'Fixed Deposit Management',
  HR_RECRUITMENT: 'HR & Recruitment',
  INSURANCE: 'Insurance',
  LETTER_OF_CREDIT: 'Letter of Credit',
  LOAN: 'Loan',
  PROCUREMENT: 'Procurement',
  PROJECT_MANAGEMENT: 'Project Management',
  RECURRING_PAYMENTS: 'Recurring Payments',
  SETTINGS: 'Settings',
  SITE_ACCOUNT_STATEMENT: 'Site Account Statement',
  SITE_FUND_REQUISITION: 'Site Fund Requisition',
  STORE_STOCK: 'Store & Stock Management',
  SUBCONTRACTORS: 'Subcontractors Management',
  USER_MANAGEMENT: 'User Management',
  VEHICLE_MANAGEMENT: 'Vehicle Management',
  VENDOR_MANAGEMENT: 'Vendor Management',
} as const;

export type ActivityModule = (typeof ACTIVITY_MODULES)[keyof typeof ACTIVITY_MODULES];

/** Every canonical module name, for filter dropdowns. */
export const ACTIVITY_MODULE_NAMES: readonly string[] = Object.values(ACTIVITY_MODULES);

/**
 * Spellings that were written to `userLogs` before the registry existed, mapped to
 * the module they belong to. Read paths run names through `canonicalModuleName` so
 * historical rows group with current ones instead of appearing as separate modules.
 */
export const MODULE_NAME_ALIASES: Record<string, ActivityModule> = {
  insurance: ACTIVITY_MODULES.INSURANCE,
  Subcontractors: ACTIVITY_MODULES.SUBCONTRACTORS,
  'Site Fund Requisition 2': ACTIVITY_MODULES.SITE_FUND_REQUISITION,
  'Daily Requisition Settings': ACTIVITY_MODULES.DAILY_REQUISITION,
  'Fixed Deposit': ACTIVITY_MODULES.FIXED_DEPOSIT,
  'Store and Stock Management': ACTIVITY_MODULES.STORE_STOCK,
  'LC Management': ACTIVITY_MODULES.LETTER_OF_CREDIT,
};

/** Resolve a stored module name to its canonical form. */
export function canonicalModuleName(stored: string | null | undefined): string {
  if (!stored) return 'Unknown';
  return MODULE_NAME_ALIASES[stored] ?? stored;
}

/**
 * Tailwind badge classes per module, for the audit viewer and notification list.
 * Keyed by canonical name; unknown modules fall back to slate.
 */
const MODULE_BADGE_CLASSES: Record<string, string> = {
  [ACTIVITY_MODULES.BANK_BALANCE]: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  [ACTIVITY_MODULES.BANK_GUARANTEE]: 'bg-lime-50 text-lime-700 border-lime-200',
  [ACTIVITY_MODULES.BILLING_RECON]: 'bg-blue-50 text-blue-700 border-blue-200',
  [ACTIVITY_MODULES.CHAT_SYSTEM]: 'bg-pink-50 text-pink-700 border-pink-200',
  [ACTIVITY_MODULES.DAILY_REQUISITION]: 'bg-violet-50 text-violet-700 border-violet-200',
  [ACTIVITY_MODULES.DRIVER_MANAGEMENT]: 'bg-sky-50 text-sky-700 border-sky-200',
  [ACTIVITY_MODULES.EMPLOYEE]: 'bg-green-50 text-green-700 border-green-200',
  [ACTIVITY_MODULES.EXPENSES]: 'bg-amber-50 text-amber-700 border-amber-200',
  [ACTIVITY_MODULES.FIXED_DEPOSIT]: 'bg-teal-50 text-teal-700 border-teal-200',
  [ACTIVITY_MODULES.HR_RECRUITMENT]: 'bg-violet-50 text-violet-700 border-violet-200',
  [ACTIVITY_MODULES.INSURANCE]: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  [ACTIVITY_MODULES.LETTER_OF_CREDIT]: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  [ACTIVITY_MODULES.LOAN]: 'bg-teal-50 text-teal-700 border-teal-200',
  [ACTIVITY_MODULES.PROCUREMENT]: 'bg-orange-50 text-orange-700 border-orange-200',
  [ACTIVITY_MODULES.PROJECT_MANAGEMENT]: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  [ACTIVITY_MODULES.RECURRING_PAYMENTS]: 'bg-purple-50 text-purple-700 border-purple-200',
  [ACTIVITY_MODULES.SETTINGS]: 'bg-slate-100 text-slate-700 border-slate-200',
  [ACTIVITY_MODULES.SITE_ACCOUNT_STATEMENT]: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  [ACTIVITY_MODULES.SITE_FUND_REQUISITION]: 'bg-orange-50 text-orange-700 border-orange-200',
  [ACTIVITY_MODULES.STORE_STOCK]: 'bg-stone-100 text-stone-700 border-stone-200',
  [ACTIVITY_MODULES.SUBCONTRACTORS]: 'bg-rose-50 text-rose-700 border-rose-200',
  [ACTIVITY_MODULES.USER_MANAGEMENT]: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  [ACTIVITY_MODULES.VEHICLE_MANAGEMENT]: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  [ACTIVITY_MODULES.VENDOR_MANAGEMENT]: 'bg-red-50 text-red-700 border-red-200',
};

export const moduleBadgeClass = (module: string | null | undefined): string =>
  MODULE_BADGE_CLASSES[canonicalModuleName(module)]
  ?? 'bg-slate-50 text-slate-600 border-slate-200';

/**
 * Route prefix per module, so a notification or log row can deep-link back to the
 * module it came from without each producer hardcoding a path.
 */
const MODULE_ROUTES: Record<string, string> = {
  [ACTIVITY_MODULES.BANK_BALANCE]: '/bank-balance',
  [ACTIVITY_MODULES.BANK_GUARANTEE]: '/bank-guarantee',
  [ACTIVITY_MODULES.BILLING_RECON]: '/billing-recon',
  [ACTIVITY_MODULES.CHAT_SYSTEM]: '/chat-system',
  [ACTIVITY_MODULES.DAILY_REQUISITION]: '/daily-requisition',
  [ACTIVITY_MODULES.DRIVER_MANAGEMENT]: '/driver-management',
  [ACTIVITY_MODULES.EMPLOYEE]: '/employee',
  [ACTIVITY_MODULES.EXPENSES]: '/expenses',
  [ACTIVITY_MODULES.FIXED_DEPOSIT]: '/fixed-deposit',
  [ACTIVITY_MODULES.INSURANCE]: '/insurance',
  [ACTIVITY_MODULES.LETTER_OF_CREDIT]: '/letter-of-credit',
  [ACTIVITY_MODULES.LOAN]: '/loan',
  [ACTIVITY_MODULES.PROCUREMENT]: '/procurement',
  [ACTIVITY_MODULES.PROJECT_MANAGEMENT]: '/project-management',
  [ACTIVITY_MODULES.RECURRING_PAYMENTS]: '/recurring-payments',
  [ACTIVITY_MODULES.SETTINGS]: '/settings',
  [ACTIVITY_MODULES.SITE_ACCOUNT_STATEMENT]: '/site-account-statement',
  [ACTIVITY_MODULES.SITE_FUND_REQUISITION]: '/site-fund-request',
  [ACTIVITY_MODULES.STORE_STOCK]: '/store-stock-management',
  [ACTIVITY_MODULES.SUBCONTRACTORS]: '/subcontractors-management',
  [ACTIVITY_MODULES.USER_MANAGEMENT]: '/settings/user-management',
  [ACTIVITY_MODULES.VEHICLE_MANAGEMENT]: '/vehicle-management',
  [ACTIVITY_MODULES.VENDOR_MANAGEMENT]: '/vendor-management',
};

export const moduleRoute = (module: string | null | undefined): string | null =>
  MODULE_ROUTES[canonicalModuleName(module)] ?? null;
