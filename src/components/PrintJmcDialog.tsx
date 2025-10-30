'use client';

import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { JmcEntry, JmcItem, Project } from '@/lib/types';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useRef } from 'react';

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

/** Must match the enriched shape you pass from ViewJmcEntryDialog */
type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

/** Optional extra fields present in Firestore but not on the core Project type */
type ProjectExtras = {
  refRoNo?: string;
  nameOfSs?: string;
  nameOfWork?: string;
  subWork?: string;
  woNo?: string;
  projectName?: string; // sometimes used instead of nameOfWork
};

interface PrintJmcDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  project?: (Project & ProjectExtras) | null; // <-- allow extra optional fields
  enrichedItems: EnrichedJmcItem[];
}

function PrintableJmcStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden; }
        #printable-jmc-content, #printable-jmc-content * {
          visibility: visible;
          font-family: Arial, sans-serif;
          margin: 0; padding: 0; box-sizing: border-box;
        }
        #printable-jmc-content {
          position: absolute; left: 0; top: 0;
          width: 100%; height: auto; min-height: 297mm;
          padding: 15mm; font-size: 8pt; color: #000;
        }
        table {
          width: 100%; border-collapse: collapse; border: 1px solid #000;
          -webkit-print-color-adjust: exact; color-adjust: exact;
        }
        th, td {
          border: 1px solid #000; padding: 3px 6px; word-wrap: break-word;
          vertical-align: top; height: 100%;
        }
        th { background-color: #f4f4f4; font-weight: bold; text-transform: uppercase; text-align: center; }
        .print-header-cell { padding: 1px 4px !important; }
        tr { page-break-inside: avoid; }
        [role="dialog"] header, [role="dialog"] footer { display: none; }
      }
    `}</style>
  );
}

const COMPANY_NAME_1 = 'M/s Siddharth Engineering Limited';
const COMPANY_NAME_2 = 'TP Southern Odisha Distribution Limited';
const COMPANY_SLOGAN_1 = 'T P S O D L / O D S S P / P H A S E - I V / P k g - 2 B';
const COMPANY_SLOGAN_2 = 'A Tata Power and Odisha Government Joint Venture';

export default function PrintJmcDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  project,
  enrichedItems,
}: PrintJmcDialogProps) {
  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `JMC-${jmcEntry?.jmcNo || 'document'}`,
  });

  if (!jmcEntry) return null;

  const calculateUpToDateQty = (item: EnrichedJmcItem) => {
    const prev = Number(item.previousCertifiedQty) || 0;
    const current = Number(item.certifiedQty) || 0;
    return prev + current;
  };

  // Safely read optional fields; fall back where useful
  const workDetails = {
    refNo: project?.refRoNo ?? 'N/A',
    date:
      project?.woNo && project.woNo.includes(' Dt: ')
        ? formatDateSafe(project.woNo.split(' Dt: ')[1])
        : 'N/A',
    ssName: project?.nameOfSs ?? 'N/A',
    mainWork: project?.nameOfWork ?? project?.projectName ?? 'N/A',
    subWork: project?.subWork ?? 'N/A',
    jmcDate: formatDateSafe((jmcEntry as any).jmcDate),
    jmcNo: jmcEntry.jmcNo,
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <PrintableJmcStyles />
      <DialogContent className="sm:max-w-[90rem] mx-auto">
        <DialogHeader>
          <DialogTitle>Print JMC: {jmcEntry.jmcNo}</DialogTitle>
        </DialogHeader>

        <div id="printable-jmc-content" className="max-h-[85vh] overflow-y-auto" ref={componentRef}>
          {/* Header */}
          <div className="flex justify-between border-b-2 border-black pb-1 mb-4">
            <div className="w-1/3 text-left">
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

          {/* Work details */}
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

          {/* Table */}
          <div className="overflow-x-auto border border-black">
            <Table className="w-full table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="w-[4%] print-header-cell border-black text-center">Sl. No.</TableHead>
                  <TableHead rowSpan={2} className="w-[5%] print-header-cell border-black text-center">RO No.</TableHead>
                  <TableHead rowSpan={2} className="w-[42%] print-header-cell border-black text-center">L.O.A DESCRIPTION</TableHead>
                  <TableHead rowSpan={2} className="w-[6%] print-header-cell border-black text-center">U.O.M</TableHead>
                  <TableHead colSpan={2} className="w-[18%] print-header-cell border-black text-center font-bold text-base">QUANTITY</TableHead>
                  <TableHead colSpan={3} className="w-[25%] print-header-cell border-black text-center font-bold text-base">JMC QUANTITY</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">AS PER BOQ</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">AS PER DRG</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">PREVIOUS</TableHead>
                  <TableHead className="w-[9%] print-header-cell border-black text-center">SINCE PREVIOUS</TableHead>
                  <TableHead className="w-[7%] print-header-cell border-black text-center">UP TO DATE</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {enrichedItems.map((item, index) => (
                  <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                    <TableCell className="text-center font-medium border-black print-header-cell">{index + 1}</TableCell>
                    <TableCell className="text-center border-black print-header-cell">{item.boqSlNo ?? '-'}</TableCell>
                    <TableCell className="border-black print-header-cell">{item.description ?? '-'}</TableCell>
                    <TableCell className="text-center border-black print-header-cell">{item.unit ?? '-'}</TableCell>
                    <TableCell className="text-right border-black print-header-cell">{Number(item.boqQty) || 0}</TableCell>
                    <TableCell className="text-right border-black print-header-cell">-</TableCell>
                    <TableCell className="text-right border-black print-header-cell">{Number(item.previousCertifiedQty) || 0}</TableCell>
                    <TableCell className="text-right border-black print-header-cell">{Number(item.certifiedQty) || 0}</TableCell>
                    <TableCell className="text-right border-black print-header-cell font-bold">
                      {calculateUpToDateQty(item)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Signatures */}
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
