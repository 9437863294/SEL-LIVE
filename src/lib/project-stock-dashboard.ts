export interface ProjectDashboardBoqItem {
  id: string;
  [key: string]: unknown;
}

export interface ProjectDashboardInventoryLog {
  id: string;
  date?: unknown;
  itemId: string;
  itemName?: string;
  transactionType: string;
  quantity?: number;
  availableQuantity?: number;
  unit?: string;
  cost?: number;
  details?: {
    grnNo?: string;
    issuedTo?: string;
    supplier?: string;
    sourceGrn?: string;
  };
}

export type ProjectStockHealth = 'In stock' | 'Low remaining' | 'Out of stock';

export interface ProjectStockRow {
  itemId: string;
  itemName: string;
  unit: string;
  receivedQuantity: number;
  issuedQuantity: number;
  currentQuantity: number;
  currentValue: number;
  latestCost: number;
  lastMovementAt: Date | null;
  health: ProjectStockHealth;
}

export interface ProjectMovementSummary {
  id: string;
  reference: string;
  transactionType: string;
  date: Date | null;
  lineCount: number;
  totalAmount: number;
  counterparty: string;
}

export interface ProjectStockDashboardResult {
  boqItemCount: number;
  boqValue: number;
  coveredBoqItemCount: number;
  boqCoveragePercentage: number;
  currentStockValue: number;
  itemsInStock: number;
  lowStockItems: number;
  outOfStockItems: number;
  receiptDocumentCount: number;
  issueDocumentCount: number;
  stockRows: ProjectStockRow[];
  movementSummaries: ProjectMovementSummary[];
}

const numberKeys = {
  quantity: ['QTY', 'BOQ QTY', 'Total Qty', 'Quantity', 'QUANTITY'],
  rate: ['Unit Rate', 'UNIT RATE', 'Rate', 'RATE', 'Budget Price'],
  total: ['Total Amount', 'TOTAL AMOUNT', 'Total Budget Price'],
} as const;

const descriptionKeys = [
  'Description',
  'DESCRIPTION OF ITEMS',
  'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)',
] as const;

const unitKeys = ['Unit', 'UNIT', 'UNITS', 'UOM'] as const;

function finiteNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const normalized = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(item: ProjectDashboardBoqItem, keys: readonly string[]) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') return finiteNumber(item[key]);
  }
  return 0;
}

function firstString(item: ProjectDashboardBoqItem | undefined, keys: readonly string[]) {
  if (!item) return '';
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export function projectBoqDescription(item: ProjectDashboardBoqItem | undefined) {
  const direct = firstString(item, descriptionKeys);
  if (direct) return direct;
  if (!item) return '';
  const fallbackKey = Object.keys(item).find((key) => key.toLowerCase().includes('description'));
  return fallbackKey ? String(item[fallbackKey] || '').trim() : '';
}

export function projectBoqQuantity(item: ProjectDashboardBoqItem) {
  return firstNumber(item, numberKeys.quantity);
}

export function projectBoqUnit(item: ProjectDashboardBoqItem | undefined) {
  return firstString(item, unitKeys) || 'N/A';
}

export function projectBoqAmount(item: ProjectDashboardBoqItem) {
  const explicitTotal = firstNumber(item, numberKeys.total);
  if (explicitTotal) return explicitTotal;
  return projectBoqQuantity(item) * firstNumber(item, numberKeys.rate);
}

function movementKey(log: ProjectDashboardInventoryLog, date: Date | null) {
  if (log.transactionType === 'Goods Receipt' && log.details?.grnNo) return `receipt:${log.details.grnNo}`;
  const minute = date ? date.toISOString().slice(0, 16) : log.id;
  if (log.transactionType === 'Goods Issue') return `issue:${minute}:${log.details?.issuedTo || 'Unknown'}`;
  return `${log.transactionType}:${minute}:${log.id}`;
}

function movementReference(log: ProjectDashboardInventoryLog, date: Date | null) {
  if (log.transactionType === 'Goods Receipt') return log.details?.grnNo || `Receipt ${date?.toISOString().slice(0, 10) || log.id}`;
  if (log.transactionType === 'Goods Issue') return `Issue · ${log.details?.issuedTo || 'Unassigned'}`;
  return `${log.transactionType} · ${date?.toISOString().slice(0, 10) || log.id}`;
}

export function calculateProjectStockDashboard(
  boqItems: ProjectDashboardBoqItem[],
  inventoryLogs: ProjectDashboardInventoryLog[],
): ProjectStockDashboardResult {
  const boqById = new Map(boqItems.map((item) => [item.id, item]));
  const stockByItem = new Map<string, Omit<ProjectStockRow, 'health'>>();
  const coveredBoqIds = new Set<string>();
  const movementMap = new Map<string, ProjectMovementSummary>();

  inventoryLogs.forEach((log) => {
    const boqItem = boqById.get(log.itemId);
    if (boqItem) coveredBoqIds.add(log.itemId);
    const movementDate = asDate(log.date);
    const current = stockByItem.get(log.itemId) || {
      itemId: log.itemId,
      itemName: log.itemName || projectBoqDescription(boqItem) || 'Unnamed item',
      unit: log.unit || projectBoqUnit(boqItem),
      receivedQuantity: 0,
      issuedQuantity: 0,
      currentQuantity: 0,
      currentValue: 0,
      latestCost: 0,
      lastMovementAt: null,
    };
    const quantity = Math.max(0, finiteNumber(log.quantity));
    const availableQuantity = Math.max(0, finiteNumber(log.availableQuantity));
    const cost = Math.max(0, finiteNumber(log.cost));

    if (log.transactionType === 'Goods Receipt') {
      current.receivedQuantity += quantity;
      // Goods Issue posting already decrements availableQuantity on the source
      // receipt layer. Subtracting Goods Issue again would understate stock.
      current.currentQuantity += availableQuantity;
      current.currentValue += availableQuantity * cost;
      if (cost > 0) current.latestCost = cost;
    } else if (log.transactionType === 'Goods Issue') {
      current.issuedQuantity += quantity;
      if (cost > 0) current.latestCost = cost;
    }
    if (!current.lastMovementAt || (movementDate && movementDate > current.lastMovementAt)) current.lastMovementAt = movementDate;
    stockByItem.set(log.itemId, current);

    const key = movementKey(log, movementDate);
    const summary = movementMap.get(key) || {
      id: key,
      reference: movementReference(log, movementDate),
      transactionType: log.transactionType,
      date: movementDate,
      lineCount: 0,
      totalAmount: 0,
      counterparty: log.transactionType === 'Goods Receipt'
        ? log.details?.supplier || 'Supplier not recorded'
        : log.details?.issuedTo || 'Recipient not recorded',
    };
    summary.lineCount += 1;
    summary.totalAmount += quantity * cost;
    if ((!summary.date && movementDate) || (summary.date && movementDate && movementDate > summary.date)) summary.date = movementDate;
    movementMap.set(key, summary);
  });

  const stockRows = Array.from(stockByItem.values()).map<ProjectStockRow>((row) => {
    const remainingRatio = row.receivedQuantity > 0 ? row.currentQuantity / row.receivedQuantity : 1;
    const health: ProjectStockHealth = row.receivedQuantity > 0 && row.currentQuantity <= 0.000001
      ? 'Out of stock'
      : row.receivedQuantity > 0 && remainingRatio <= 0.2
        ? 'Low remaining'
        : 'In stock';
    return { ...row, health };
  }).sort((left, right) => right.currentValue - left.currentValue || left.itemName.localeCompare(right.itemName));

  const movementSummaries = Array.from(movementMap.values()).sort((left, right) =>
    (right.date?.getTime() || 0) - (left.date?.getTime() || 0),
  );
  const boqValue = boqItems.reduce((sum, item) => sum + projectBoqAmount(item), 0);
  const currentStockValue = stockRows.reduce((sum, row) => sum + row.currentValue, 0);
  const itemsInStock = stockRows.filter((row) => row.currentQuantity > 0.000001).length;
  const lowStockItems = stockRows.filter((row) => row.health === 'Low remaining').length;
  const outOfStockItems = stockRows.filter((row) => row.health === 'Out of stock').length;
  const receiptDocumentCount = movementSummaries.filter((summary) => summary.transactionType === 'Goods Receipt').length;
  const issueDocumentCount = movementSummaries.filter((summary) => summary.transactionType === 'Goods Issue').length;

  return {
    boqItemCount: boqItems.length,
    boqValue,
    coveredBoqItemCount: coveredBoqIds.size,
    boqCoveragePercentage: boqItems.length ? (coveredBoqIds.size / boqItems.length) * 100 : 0,
    currentStockValue,
    itemsInStock,
    lowStockItems,
    outOfStockItems,
    receiptDocumentCount,
    issueDocumentCount,
    stockRows,
    movementSummaries,
  };
}
