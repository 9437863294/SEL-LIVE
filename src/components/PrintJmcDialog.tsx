'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'; 
import type { JmcEntry, JmcItem } from '@/lib/types';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';

/* ---------- Necessary Helpers ---------- */
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
    return format(d, 'dd.MM.yyyy'); // Match date format from image
  } catch {
    return 'Invalid Date';
  }
};

/**
 * This is the type for the enriched items calculated in the
 * ViewJmcEntryDialog component. We pass this data directly.
 */
type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

interface PrintJmcDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  enrichedItems: EnrichedJmcItem[];
}

/**
 * A component that only renders the print-specific CSS rules.
 * CRITICAL: The styles target #printable-jmc-content
 */
function PrintableJmcStyles() {
  return (
    <style>
      {`
        @media print {
          /* Hide everything in the body by default */
          body * {
            visibility: hidden;
          }
          
          /* Show only the printable content and its children */
          #printable-jmc-content, #printable-jmc-content * {
            visibility: visible;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          /* Make the printable content fill the page (A4-like) */
          #printable-jmc-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: auto;
            min-height: 297mm; /* A4 height */
            padding: 15mm;
            font-size: 8pt; 
            color: #000;
          }
          
          /* Print-specific table styling (force borders) */
          table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #000;
            -webkit-print-color-adjust: exact; 
            color-adjust: exact;
          }
          
          th, td {
            border: 1px solid #000;
            padding: 3px 6px; /* Reduced padding for more content space */
            word-wrap: break-word;
            vertical-align: top;
            height: 100%;
          }
          
          th {
            background-color: #f4f4f4;
            font-weight: bold;
            text-transform: uppercase;
            text-align: center;
          }
          
          .print-header-cell {
              padding: 1px 4px !important;
          }

          /* Prevent table rows from breaking across pages */
          tr {
            page-break-inside: avoid;
          }
          
          /* Hide the dialog header/footer when printing */
          [role="dialog"] header, [role="dialog"] footer {
            display: none;
          }
        }
      `}
    </style>
  );
}

// Mock/Default Header Information (Ideally provided via props, but using mock/jmcEntry for structure)
const COMPANY_NAME_1 = 'M/s Siddharth Engineering Limited';
const COMPANY_NAME_2 = 'TP Southern Odisha Distribution Limited';
const COMPANY_SLOGAN_1 = 'T P S O D L / O D S S P / P H A S E - I V / P k g - 2 B';
const COMPANY_SLOGAN_2 = 'A Tata Power and Odisha Government Joint Venture';

export default function PrintJmcDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  enrichedItems,
}: PrintJmcDialogProps) {
  if (!jmcEntry) return null;

  const handlePrint = () => {
    window.print();
  };

  const calculateUpToDateQty = (item: EnrichedJmcItem) => {
    const prev = Number(item.previousCertifiedQty) || 0;
    const current = Number(item.certifiedQty) || 0;
    return prev + current;
  };

  const workDetails = {
    refNo: '5000017384',
    date: formatDateSafe('2023-05-17'),
    ssName: 'Chandili',
    mainWork: 'Engineering, Supply, Erection & Commissioning of 33/11KV Primary Substations with associated 33KV & 11KV Lines under Phase-IV of ODSSP on Turnkey Contract Basis at TPSODL',
    subWork: 'Line Stringing',
    jmcDate: formatDateSafe((jmcEntry as any).jmcDate),
    jmcNo: jmcEntry.jmcNo,
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <PrintableJmcStyles />

      {/* Set a wide layout for better visual preview of the print content */}
      <DialogContent className="sm:max-w-[90rem] mx-auto"> 
        <DialogHeader>
          <DialogTitle>Print JMC: {jmcEntry.jmcNo}</DialogTitle>
        </DialogHeader>

        {/* PRINTABLE CONTENT AREA */}
        <div id="printable-jmc-content" className="max-h-[85vh] overflow-y-auto">
          
          {/* Top Header Section */}
          <div className="flex justify-between border-b-2 border-black pb-1 mb-4">
            <div className="w-1/3 text-left">
              {/* Using text blocks for logos/company names as images are not allowed in LaTeX/Canvas */}
              <div className="text-2xl font-black text-red-700">SEL</div>
            </div>
            <div className="w-1/3 text-center">
              <p className="text-[10pt] font-extrabold">{COMPANY_NAME_1}</p>
              <p className="text-[8pt] font-medium text-gray-700">{COMPANY_SLOGAN_1}</p>
              <p className="text-base font-extrabold border-y border-black mt-1 py-1">JOINT MEASUREMENT CERTIFICATE</p>
            </div>
            <div className="w-1/3 text-right">
              <p className="text-[10pt] font-extrabold">TPSODL</p>
              <p className="text-[8pt] font-medium text-gray-700">{COMPANY_NAME_2}</p>
              <p className="text-[7pt] text-gray-700">{COMPANY_SLOGAN_2}</p>
            </div>
          </div>
          
          {/* Work Details Header */}
          <div className="space-y-1 mb-4 text-[9pt]">
            <p><strong>Name of Work:</strong> {workDetails.mainWork}</p>
            <p><strong>Ref. RO No:</strong> {workDetails.refNo}, <strong>Dt:</strong>{workDetails.date}</p>
            <div className="flex justify-between">
                <p><strong>Name of S/S:</strong> {workDetails.ssName}</p>
                <p className="font-bold">JMC No: <span className="font-normal border-b border-black">{workDetails.jmcNo}</span></p>
            </div>
            <div className="flex justify-between">
                <p><strong>Name of Work:</strong> {workDetails.subWork}</p>
                <p className="font-bold">DATE: <span className="font-normal border-b border-black">{workDetails.jmcDate}</span></p>
            </div>
          </div>

          {/* Main Content Table */}
          <div className="overflow-x-auto border border-black">
            <Table className="w-full table-auto">
              {/* Complex Table Header (3 Rows) */}
              <TableHeader>
                {/* Row 1: QUANTITY and JMC QUANTITY spanning columns */}
                <TableRow>
                  <TableHead rowSpan={2} className="w-[4%] print-header-cell border-black text-center">Sl. No.</TableHead>
                  <TableHead rowSpan={2} className="w-[5%] print-header-cell border-black text-center">RO No.</TableHead>
                  <TableHead rowSpan={2} className="w-[42%] print-header-cell border-black text-center">L.O.A DESCRIPTION</TableHead>
                  <TableHead rowSpan={2} className="w-[6%] print-header-cell border-black text-center">U.O.M</TableHead>
                  
                  <TableHead colSpan={2} className="w-[18%] print-header-cell border-black text-center font-bold text-base">QUANTITY</TableHead>
                  <TableHead colSpan={3} className="w-[25%] print-header-cell border-black text-center font-bold text-base">JMC QUANTITY</TableHead>
                </TableRow>
                
                {/* Row 2: Sub-headers */}
                <TableRow>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">AS PER BOQ</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">AS PER DRG</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">PREVIOUS</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">SINCE PREVIOUS</TableHead>
                  <TableHead className="w-[7%] print-header-cell border-black text-center">UP TO DATE</TableHead>
                </TableRow>
              </TableHeader>

              {/* Table Body (Data) */}
              <TableBody>
                {enrichedItems.map((item, index) => (
                  <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                    <TableCell className="text-center font-medium border-black print-header-cell">
                      {index + 1}
                    </TableCell>
                    <TableCell className="text-center border-black print-header-cell">
                      {item.boqSlNo ?? '-'}
                    </TableCell>
                    <TableCell className="border-black print-header-cell">
                      {item.description ?? '-'}
                      {/* Assuming detailed description is handled here; 
                        You might need to add logic for category headers if applicable in your data. */}
                    </TableCell>
                    <TableCell className="text-center border-black print-header-cell">
                      {item.unit ?? '-'}
                    </TableCell>

                    {/* QUANTITY */}
                    <TableCell className="text-right border-black print-header-cell">
                      {/* BOQ Qty */}
                      {Number(item.boqQty) || 0}
                    </TableCell>
                    <TableCell className="text-right border-black print-header-cell">
                      {/* AS PER DRG - Assuming this is empty or 0 if not specified */}
                      -
                    </TableCell>

                    {/* JMC QUANTITY */}
                    <TableCell className="text-right border-black print-header-cell">
                      {/* PREVIOUS */}
                      {Number(item.previousCertifiedQty) || 0}
                    </TableCell>
                    <TableCell className="text-right border-black print-header-cell">
                      {/* SINCE PREVIOUS (Certified Qty for this JMC) */}
                      {Number(item.certifiedQty) || 0}
                    </TableCell>
                    <TableCell className="text-right border-black print-header-cell font-bold">
                      {/* UP TO DATE (Previous + Since Previous) */}
                      {calculateUpToDateQty(item)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {/* Signature Footer Section */}
          <div className="flex justify-between mt-12 text-[9pt]">
            <div className="w-[30%] text-center">
                <p className="border-t border-black pt-1">Signature of EPC</p>
            </div>
            <div className="w-[30%] text-center">
                <p className="border-t border-black pt-1">Signature of Field Engg, TPSODL</p>
            </div>
            <div className="w-[30%] text-center">
                <p className="border-t border-black pt-1">Signature of Field Engg, WAPCOS</p>
            </div>
          </div>
          
        </div>

        {/* Dialog Footer (for screen only) */}
        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
