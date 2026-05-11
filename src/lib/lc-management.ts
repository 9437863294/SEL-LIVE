export const LC_COLLECTIONS = {
  master: 'lcManagementMaster',
  documents: 'lcManagementDocuments',
  payments: 'lcManagementPayments',
  amendments: 'lcManagementAmendments',
} as const;

export const LC_STATUS_FLOW = [
  'Draft',
  'Submitted',
  'Approved',
  'Sent to Bank',
  'LC Opened',
  'Shipment / Dispatch Done',
  'Documents Received',
  'Documents Verified',
  'Payment Due',
  'Payment Settled',
  'Closed',
] as const;

export const LC_TYPES = [
  { value: 'Inland', label: 'Inland' },
  { value: 'Import', label: 'Import' },
] as const;

export const LC_CURRENCIES = ['INR', 'USD', 'EUR', 'AED', 'GBP'] as const;

export const LC_PAYMENT_TERMS = [
  'At Sight',
  'Usance 30 Days',
  'Usance 60 Days',
  'Usance 90 Days',
] as const;

export const LC_REQUIRED_DOCUMENTS = [
  'LC Application',
  'Bank LC Copy',
  'Purchase Order',
  'Supplier Invoice',
  'Packing List',
  'Transport Document / LR / BL / AWB',
  'Bank Debit Advice',
  'Payment Advice',
] as const;

export const LC_IMPORT_ADDITIONAL_DOCUMENTS = ['Bill of Entry'] as const;

export const toLcCode = (seed: number) => `LC/${new Date().getFullYear()}/${String(seed).padStart(4, '0')}`;

export const toDateOnly = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const isFutureOrToday = (value?: string) => {
  const date = toDateOnly(value);
  if (!date) return false;
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return target.getTime() >= today.getTime();
};

export const getDaysRemaining = (value?: string) => {
  const date = toDateOnly(value);
  if (!date) return null;
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const calculateMarginAmount = (lcAmount: number, marginPercent: number) =>
  Number(((Number(lcAmount || 0) * Number(marginPercent || 0)) / 100).toFixed(2));

export const getMandatoryDocumentNames = (lcType?: string) => {
  if (String(lcType || '').toLowerCase() === 'import') {
    return [...LC_REQUIRED_DOCUMENTS, ...LC_IMPORT_ADDITIONAL_DOCUMENTS];
  }
  return [...LC_REQUIRED_DOCUMENTS];
};

export const getStatusTone = (status?: string) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('closed') || normalized.includes('settled')) {
    return 'ok' as const;
  }
  if (normalized.includes('due') || normalized.includes('verified')) {
    return 'warn' as const;
  }
  if (normalized.includes('draft') || normalized.includes('submitted')) {
    return 'muted' as const;
  }
  return 'info' as const;
};
