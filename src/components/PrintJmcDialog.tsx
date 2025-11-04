
'use client';

import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { JmcEntry, JmcItem, Project, Signature } from '@/lib/types';
import { format } from 'date-fns';
import { Printer, Maximize, Minimize } from 'lucide-react';
import Image from 'next/image';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { cn } from '@/lib/utils';

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
type ProjectWithExtras = Project & {
  refRoNo?: string;
  nameOfSs?: string;
  nameOfWork?: string;
  subWork?: string;
  woNo?: string;
  projectName?: string; // sometimes used instead of nameOfWork
  'Order No'?: string;
  'BID DOCUMENT No'?: string;
  projectDivision?: string;
  projectSite?: string;
  siteInCharge?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

interface PrintJmcDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  project?: ProjectWithExtras | null;
  enrichedItems: EnrichedJmcItem[];
}

const PrintableJmcStyles = ({ orientation }: { orientation: 'portrait' | 'landscape' }) => (
    <style>{`
      @media print {
        @page {
          size: A4 ${orientation};
          margin: 10mm;
        }
        body {
          -webkit-print-color-adjust: exact;
          color-adjust: exact;
          margin: 0;
        }
        .printable-area {
          display: block !important;
        }
        .no-print { display: none !important; }
        #printable-jmc-content {
          color: #000;
          font-size: 9pt;
        }
        table {
          width: 100%; border-collapse: collapse; border: 1px solid #000;
        }
        th, td {
          border: 1px solid #000; padding: 2px 4px;
          vertical-align: top;
        }
        th { font-weight: bold; text-align: center; }
        tr { page-break-inside: avoid; }
        .print-header-cell { padding: 1px 4px !important; }
      }
    `}</style>
);

export default function PrintJmcDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  project,
  enrichedItems,
}: PrintJmcDialogProps) {
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [dialogSize, setDialogSize] = React.useState<'xl' | '2xl' | 'full'>('2xl');
  const componentRef = React.useRef<HTMLDivElement>(null);
  
  const handlePrint = () => {
    window.print();
  };
  
  const toggleDialogSize = () => {
    setDialogSize(current => {
      if (current === 'xl') return '2xl';
      if (current === '2xl') return 'full';
      return 'xl';
    });
  };

  const dialogWidthClass =
    dialogSize === 'full'
      ? 'sm:max-w-[95vw]'
      : dialogSize === '2xl'
      ? 'sm:max-w-[80rem]'
      : 'sm:max-w-4xl';

  if (!jmcEntry) return null;

  const calculateUpToDateQty = (item: EnrichedJmcItem) => {
    const prev = Number(item.previousCertifiedQty) || 0;
    const current = Number(item.executedQty) || 0;
    return prev + current;
  };

  const scope1 = (jmcEntry.items && jmcEntry.items.length > 0)
    ? (jmcEntry.items[0] as any)['Scope 1'] || ''
    : '';
    
  const title = `JOINT MEASUREMENT CERTIFICATE FOR ${scope1}`.toUpperCase();

  const workDetails = {
    orderNo: project?.woNo || 'N/A',
    bidNo: project?.['BID DOCUMENT No'] || 'N/A',
    projectName: project?.projectDescription || project?.projectName || 'N/A',
    projectSite: project?.projectSite || 'N/A',
    jmcDate: formatDateSafe((jmcEntry as any).jmcDate),
    jmcNo: jmcEntry.jmcNo,
  };
  
  const getDisplayValue = (value: number | undefined) => value || '';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] flex flex-col min-h-0", dialogWidthClass)}>
        <DialogHeader className="no-print">
          <DialogTitle>Print JMC: {jmcEntry.jmcNo}</DialogTitle>
        </DialogHeader>

        <div id="printable-jmc-wrapper" className="flex-1 min-h-0 overflow-auto">
          <PrintableJmcStyles orientation={orientation} />
          <div id="printable-jmc-content" ref={componentRef}>
            {/* Header */}
            <div className="flex justify-between items-start mb-2">
              <div className="w-1/4">
                 <Image src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fsel_logo.png?alt=media&token=1612743a-1423-441f-bd8a-73330687114b" alt="SEL Logo" width={80} height={40} />
              </div>
              <div className="w-1/2 text-center">
                <p className="text-lg font-extrabold">SIDDHARTHA ENGINEERING LIMITED</p>
                <p className="text-[7pt] font-semibold">ELECTRICAL ENGINEERS, CONTRACTORS (EHV) & CONSULTANTS</p>
                <p className="text-[7pt]">PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)</p>
                <p className="text-[7pt]">Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915</p>
                <p className="text-[7pt]">E-mail: sel.techhead@gmail.com</p>
              </div>
              <div className="w-1/4 text-right">
                  <Image src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Fjas-anz_logo.png?alt=media&token=904e5399-528b-49c7-8763-718335017056" alt="JAS-ANZ Logo" width={80} height={50} className="ml-auto"/>
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
                  <span><strong>JMC No.:</strong> {workDetails.jmcNo}</span>
                  <span><strong>DATE:</strong> {workDetails.jmcDate}</span>
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
                    <TableHead rowSpan={2} className="w-[4%] print-header-cell border-black text-center align-middle">SL. NO.</TableHead>
                    <TableHead rowSpan={2} className="w-[34%] print-header-cell border-black text-center align-middle">Description of Items</TableHead>
                    <TableHead rowSpan={2} className="w-[6%] print-header-cell border-black text-center align-middle">Unit</TableHead>
                    <TableHead rowSpan={2} className="w-[8%] print-header-cell border-black text-center align-middle">BOQ Qty</TableHead>
                    <TableHead colSpan={3} className="print-header-cell border-black text-center font-bold">QNTY EXECUTED</TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="w-[8%] print-header-cell border-black text-center">Up to Previous</TableHead>
                    <TableHead className="w-[8%] print-header-cell border-black text-center">In this JMC</TableHead>
                    <TableHead className="w-[8%] print-header-cell border-black text-center">Up to date</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {enrichedItems.map((item, index) => {
                      const upToDateQty = calculateUpToDateQty(item);
                      return (
                          <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                              <TableCell className="text-center border-black print-header-cell">{item.boqSlNo ?? '-'}</TableCell>
                              <TableCell className="border-black print-header-cell">
                                  <div className="line-clamp-4 break-words whitespace-pre-line">
                                      {item.description ?? '-'}
                                  </div>
                              </TableCell>
                              <TableCell className="text-center border-black print-header-cell">{item.unit ?? '-'}</TableCell>
                              <TableCell className="text-right border-black print-header-cell">{getDisplayValue(item.boqQty)}</TableCell>
                              <TableCell className="text-right border-black print-header-cell">{getDisplayValue(item.previousCertifiedQty)}</TableCell>
                              <TableCell className="text-right border-black print-header-cell">{getDisplayValue(item.executedQty)}</TableCell>
                              <TableCell className="text-right border-black print-header-cell">{getDisplayValue(upToDateQty)}</TableCell>
                          </TableRow>
                      );
                  })}
                </TableBody>
              </Table>
            </div>
             {/* Signatures */}
             <div className="flex justify-between mt-16 text-[9pt] px-4">
                  {(project?.signatures || []).map((sig, index) => (
                      <div key={`${sig.designation}-${index}`} className="w-1/3 text-center">
                          <p className="border-t border-black pt-1 mt-8">{sig.designation}</p>
                          <p className="font-bold">{sig.name}</p>
                      </div>
                  ))}
            </div>
          </div>
        </div>

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
