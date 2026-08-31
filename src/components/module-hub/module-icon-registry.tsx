import type { ComponentType } from "react";
import {
  BankBalanceIcon,
  BankColumnsIcon,
  BanknoteIcon,
  BranchMergeIcon,
  ChatBubbleIcon,
  ClipboardCheckIcon,
  DocumentIcon,
  EnvelopeSealIcon,
  GearIcon,
  HardHatIcon,
  IdBadgeIcon,
  KanbanIcon,
  LedgerChartIcon,
  PlaneIcon,
  ReceiptIcon,
  ReconDocsIcon,
  RefreshCardIcon,
  ShieldCheckIcon,
  ShieldUmbrellaIcon,
  StackedBoxesIcon,
  SteeringWheelIcon,
  StorefrontIcon,
  TruckIcon,
  VaultIcon,
  WorkflowLoopIcon,
} from "./module-icons";
import type { ModuleIconProps } from "./module-icons";

export interface ModuleIconEntry {
  Icon: ComponentType<ModuleIconProps>;
  /** Tailwind `bg-gradient-to-br` stops for the icon tile background. */
  gradient: string;
}

/**
 * One custom-designed icon + accent gradient per module, keyed by the
 * `Module.icon` string stored on each module (see `src/lib/types.ts`).
 * Keeping the historical lucide-icon-name keys (e.g. "Landmark",
 * "GitMerge") means any module already saved to a user's browser
 * (see `ModuleContext`) keeps resolving correctly after this switch
 * from lucide-react to bespoke SVGs.
 */
export const moduleIconRegistry: Record<string, ModuleIconEntry> = {
  Vault: { Icon: VaultIcon, gradient: "from-violet-600 to-purple-700" },
  MessageSquare: { Icon: ChatBubbleIcon, gradient: "from-sky-500 to-blue-600" },
  Landmark: { Icon: BankColumnsIcon, gradient: "from-emerald-500 to-teal-600" },
  ClipboardCheck: { Icon: ClipboardCheckIcon, gradient: "from-amber-500 to-orange-600" },
  Workflow: { Icon: WorkflowLoopIcon, gradient: "from-teal-500 to-cyan-600" },
  GitMerge: { Icon: BranchMergeIcon, gradient: "from-indigo-500 to-blue-600" },
  CreditCard: { Icon: ReconDocsIcon, gradient: "from-cyan-600 to-sky-700" },
  HardHat: { Icon: HardHatIcon, gradient: "from-stone-500 to-stone-700" },
  Banknote: { Icon: BankBalanceIcon, gradient: "from-blue-600 to-indigo-700" },
  Receipt: { Icon: ReceiptIcon, gradient: "from-rose-500 to-red-600" },
  Coins: { Icon: BanknoteIcon, gradient: "from-orange-500 to-amber-600" },
  RefreshCard: { Icon: RefreshCardIcon, gradient: "from-fuchsia-500 to-pink-600" },
  BookOpenCheck: { Icon: EnvelopeSealIcon, gradient: "from-teal-600 to-emerald-700" },
  ShieldCheck: { Icon: ShieldCheckIcon, gradient: "from-blue-500 to-sky-600" },
  Shield: { Icon: ShieldUmbrellaIcon, gradient: "from-green-600 to-emerald-700" },
  IdBadge: { Icon: IdBadgeIcon, gradient: "from-pink-500 to-rose-600" },
  // HR & Recruitment. Reuses the ID-badge glyph — a manpower module is about people records — with
  // the indigo/violet accent the module's own screens carry.
  Users: { Icon: IdBadgeIcon, gradient: "from-indigo-500 to-violet-600" },
  Truck: { Icon: TruckIcon, gradient: "from-orange-600 to-amber-700" },
  SteeringWheel: { Icon: SteeringWheelIcon, gradient: "from-lime-500 to-green-600" },
  Package: { Icon: StackedBoxesIcon, gradient: "from-yellow-500 to-amber-600" },
  FolderKanban: { Icon: KanbanIcon, gradient: "from-violet-500 to-fuchsia-600" },
  ShoppingCart: { Icon: StorefrontIcon, gradient: "from-purple-600 to-indigo-700" },
  LedgerChart: { Icon: LedgerChartIcon, gradient: "from-indigo-600 to-blue-700" },
  // E-Approval / E-Notesheet. The wax-seal glyph rather than a clipboard: what the module produces
  // is a signed note, and the seal reads that way at 16px where a tick does not.
  Stamp: { Icon: EnvelopeSealIcon, gradient: "from-sky-500 to-indigo-600" },
  Settings: { Icon: GearIcon, gradient: "from-slate-500 to-slate-700" },
  // Tour, Travel & Expense. Sky/cyan matches the module's own theme (see module-layout-shell.tsx).
  Plane: { Icon: PlaneIcon, gradient: "from-sky-500 to-cyan-600" },
};

export const defaultModuleIconEntry: ModuleIconEntry = {
  Icon: DocumentIcon,
  gradient: "from-gray-400 to-gray-600",
};

export function getModuleIconEntry(iconKey: string | undefined): ModuleIconEntry {
  if (!iconKey) return defaultModuleIconEntry;
  return moduleIconRegistry[iconKey] || defaultModuleIconEntry;
}
