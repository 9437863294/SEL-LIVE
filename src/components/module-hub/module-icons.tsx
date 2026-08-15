import type { SVGProps } from "react";

export type ModuleIconProps = SVGProps<SVGSVGElement>;

/**
 * Shared wrapper so every custom module icon renders with the same
 * viewBox / stroke conventions (24x24, currentColor, rounded joins).
 * Individual icons only need to provide their inner shapes.
 */
function Base({ children, ...props }: ModuleIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Fixed Deposit Management — a locked vault/safe. */
export function VaultIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="8" x2="12" y2="9.3" />
      <circle cx="7" cy="7" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="7" r="0.6" fill="currentColor" stroke="none" />
    </Base>
  );
}

/** Chat System — a speech bubble with a typing indicator. */
export function ChatBubbleIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.2V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </Base>
  );
}

/** Site Fund Requisition — a bank facade (classic columns). */
export function BankColumnsIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M3 9 12 3l9 6" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="6" y1="9" x2="6" y2="17" />
      <line x1="10.5" y1="9" x2="10.5" y2="17" />
      <line x1="13.5" y1="9" x2="13.5" y2="17" />
      <line x1="18" y1="9" x2="18" y2="17" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </Base>
  );
}

/** Daily Requisition — a clipboard with a checked item. */
export function ClipboardCheckIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M8.5 12.5 10.5 14.5 15 10" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </Base>
  );
}

/** Site Fund Requisition 2 — a document with a refreshed / revised workflow loop. */
export function WorkflowLoopIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="11" height="14" rx="1.5" />
      <line x1="7" y1="8" x2="12" y2="8" />
      <line x1="7" y1="11" x2="12" y2="11" />
      <path d="M15 14a4 4 0 1 0 1.2 2.8" />
      <path d="M15.5 12.4 15 14l1.6.6" />
    </Base>
  );
}

/** Site Fund Request — two requests merging into one approval path. */
export function BranchMergeIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M8 6h3a5 5 0 0 1 5 5" />
      <path d="M8 18h3a5 5 0 0 0 5-5" />
    </Base>
  );
}

/** Billing Recon — two statements reconciled with a checkmark. */
export function ReconDocsIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="6" width="11" height="14" rx="1.5" />
      <rect x="10" y="4" width="11" height="14" rx="1.5" />
      <path d="M13 12.5 14.5 14 17.5 10.5" />
    </Base>
  );
}

/** Subcontractors Management — a hard hat. */
export function HardHatIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <line x1="2.5" y1="16" x2="21.5" y2="16" />
      <line x1="12" y1="4" x2="12" y2="8" />
      <path d="M9 8h6" />
    </Base>
  );
}

/** Bank Balance — a bank facade with a small balance chart. */
export function BankBalanceIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M3 9 12 3l9 6" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <rect x="6" y="11" width="2.4" height="7" />
      <rect x="10.8" y="9.5" width="2.4" height="8.5" />
      <rect x="15.6" y="12.5" width="2.4" height="5.5" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </Base>
  );
}

/** Expenses — a receipt with line items. */
export function ReceiptIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M6 3h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3Z" />
      <line x1="8.5" y1="7" x2="15.5" y2="7" />
      <line x1="8.5" y1="10.5" x2="15.5" y2="10.5" />
      <line x1="8.5" y1="14" x2="13" y2="14" />
    </Base>
  );
}

/** Loan — a banknote. */
export function BanknoteIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="7" cy="12" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </Base>
  );
}

/** Recurring Payments — a payment card with a refresh cycle. */
export function RefreshCardIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="8" width="13" height="9" rx="1.5" />
      <line x1="3" y1="11.2" x2="16" y2="11.2" />
      <path d="M16.5 5.5a4.5 4.5 0 1 1-4.4 3.6" />
      <path d="M16.5 3.5v2.3h-2.3" />
    </Base>
  );
}

/** Letter of Credit Management — an envelope with an official seal. */
export function EnvelopeSealIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 6l7 5 7-5" />
      <circle cx="18" cy="16" r="3.2" />
      <path d="M16.5 18.8 15.7 22 18 20.5 20.3 22 19.5 18.8" />
    </Base>
  );
}

/** Bank Guarantee Management — a shield with a verified mark. */
export function ShieldCheckIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 4 6v6c0 5 3.5 7.8 8 9 4.5-1.2 8-4 8-9V6Z" />
      <path d="M9 12.5 11 14.5 15.5 10" />
    </Base>
  );
}

/** Insurance — a shield with a protective umbrella. */
export function ShieldUmbrellaIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 4 6v6c0 5 3.5 7.8 8 9 4.5-1.2 8-4 8-9V6Z" />
      <path d="M8.7 11.2a3.3 3.3 0 0 1 6.6 0" />
      <line x1="12" y1="11.2" x2="12" y2="15.5" />
      <path d="M12 15.5c0 .8-.6 1.2-1.3.9" />
    </Base>
  );
}

/** Employee — an ID badge. */
export function IdBadgeIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M10.2 3h3.6" />
      <circle cx="12" cy="10.5" r="2.3" />
      <path d="M8 17c.6-2.4 2.4-3.6 4-3.6s3.4 1.2 4 3.6" />
    </Base>
  );
}

/** Vehicle Management — a delivery truck. */
export function TruckIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="8" width="11" height="8" rx="1" />
      <path d="M13.5 11h4l3 3v2h-7Z" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </Base>
  );
}

/** Driver Management — a steering wheel. */
export function SteeringWheelIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <line x1="12" y1="6" x2="12" y2="9.8" />
      <path d="M6.5 15.5 9.6 13.4" />
      <path d="M17.5 15.5 14.4 13.4" />
    </Base>
  );
}

/** Store & Stock Management — a stacked, open crate. */
export function StackedBoxesIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M4 9 12 5l8 4-8 4Z" />
      <path d="M4 9v6l8 4 8-4V9" />
      <line x1="12" y1="13" x2="12" y2="19" />
    </Base>
  );
}

/** Project Management — a kanban board. */
export function KanbanIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="5.5" height="16" rx="1.2" />
      <rect x="9.3" y="4" width="5.5" height="10" rx="1.2" />
      <rect x="15.6" y="4" width="5.5" height="13" rx="1.2" />
    </Base>
  );
}

/** Vendor Management — a storefront. */
export function StorefrontIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M3 9 4 4h16l1 5" />
      <path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M4 9v11h16V9" />
      <rect x="10" y="14" width="4" height="6" />
    </Base>
  );
}

/** Site Account Statement — a ledger with a summary chart. */
export function LedgerChartIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <rect x="7" y="13" width="2" height="4" />
      <rect x="11" y="10" width="2" height="7" />
      <rect x="15" y="7" width="2" height="10" />
    </Base>
  );
}

/** Settings — a gear. */
export function GearIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6" />
    </Base>
  );
}

/** Generic fallback for any module without a dedicated icon yet. */
export function DocumentIcon(props: ModuleIconProps) {
  return (
    <Base {...props}>
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="16.5" x2="13" y2="16.5" />
    </Base>
  );
}
