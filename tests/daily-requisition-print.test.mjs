import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountInWords,
  copyLabel,
  defaultPrintSettings,
  fromMm,
  marginsMm,
  pageCss,
  pageSizeMm,
  printableArea,
  resolvePrintSettings,
  toMm,
  watermarkFor,
} from '../src/lib/daily-requisition-print.ts';

test('no document prints as the checklist always has: A4 portrait, 14 mm all round', () => {
  const s = resolvePrintSettings(undefined);
  assert.equal(pageCss(s), '@page { size: 210mm 297mm; margin: 14mm 14mm 14mm 14mm; }');
  assert.equal(s.documentTitle, 'Check List for Payment');
  assert.equal(s.copies, 1);
});

test('the original document still reads, and what it lacks takes the default', () => {
  const s = resolvePrintSettings({
    paperSize: 'A5',
    orientation: 'landscape',
    margins: { top: '2', bottom: '2', left: '2.5', right: '' },
    marginUnit: 'cm',
    headerText: 'SEL',
  });
  assert.equal(s.paperSize, 'a5');
  assert.deepEqual(pageSizeMm(s), { width: 210, height: 148 });
  assert.deepEqual(marginsMm(s), { top: 20, bottom: 20, left: 25, right: 14 }, 'a blank side takes the default 14 mm, as 1.4 cm');
  assert.equal(s.margins.right, '1.4');
  assert.equal(s.headerText, 'SEL');
  assert.deepEqual(s.sections, defaultPrintSettings().sections);
});

test('bank details print unless Printing Setup turns them off', () => {
  // A document saved before the section existed has no `bank` key, and still prints them.
  assert.equal(resolvePrintSettings({ sections: { details: true, amounts: true, trail: true } }).sections.bank, true);
  assert.equal(resolvePrintSettings({ sections: { bank: false } }).sections.bank, false);
  assert.equal(resolvePrintSettings({ sections: { bank: 'no' } }).sections.bank, true, 'a malformed value takes the default');
});

test('malformed values fall back rather than break the print', () => {
  const s = resolvePrintSettings({ paperSize: 'B9', copies: 7, fontScale: 'huge', watermark: 1, documentTitle: '   ', signatureLabels: ['A', '', 3, 'B'] });
  assert.equal(s.paperSize, 'a4');
  assert.equal(s.copies, 1);
  assert.equal(s.fontScale, 'normal');
  assert.equal(s.watermark, 'none');
  assert.equal(s.documentTitle, 'Check List for Payment');
  assert.deepEqual(s.signatureLabels, ['A', 'B']);
});

test('units convert both ways', () => {
  assert.equal(toMm('1.5', 'cm'), 15);
  assert.equal(toMm(1, 'in'), 25.4);
  assert.equal(toMm('-3', 'mm'), 0);
  assert.equal(fromMm(25.4, 'in'), '1');
  assert.equal(fromMm(15, 'cm'), '1.5');
});

test('the printable area is what the margins leave', () => {
  const s = { ...defaultPrintSettings(), margins: { top: '20', bottom: '20', left: '25', right: '15' } };
  const area = printableArea(s);
  assert.equal(area.width, 170);
  assert.equal(area.height, 257);
  assert.ok(area.share > 0.69 && area.share < 0.71);
});

test('copies are labelled only when there is more than one', () => {
  assert.equal(copyLabel(0, 1), null);
  assert.equal(copyLabel(0, 2), 'Office copy');
  assert.equal(copyLabel(1, 2), 'Site copy');
  assert.equal(copyLabel(2, 3), 'Accounts copy');
});

test('the status watermark follows the requisition', () => {
  assert.equal(watermarkFor('status', 'Received'), 'DRAFT');
  assert.equal(watermarkFor('status', 'Verified'), null);
  assert.equal(watermarkFor('status', 'Paid'), 'PAID');
  assert.equal(watermarkFor('status', 'Cancelled'), 'CANCELLED');
  assert.equal(watermarkFor('copy', 'Verified'), 'COPY');
  assert.equal(watermarkFor('none', 'Paid'), null);
});

test('amounts in words use Indian numbering', () => {
  assert.equal(amountInWords(27500), 'Rupees Twenty-Seven Thousand Five Hundred Only');
  assert.equal(amountInWords(12345678.5), 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(100000), 'Rupees One Lakh Only');
});
