export const INVENTORY_COLLECTIONS = {
  items: 'inventoryItems',
  locations: 'inventoryLocations',
  balances: 'inventoryBalances',
  documents: 'inventoryDocuments',
  ledger: 'stockLedger',
  approvals: 'inventoryApprovalHistory',
  counts: 'inventoryStockCounts',
  idempotency: 'inventoryIdempotency',
  sequences: 'inventoryNumberSequences',
} as const;

export type InventoryClassification = 'Inventory' | 'Non-inventory';
export type InventoryLocationType =
  | 'Central Warehouse'
  | 'Property Store'
  | 'Project Store'
  | 'Transit'
  | 'Quarantine'
  | 'Scrap';

export interface InventoryPackComponent {
  itemId: string;
  quantity: number;
  itemCode?: string;
  itemName?: string;
  unit?: string;
}

export type InventoryDocumentStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'In Transit'
  | 'Partially Received'
  | 'Received'
  | 'Posted'
  | 'Closed'
  | 'Cancelled'
  | 'Reversed';

export type InventoryDocumentType =
  | 'Opening Stock'
  | 'Goods Receipt'
  | 'Goods Issue'
  | 'Store Return'
  | 'Project Consumption'
  | 'Stock Adjustment Increase'
  | 'Stock Adjustment Decrease'
  | 'Damaged Stock'
  | 'Lost Stock'
  | 'Write-Off'
  | 'Pack Assembly'
  | 'Pack Disassembly'
  | 'Stock Transfer'
  | 'Physical Count';

export interface InventoryItem {
  id: string;
  organizationId: string;
  itemCode: string;
  itemName: string;
  description?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  unit: string;
  secondaryUnit?: string;
  conversionFactor?: number;
  barcode?: string;
  qrCode?: string;
  partNumber?: string;
  model?: string;
  minimumStockLevel: number;
  reorderLevel: number;
  maximumStockLevel?: number;
  costRate: number;
  averageCost?: number;
  lastPurchaseRate?: number;
  standardRate?: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  taxCode?: string;
  taxRate?: number;
  active: boolean;
  classification: InventoryClassification;
  serialTracking: boolean;
  batchTracking: boolean;
  expiryTracking: boolean;
  attachmentUrl?: string;
  notes?: string;
  legacyBoqItemId?: string;
  packList?: InventoryPackComponent[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryLocation {
  id: string;
  organizationId: string;
  locationCode: string;
  locationName: string;
  type: InventoryLocationType;
  propertyId?: string;
  propertyName?: string;
  projectId?: string;
  projectName?: string;
  parentLocationId?: string;
  binOrRack?: string;
  address?: string;
  allowedUserIds?: string[];
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryBalance {
  id: string;
  organizationId: string;
  itemId: string;
  locationId: string;
  openingQuantity: number;
  quantityReceived: number;
  quantityIssued: number;
  quantityTransferredIn: number;
  quantityTransferredOut: number;
  quantityReturnedIn: number;
  quantityReturnedOut: number;
  adjustmentIn: number;
  adjustmentOut: number;
  assemblyIn?: number;
  assemblyOut?: number;
  reservedQuantity: number;
  onHandQuantity: number;
  availableQuantity: number;
  averageCost: number;
  inventoryValue: number;
  version: number;
  updatedAt?: unknown;
}

export interface InventoryDocumentLine {
  id: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  description?: string;
  unit?: string;
  requestedQuantity?: number;
  approvedQuantity?: number;
  dispatchedQuantity?: number;
  receivedQuantity?: number;
  rejectedQuantity?: number;
  damagedQuantity?: number;
  outstandingQuantity?: number;
  quantity: number;
  unitCost?: number;
  batchNumber?: string;
  serialNumbers?: string[];
  manufactureDate?: string;
  expiryDate?: string;
  condition?: 'Good' | 'Used but Reusable' | 'Damaged' | 'Scrap';
  remarks?: string;
  boqItemId?: string;
  lineRole?: 'Output' | 'Component' | 'Disassembled' | 'Recovered Component';
  parentPackItemId?: string;
  parentPackItemCode?: string;
  parentPackItemName?: string;
  packQuantity?: number;
  componentQuantityPerPack?: number;
}

export interface InventoryDocument {
  id: string;
  organizationId: string;
  documentNumber: string;
  documentType: InventoryDocumentType;
  transactionDate: string;
  status: InventoryDocumentStatus;
  sourceLocationId?: string;
  sourceLocationName?: string;
  destinationLocationId?: string;
  destinationLocationName?: string;
  projectId?: string;
  projectName?: string;
  propertyId?: string;
  propertyName?: string;
  supplierId?: string;
  supplierName?: string;
  departmentId?: string;
  departmentName?: string;
  requesterId?: string;
  requesterName?: string;
  issuedTo?: string;
  referenceDocument?: string;
  purpose?: string;
  remarks?: string;
  vehicleDetails?: string;
  mainItemId?: string;
  mainItemCode?: string;
  mainItemName?: string;
  buildQuantity?: number;
  unbuildQuantity?: number;
  lines: InventoryDocumentLine[];
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  dispatchedBy?: string;
  receivedBy?: string;
  postedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  postedAt?: unknown;
}

export interface StockLedgerEntry {
  id: string;
  organizationId: string;
  transactionDate: string;
  documentId: string;
  documentNumber: string;
  transactionType: InventoryDocumentType;
  status: 'Posted';
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationName: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  quantityIn: number;
  quantityOut: number;
  unit: string;
  costRate: number;
  totalValue: number;
  balanceAfter: number;
  projectId?: string;
  propertyId?: string;
  supplierId?: string;
  departmentId?: string;
  requesterId?: string;
  referenceDocument?: string;
  remarks?: string;
  parentPackItemId?: string;
  packQuantity?: number;
  createdBy: string;
  approvedBy?: string;
  postedBy: string;
  postingDate?: unknown;
}

export interface InventoryStockCount {
  id: string;
  organizationId: string;
  countNumber: string;
  locationId: string;
  locationName: string;
  countDate: string;
  status: 'Draft' | 'Submitted' | 'Posted' | 'Cancelled';
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    unit: string;
    systemQuantity: number;
    physicalQuantity?: number;
    variance?: number;
    varianceReason?: string;
  }>;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  postedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const DOCUMENT_PREFIX: Record<InventoryDocumentType, string> = {
  'Opening Stock': 'OPN',
  'Goods Receipt': 'GRN',
  'Goods Issue': 'GIS',
  'Store Return': 'SRT',
  'Project Consumption': 'PRC',
  'Stock Adjustment Increase': 'ADJ',
  'Stock Adjustment Decrease': 'ADJ',
  'Damaged Stock': 'DMG',
  'Lost Stock': 'LST',
  'Write-Off': 'WOF',
  'Pack Assembly': 'ASM',
  'Pack Disassembly': 'DSA',
  'Stock Transfer': 'STR',
  'Physical Count': 'STK',
};

export const INBOUND_DOCUMENT_TYPES: InventoryDocumentType[] = [
  'Opening Stock',
  'Goods Receipt',
  'Store Return',
  'Stock Adjustment Increase',
];

export const OUTBOUND_DOCUMENT_TYPES: InventoryDocumentType[] = [
  'Goods Issue',
  'Project Consumption',
  'Stock Adjustment Decrease',
  'Damaged Stock',
  'Lost Stock',
  'Write-Off',
];

export const inventoryBalanceId = (organizationId: string, locationId: string, itemId: string) =>
  [organizationId, locationId, itemId].map((value) => encodeURIComponent(value)).join('__');

export const availableStock = (onHand: number, reserved: number) =>
  Math.max(0, Number(onHand || 0) - Number(reserved || 0));

export const movingWeightedAverage = (
  currentQuantity: number,
  currentAverage: number,
  incomingQuantity: number,
  incomingRate: number,
) => {
  const nextQuantity = currentQuantity + incomingQuantity;
  if (nextQuantity <= 0) return 0;
  return ((currentQuantity * currentAverage) + (incomingQuantity * incomingRate)) / nextQuantity;
};

export const packBuildRequirements = (
  packList: InventoryPackComponent[] = [],
  buildQuantity = 1,
) => packList.map((component) => ({
  ...component,
  requiredQuantity: Number(component.quantity || 0) * Number(buildQuantity || 0),
}));

export const maxBuildablePacks = (
  packList: InventoryPackComponent[] = [],
  availableByItem: ReadonlyMap<string, number>,
) => {
  if (!packList.length) return 0;
  const limits = packList.map((component) => {
    const quantityPerPack = Number(component.quantity || 0);
    if (quantityPerPack <= 0) return 0;
    return Math.floor(Math.max(0, Number(availableByItem.get(component.itemId) || 0)) / quantityPerPack);
  });
  return Math.max(0, Math.min(...limits));
};

export const asDateInput = (value: Date = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
