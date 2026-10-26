/**
 * The payment report as files: an Excel workbook (a sheet per section), a PDF for signing off, and
 * the JSON the app itself reads. No DOM and no server-only imports, so tests can open the files.
 *
 * The PDF uses pdf-lib's standard Helvetica, which cannot draw "₹" — amounts read "Rs." there.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { buildWorkbookBuffer, type ExcelSheet } from '../report-excel.ts';
import { monthLabel } from './dates.ts';
import { COST_BASIS_LABELS, FLEET_CATEGORY_LABELS, FLEET_TRIP_STATUS_LABELS, TRIP_FLAG_LABELS, type PaymentReport } from './types.ts';

const MONEY = '#,##0.00';
const KM = '#,##0.0';

export function reportTitle(report: Pick<PaymentReport, 'monthKey' | 'from' | 'to'>): string {
  return report.monthKey ? `Fleet payment report — ${monthLabel(report.monthKey)}` : `Fleet payment report — ${report.from} to ${report.to}`;
}

export function reportSheets(report: PaymentReport): ExcelSheet[] {
  return [
    {
      name: 'Summary',
      columns: [
        { header: 'Item', key: 'item', width: 36 },
        { header: 'Value', key: 'value', width: 20 },
      ],
      rows: [
        { item: 'Period', value: `${report.from} to ${report.to}` },
        { item: 'Status', value: report.status === 'approved' ? `Approved by ${report.approvedByName} on ${report.approvedAt?.slice(0, 10)}` : 'Draft — not approved' },
        { item: 'Trips paid', value: report.totals.trips },
        { item: 'Billable km', value: report.totals.km },
        { item: 'Per-km cost (₹)', value: report.totals.perKmCost },
        { item: 'Fixed charges (₹)', value: report.totals.fixedCost },
        { item: 'Fuel on fixed-plus-fuel vehicles (₹)', value: report.totals.fuelCost },
        { item: 'Payable (₹)', value: report.totals.payable },
        { item: 'Held trips (waiting for review)', value: report.totals.heldTrips },
        { item: 'Driver reimbursements (₹)', value: report.totals.reimbursements },
      ],
    },
    {
      name: 'A Project-wise',
      columns: [
        { header: 'Project code', key: 'projectCode', width: 14 },
        { header: 'Project', key: 'projectName', width: 36 },
        { header: 'Trips', key: 'trips', width: 8 },
        { header: 'Km', key: 'km', width: 12, numFmt: KM },
        { header: 'Per-km cost (₹)', key: 'perKmCost', width: 16, numFmt: MONEY },
        { header: 'Fixed share (₹)', key: 'fixedShare', width: 16, numFmt: MONEY },
        { header: 'Fuel share (₹)', key: 'fuelShare', width: 16, numFmt: MONEY },
        { header: 'Total (₹)', key: 'total', width: 16, numFmt: MONEY },
        { header: 'Carried from earlier', key: 'carriedTrips', width: 18 },
      ],
      rows: report.reportA.map((row) => ({ ...row })),
    },
    {
      name: 'B Vehicle-wise',
      columns: [
        { header: 'Vehicle', key: 'vehicleNumber', width: 16 },
        { header: 'Category', key: 'category', width: 16 },
        { header: 'Cost basis', key: 'costBasis', width: 20 },
        { header: 'Trips', key: 'trips', width: 8 },
        { header: 'Km', key: 'km', width: 12, numFmt: KM },
        { header: 'Fuel (L)', key: 'fuelLitres', width: 12, numFmt: MONEY },
        { header: 'Fuel (₹)', key: 'fuelAmount', width: 14, numFmt: MONEY },
        { header: 'Expected fuel (L)', key: 'expectedLitres', width: 16, numFmt: MONEY },
        { header: 'Variance (L)', key: 'varianceLitres', width: 14, numFmt: MONEY },
        { header: 'Mileage (km/L)', key: 'mileageKmpl', width: 14, numFmt: MONEY },
        { header: 'Standard (km/L)', key: 'stdMileageKmpl', width: 14, numFmt: MONEY },
        { header: 'Cost (₹)', key: 'cost', width: 14, numFmt: MONEY },
      ],
      rows: report.reportB.map((row) => ({ ...row, category: FLEET_CATEGORY_LABELS[row.category], costBasis: COST_BASIS_LABELS[row.costBasis] })),
    },
    {
      name: 'C Held & flagged',
      columns: [
        { header: 'Date', key: 'dateKey', width: 12 },
        { header: 'Vehicle', key: 'vehicleNumber', width: 16 },
        { header: 'Driver', key: 'driverName', width: 22 },
        { header: 'Project', key: 'projectName', width: 28 },
        { header: 'Held', key: 'held', width: 8 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'GPS km', key: 'gpsKm', width: 10, numFmt: KM },
        { header: 'Odometer km', key: 'odoKm', width: 12, numFmt: KM },
        { header: 'Billable km', key: 'billableKm', width: 12, numFmt: KM },
        { header: 'Amount (₹)', key: 'amount', width: 12, numFmt: MONEY },
        { header: 'Flags', key: 'flags', width: 48 },
        { header: 'Trip id', key: 'tripId', width: 24 },
      ],
      rows: report.reportC.map((row) => ({ ...row, held: row.held ? 'Held' : 'Paid', status: FLEET_TRIP_STATUS_LABELS[row.status], flags: row.flags.map((flag) => TRIP_FLAG_LABELS[flag]).join(', ') })),
    },
    {
      name: 'D Reimbursements',
      columns: [
        { header: 'Driver', key: 'driverName', width: 26 },
        { header: 'Fuel entries', key: 'entries', width: 12 },
        { header: 'Litres', key: 'litres', width: 10, numFmt: MONEY },
        { header: 'Paid by driver (₹)', key: 'driverPaid', width: 18, numFmt: MONEY },
        { header: 'From cash advance (₹)', key: 'fromAdvance', width: 20, numFmt: MONEY },
        { header: 'Total (₹)', key: 'total', width: 14, numFmt: MONEY },
      ],
      rows: report.reportD.map((row) => ({ ...row })),
    },
  ];
}

export async function reportWorkbook(report: PaymentReport): Promise<Buffer> {
  return Buffer.from(await buildWorkbookBuffer(reportSheets(report)));
}

/* ── PDF ── */

const ascii = (value: unknown) =>
  String(value ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');

const money = (value: number) => `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kmText = (value: number | null) => (value === null ? '-' : value.toLocaleString('en-IN', { maximumFractionDigits: 1 }));

interface Column {
  header: string;
  width: number;
  align?: 'right';
  value: (row: never) => string;
}

class PdfWriter {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly width = 842;
  readonly height = 595;
  readonly margin = 36;
  footer: string;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, footer: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.footer = footer;
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
    this.page.drawText(ascii(this.footer), { x: this.margin, y: 18, size: 7, font: this.font, color: rgb(0.45, 0.45, 0.45) });
    this.page.drawText(`Page ${this.doc.getPageCount()}`, { x: this.width - this.margin - 40, y: 18, size: 7, font: this.font, color: rgb(0.45, 0.45, 0.45) });
  }

  ensure(space: number) {
    if (this.y - space < this.margin + 10) this.addPage();
  }

  text(value: string, size = 9, bold = false, gap = 4) {
    this.ensure(size + gap);
    this.page.drawText(ascii(value), { x: this.margin, y: this.y - size, size, font: bold ? this.bold : this.font, color: rgb(0.1, 0.1, 0.12) });
    this.y -= size + gap;
  }

  fit(value: string, width: number, size: number, font: PDFFont) {
    let out = ascii(value);
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > width - 4) out = out.slice(0, -2) + '.';
    return out;
  }

  table(columns: Column[], rows: unknown[], size = 7.5) {
    const rowHeight = size + 6;
    const header = () => {
      this.ensure(rowHeight * 2);
      let x = this.margin;
      this.page.drawRectangle({ x: this.margin, y: this.y - rowHeight, width: this.width - this.margin * 2, height: rowHeight, color: rgb(0.06, 0.62, 0.45) });
      for (const column of columns) {
        const label = this.fit(column.header, column.width, size, this.bold);
        const offset = column.align === 'right' ? column.width - 2 - this.bold.widthOfTextAtSize(label, size) : 2;
        this.page.drawText(label, { x: x + offset, y: this.y - rowHeight + 4, size, font: this.bold, color: rgb(1, 1, 1) });
        x += column.width;
      }
      this.y -= rowHeight;
    };
    header();
    rows.forEach((row, index) => {
      if (this.y - rowHeight < this.margin + 10) {
        this.addPage();
        header();
      }
      if (index % 2) this.page.drawRectangle({ x: this.margin, y: this.y - rowHeight, width: this.width - this.margin * 2, height: rowHeight, color: rgb(0.95, 0.96, 0.97) });
      let x = this.margin;
      for (const column of columns) {
        const label = this.fit(column.value(row as never), column.width, size, this.font);
        const offset = column.align === 'right' ? column.width - 2 - this.font.widthOfTextAtSize(label, size) : 2;
        this.page.drawText(label, { x: x + offset, y: this.y - rowHeight + 4, size, font: this.font, color: rgb(0.12, 0.12, 0.14) });
        x += column.width;
      }
      this.y -= rowHeight;
    });
    if (!rows.length) this.text('Nothing in this period.', 8);
    this.y -= 10;
  }
}

export async function reportPdf(report: PaymentReport, companyName: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(ascii(reportTitle(report)));
  doc.setProducer('SEL Live');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(doc, font, bold, `${companyName} - ${reportTitle(report)} - generated ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC`);

  writer.text(companyName, 9, true, 2);
  writer.text(reportTitle(report), 15, true, 6);
  writer.text(report.status === 'approved' ? `Approved for payment by ${report.approvedByName} on ${report.approvedAt?.slice(0, 10)}` : 'DRAFT - not approved for payment', 9, report.status !== 'approved', 10);
  const t = report.totals;
  writer.text(`Trips paid: ${t.trips}    Billable km: ${kmText(t.km)}    Payable: ${money(t.payable)}    Held trips: ${t.heldTrips}    Driver reimbursements: ${money(t.reimbursements)}`, 9, false, 14);

  writer.text('A. Project-wise running and cost', 11, true);
  writer.table(
    [
      { header: 'Code', width: 60, value: (row: PaymentReport['reportA'][number]) => row.projectCode },
      { header: 'Project', width: 230, value: (row: PaymentReport['reportA'][number]) => row.projectName },
      { header: 'Trips', width: 45, align: 'right', value: (row: PaymentReport['reportA'][number]) => String(row.trips) },
      { header: 'Km', width: 60, align: 'right', value: (row: PaymentReport['reportA'][number]) => kmText(row.km) },
      { header: 'Per-km', width: 85, align: 'right', value: (row: PaymentReport['reportA'][number]) => money(row.perKmCost) },
      { header: 'Fixed share', width: 85, align: 'right', value: (row: PaymentReport['reportA'][number]) => money(row.fixedShare) },
      { header: 'Fuel share', width: 85, align: 'right', value: (row: PaymentReport['reportA'][number]) => money(row.fuelShare) },
      { header: 'Total', width: 90, align: 'right', value: (row: PaymentReport['reportA'][number]) => money(row.total) },
    ] as Column[],
    report.reportA,
  );

  writer.text('B. Vehicle-wise running, cost and fuel', 11, true);
  writer.table(
    [
      { header: 'Vehicle', width: 80, value: (row: PaymentReport['reportB'][number]) => row.vehicleNumber },
      { header: 'Basis', width: 95, value: (row: PaymentReport['reportB'][number]) => COST_BASIS_LABELS[row.costBasis] },
      { header: 'Trips', width: 40, align: 'right', value: (row: PaymentReport['reportB'][number]) => String(row.trips) },
      { header: 'Km', width: 55, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.km) },
      { header: 'Fuel L', width: 55, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.fuelLitres) },
      { header: 'Fuel Rs.', width: 75, align: 'right', value: (row: PaymentReport['reportB'][number]) => money(row.fuelAmount) },
      { header: 'Expected L', width: 60, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.expectedLitres) },
      { header: 'Var. L', width: 55, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.varianceLitres) },
      { header: 'km/L', width: 50, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.mileageKmpl) },
      { header: 'Std', width: 40, align: 'right', value: (row: PaymentReport['reportB'][number]) => kmText(row.stdMileageKmpl) },
      { header: 'Cost', width: 95, align: 'right', value: (row: PaymentReport['reportB'][number]) => money(row.cost) },
    ] as Column[],
    report.reportB,
  );

  writer.text('C. Held and flagged trips', 11, true);
  writer.table(
    [
      { header: 'Date', width: 55, value: (row: PaymentReport['reportC'][number]) => row.dateKey },
      { header: 'Vehicle', width: 75, value: (row: PaymentReport['reportC'][number]) => row.vehicleNumber },
      { header: 'Driver', width: 95, value: (row: PaymentReport['reportC'][number]) => row.driverName },
      { header: 'Project', width: 110, value: (row: PaymentReport['reportC'][number]) => row.projectName },
      { header: 'Held', width: 35, value: (row: PaymentReport['reportC'][number]) => (row.held ? 'Held' : 'Paid') },
      { header: 'GPS', width: 40, align: 'right', value: (row: PaymentReport['reportC'][number]) => kmText(row.gpsKm) },
      { header: 'Odo', width: 40, align: 'right', value: (row: PaymentReport['reportC'][number]) => kmText(row.odoKm) },
      { header: 'Billed', width: 40, align: 'right', value: (row: PaymentReport['reportC'][number]) => kmText(row.billableKm) },
      { header: 'Flags', width: 280, value: (row: PaymentReport['reportC'][number]) => row.flags.map((flag) => TRIP_FLAG_LABELS[flag]).join(', ') },
    ] as Column[],
    report.reportC,
  );

  writer.text('D. Driver reimbursements (fuel paid by drivers or from cash advances)', 11, true);
  writer.table(
    [
      { header: 'Driver', width: 250, value: (row: PaymentReport['reportD'][number]) => row.driverName },
      { header: 'Entries', width: 60, align: 'right', value: (row: PaymentReport['reportD'][number]) => String(row.entries) },
      { header: 'Litres', width: 70, align: 'right', value: (row: PaymentReport['reportD'][number]) => kmText(row.litres) },
      { header: 'Driver paid', width: 120, align: 'right', value: (row: PaymentReport['reportD'][number]) => money(row.driverPaid) },
      { header: 'Cash advance', width: 120, align: 'right', value: (row: PaymentReport['reportD'][number]) => money(row.fromAdvance) },
      { header: 'Total', width: 120, align: 'right', value: (row: PaymentReport['reportD'][number]) => money(row.total) },
    ] as Column[],
    report.reportD,
  );

  writer.y -= 10;
  writer.text('Checked by: ______________________        Approved for payment by: ______________________        Date: ____________', 9, false, 4);
  return Buffer.from(await doc.save());
}
