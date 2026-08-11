import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_PREFIX,
  availableStock,
  inventoryBalanceId,
  maxBuildablePacks,
  movingWeightedAverage,
  packBuildRequirements,
} from '../src/lib/inventory.ts';
import {
  calculateProjectStockDashboard,
  projectBoqAmount,
  projectBoqQuantity,
} from '../src/lib/project-stock-dashboard.ts';

test('available stock subtracts reservations and never presents a negative availability', () => {
  assert.equal(availableStock(25, 7), 18);
  assert.equal(availableStock(5, 8), 0);
});

test('moving weighted average preserves auditable quantity/value costing', () => {
  const average = movingWeightedAverage(10, 100, 5, 160);
  assert.equal(average, 120);
  assert.equal((10 + 5) * average, (10 * 100) + (5 * 160));
});

test('balance identifiers are deterministic per organization, location, and item', () => {
  assert.equal(inventoryBalanceId('org/1', 'central store', 'PVC-100'), 'org%2F1__central%20store__PVC-100');
  assert.notEqual(inventoryBalanceId('org', 'A', 'item'), inventoryBalanceId('org', 'B', 'item'));
});

test('required inventory document prefixes are stable', () => {
  assert.equal(DOCUMENT_PREFIX['Goods Receipt'], 'GRN');
  assert.equal(DOCUMENT_PREFIX['Goods Issue'], 'GIS');
  assert.equal(DOCUMENT_PREFIX['Stock Transfer'], 'STR');
  assert.equal(DOCUMENT_PREFIX['Physical Count'], 'STK');
  assert.equal(DOCUMENT_PREFIX['Pack Assembly'], 'ASM');
});

test('pack requirements scale every component for the requested build quantity', () => {
  const requirements = packBuildRequirements([
    { itemId: 'A', quantity: 5 },
    { itemId: 'B', quantity: 2 },
  ], 3);
  assert.deepEqual(requirements.map(({ itemId, requiredQuantity }) => ({ itemId, requiredQuantity })), [
    { itemId: 'A', requiredQuantity: 15 },
    { itemId: 'B', requiredQuantity: 6 },
  ]);
});

test('pack availability is limited by the scarcest component', () => {
  const available = new Map([['A', 26], ['B', 9]]);
  assert.equal(maxBuildablePacks([{ itemId: 'A', quantity: 5 }, { itemId: 'B', quantity: 2 }], available), 4);
  assert.equal(maxBuildablePacks([], available), 0);
});

test('project dashboard uses current receipt-layer availability without subtracting issues twice', () => {
  const result = calculateProjectStockDashboard(
    [{ id: 'item-1', QTY: 100, Unit: 'Nos', 'Unit Rate': 10 }],
    [
      { id: 'receipt-1', date: '2026-01-01', itemId: 'item-1', itemName: 'Test item', transactionType: 'Goods Receipt', quantity: 100, availableQuantity: 60, unit: 'Nos', cost: 10, details: { grnNo: 'GRN-1' } },
      { id: 'issue-1', date: '2026-01-02', itemId: 'item-1', itemName: 'Test item', transactionType: 'Goods Issue', quantity: 40, availableQuantity: 0, unit: 'Nos', cost: 10, details: { issuedTo: 'Site' } },
    ],
  );

  assert.equal(result.stockRows[0].currentQuantity, 60);
  assert.equal(result.currentStockValue, 600);
  assert.equal(result.receiptDocumentCount, 1);
  assert.equal(result.issueDocumentCount, 1);
});

test('project dashboard supports the current QTY, Unit Rate, and Total Amount BOQ schema', () => {
  assert.equal(projectBoqQuantity({ id: 'a', QTY: '1,250.5' }), 1250.5);
  assert.equal(projectBoqAmount({ id: 'a', QTY: 5, 'Unit Rate': 250 }), 1250);
  assert.equal(projectBoqAmount({ id: 'a', 'Total Amount': '₹2,500.75' }), 2500.75);
});
