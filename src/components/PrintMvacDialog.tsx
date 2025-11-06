
'use client';

import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MvacEntry, MvacItem, Project, Signature } from '@/lib/types';
import { format } from 'date-fns';
import { Printer, Maximize, Minimize, FileDown } from 'lucide-react';
import Image from 'next/image';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';


/* ---------- Helpers ---------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

const formatDateSafe = (dateInput: any) => {
  const d = toDateSafe(dateInput);
  if (!d) return 'N/A';
  try {
    return format(d, 'dd.MM.yyyy');
  } catch {
    return 'Invalid Date';
  }
};

/** Must match the enriched shape you pass from ViewMvacEntryDialog */
type EnrichedMvacItem = MvacItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

type ProjectWithExtras = Project & {
  woNo?: string;
  projectName?: string;
  'BID DOCUMENT No'?: string;
  projectSite?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

interface PrintMvacDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mvacEntry: MvacEntry | null;
  project?: ProjectWithExtras | null;
  enrichedItems: EnrichedMvacItem[];
}

/* ---------- Auto-Fit Print Styles ---------- */
const PrintableMvacStyles = ({ orientation }: { orientation: 'portrait' | 'landscape' }) => (
  <style>{`
    @media print {
      @page {
        size: A4 ${orientation};
        margin: 0; /* remove browser margins completely */
      }

      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
        background: #fff !important;
        width: 100%;
        height: 100%;
      }

      /* Center printable area and auto-scale to fit */
      #printable-mvac-sheet {
        transform-origin: top left;
        background: #fff;
        margin: auto;
        padding: 10mm;                    /* 1 cm visual padding inside */
        width: 210mm;
        height: 297mm;
        overflow: hidden;
        box-sizing: border-box;
      }
      #printable-mvac-sheet.print-landscape {
        width: 297mm;
        height: 210mm;
      }

      /* Auto-fit scaling */
      body {
        zoom: 0.95;                        /* fine-tuned for Chrome/PDF printers */
      }

      table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #000;
      }
      th, td {
        border: 1px solid #000;
        padding: 2px 4px;
        vertical-align: top;
        font-size: 9pt;
      }
      th {
        font-weight: bold;
        text-align: center;
      }

      /* Limit “Description of Items” to 4 lines */
      .desc-cell {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
      }

      .no-print { display: none !important; }
      .signatures { page-break-inside: avoid; }

      /* Print only the sheet */
      body * { visibility: hidden; }
      #printable-mvac-sheet, #printable-mvac-sheet * { visibility: visible; }
    }
  `}</style>
);

export default function PrintmvacDialog({
  isOpen,
  onOpenChange,
  mvacEntry,
  project,
  enrichedItems,
}: PrintMvacDialogProps) {
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [dialogSize, setDialogSize] = React.useState<'xl' | '2xl' | 'full'>('2xl');

  const handlePrint = () => window.print();
  const toggleDialogSize = () =>
    setDialogSize(c => (c === 'xl' ? '2xl' : c === '2xl' ? 'full' : 'xl'));

  if (!mvacEntry) return null;

  const calculateUpToDateQty = (item: EnrichedMvacItem) =>
    (Number(item.previousCertifiedQty) || 0) + (Number(item.executedQty) || 0);

  const title = `MATERIAL VERIFICATION AND ACCEPTANCE CERTIFICATE`.toUpperCase();

  const workDetails = {
    orderNo: project?.woNo || 'N/A',
    bidNo: project?.['BID DOCUMENT No'] || 'N/A',
    projectName: project?.projectDescription || project?.projectName || 'N/A',
    projectSite: project?.projectSite || 'N/A',
    mvacDate: formatDateSafe((mvacEntry as any).mvacDate),
    mvacNo: mvacEntry.mvacNo,
  };
  const getDisplayValue = (v: number | undefined) => (v === 0 ? 0 : v ?? '');

  const handleExport = () => {
    const header = [
        ['', 'SIDDHARTHA ENGINEERING LIMITED', ''],
        ['', 'ELECTRICAL ENGINEERS, CONTRACTORS (EHV) & CONSULTANTS', ''],
        ['', 'PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)', ''],
        ['', 'Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915', ''],
        ['', 'E-mail: sel.techhead@gmail.com', ''],
    ];
    
    const titleRow = [title];
    const detailsRows = [
        [`MVAC No.: ${workDetails.mvacNo}`, `DATE: ${workDetails.mvacDate}`],
        [`Order No. ${workDetails.orderNo}`],
        [`Name of the project:- ${workDetails.projectName}`],
        [`Project Site : ${workDetails.projectSite}`],
    ];

    const tableHeader = [
        'SL. NO.', 
        'Description of Items', 
        'Unit', 
        'BOQ Qty',
        'Up to Previous',
        'In this MVAC',
        'Up to date'
    ];
    
    const tableData = enrichedItems.map(item => [
        item.boqSlNo ?? '-',
        item.description ?? '-',
        item.unit ?? '-',
        getDisplayValue(item.boqQty),
        getDisplayValue(item.previousCertifiedQty),
        getDisplayValue(item.executedQty),
        getDisplayValue(calculateUpToDateQty(item)),
    ]);

    const signatureRow = (project?.signatures || []).map(sig => `${sig.designation}\n${sig.name}`);

    const ws_data = [
        ...header,
        [], // Empty row
        titleRow,
        [],
        ...detailsRows,
        [],
        tableHeader,
        ...tableData,
        [], [], [], // spacing for signatures
        signatureRow
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    // Merging cells for headers
    ws['!merges'] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
      { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } },
      { s: { r: 2, c: 1 }, e: { r: 2, c: 2 } },
      { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } },
      { s: { r: 4, c: 1 }, e: { r: 4, c: 2 } },
      { s: { r: 6, c: 0 }, e: { r: 6, c: 6 } }, // Title
      { s: { r: 8, c: 0 }, e: { r: 8, c: 3 } }, // MVAC No & Date
      { s: { r: 9, c: 0 }, e: { r: 9, c: 6 } }, // Order No
      { s: { r: 10, c: 0 }, e: { r: 10, c: 6 } }, // Project Name
      { s: { r: 11, c: 0 }, e: { r: 11, c: 6 } }, // Project Site
    ];
    
    // Add password protection
    ws['!protect'] = {
        password: 'Sel@123',
        formatColumns: true,
        formatRows: true,
    };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MVAC Report');
    XLSX.writeFile(wb, `MVAC_${workDetails.mvacNo}.xlsx`);
  };

  const dialogWidthClass =
    dialogSize === 'full'
      ? 'sm:max-w-[95vw]'
      : dialogSize === '2xl'
      ? 'sm:max-w-[80rem]'
      : 'sm:max-w-4xl';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[90vh] flex flex-col min-h-0', dialogWidthClass)}>
        <DialogHeader className="no-print">
          <DialogTitle>Print MVAC: {mvacEntry.mvacNo}</DialogTitle>
        </DialogHeader>

        <PrintableMvacStyles orientation={orientation} />

        <div
          id="printable-mvac-sheet"
          className={cn(
            'flex-1 min-h-0 overflow-auto mx-auto',
            orientation === 'landscape' ? 'print-landscape' : 'print-portrait'
          )}
        >
          <div id="printable-mvac-content" className="px-4 py-2">
            {/* Header */}
            <div className="flex justify-between items-start mb-2">
              <div className="w-1/4">
                <Image
                  src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fsel_logo.png?alt=media&token=1612743a-1423-441f-bd8a-73330687114b"
                  alt="SEL Logo"
                  width={80}
                  height={40}
                />
              </div>
              <div className="w-1/2 text-center">
                <p className="text-lg font-extrabold">SIDDHARTHA ENGINEERING LIMITED</p>
                <p className="text-[7pt] font-semibold">ELECTRICAL ENGINEERS, CONTRACTORS (EHV) & CONSULTANTS</p>
                <p className="text-[7pt]">PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)</p>
                <p className="text-[7pt]">Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915</p>
                <p className="text-[7pt]">E-mail: sel.techhead@gmail.com</p>
              </div>
              <div className="w-1/4 text-right">
                <Image
                  src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fjas-anz_logo.png?alt=media&token=904e5399-528b-49c7-8763-718335017056"
                  alt="JAS-ANZ Logo"
                  width={80}
                  height={50}
                  className="ml-auto"
                />
                <p className="text-[6pt]">ISO 9001:2008 Registered Company</p>
                <p className="text-[6pt]">Certificate No: BCI/Q/J/2330</p>
              </div>
            </div>

            <p className="text-center font-bold text-sm border-y-2 border-black py-1 my-2">
              {title}
            </p>

            {/* Work details */}
            <div className="text-[9pt] space-y-1 mb-2">
              <div className="flex justify-between">
                <span><strong>MVAC No.:</strong> {workDetails.mvacNo}</span>
                <span><strong>DATE:</strong> {workDetails.mvacDate}</span>
              </div>
              <p><strong>Order No.</strong> {workDetails.orderNo}</p>
              <p><strong>Name of the project:-</strong> {workDetails.projectName}</p>
              <p><strong>Project Site :</strong> {workDetails.projectSite}</p>
            </div>

            {/* Table */}
            <div className="overflow-x-auto border border-black">
              <Table className="w-full table-auto text-[8pt]">
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="w-[4%] border-black text-center align-middle">SL. NO.</TableHead>
                    <TableHead rowSpan={2} className="w-[28%] border-black text-center align-middle">Description of Items</TableHead>
                    <TableHead rowSpan={2} className="w-[6%] border-black text-center align-middle">Unit</TableHead>
                    <TableHead rowSpan={2} className="w-[8%] border-black text-center align-middle">BOQ Qty</TableHead>
                    <TableHead colSpan={3} className="border-black text-center font-bold">QNTY EXECUTED</TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="w-[8%] border-black text-center">Up to Previous</TableHead>
                    <TableHead className="w-[8%] border-black text-center">In this MVAC</TableHead>
                    <TableHead className="w-[8%] border-black text-center">Up to date</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {enrichedItems.map((item, index) => {
                    const upToDateQty = calculateUpToDateQty(item);
                    return (
                      <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                        <TableCell className="text-center border-black">{item.boqSlNo ?? '-'}</TableCell>
                        <TableCell className="border-black">
                          <div className="desc-cell">{item.description ?? '-'}</div>
                        </TableCell>
                        <TableCell className="text-center border-black">{item.unit ?? '-'}</TableCell>
                        <TableCell className="text-right border-black">{getDisplayValue(item.boqQty)}</TableCell>
                        <TableCell className="text-right border-black">{getDisplayValue(item.previousCertifiedQty)}</TableCell>
                        <TableCell className="text-right border-black">{getDisplayValue(item.executedQty)}</TableCell>
                        <TableCell className="text-right border-black">{getDisplayValue(upToDateQty)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Signatures */}
            <div className="signatures flex justify-between mt-16 text-[9pt] px-4">
              {(project?.signatures || []).map((sig, index) => (
                <div key={`${sig.designation}-${index}`} className="w-1/3 text-center">
                  <p className="border-t border-black pt-1 mt-8">{sig.designation}</p>
                  <p className="font-bold">{sig.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Controls */}
        <DialogFooter className="mt-4 pr-4 no-print flex justify-between w-full">
          <div className="flex items-center space-x-2">
            <Switch
              id="orientation-switch"
              checked={orientation === 'landscape'}
              onCheckedChange={(checked) => setOrientation(checked ? 'landscape' : 'portrait')}
            />
            <Label htmlFor="orientation-switch">Landscape Mode</Label>
            <Button variant="outline" size="icon" onClick={toggleDialogSize} className="ml-4">
              {dialogSize === 'full' ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          </div>
          <div>
            <Button variant="secondary" onClick={handleExport} className="ml-2">
                <FileDown className="mr-2 h-4 w-4" /> Export to Excel
            </Button>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button onClick={handlePrint} className="ml-2">
              <Printer className="mr-2 h-4 w-4" /> Print Document
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
