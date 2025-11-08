'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MvacEntry, MvacItem, Project, BoqItem } from '@/lib/types';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

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

type EnrichedMvacItem = MvacItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

const slugify = (text: string) =>
  (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');

const getScope1 = (item: any): string => {
  if (!item) return '';
  const key = Object.keys(item).find(
    (k) => k.toLowerCase().replace(/\s+|\./g, '') === 'scope1'
  );
  return key ? String(item[key] || '') : '';
};

const getScope2 = (item: any): string => {
  if (!item) return '';
  const key = Object.keys(item).find(
    (k) => k.toLowerCase().replace(/\s+|\./g, '') === 'scope2'
  );
  return key ? String(item[key] || '') : '';
};

const getBoqSlNo = (item: any): string =>
  String(
    item?.['BOQ SL No'] ??
      item?.['SL. No.'] ??
      item?.boqSlNo ??
      ''
  ).trim();

/* ---------- Print Styles ---------- */

const PrintableMvacStyles = () => (
  <style>{`
    @media print {
      @page {
        size: A4 portrait;
        margin: 0;
      }

      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
        background: #fff !important;
      }

      #printable-mvac-sheet {
        padding: 10mm; /* 1cm internal margin */
        width: 210mm;
        height: 297mm;
        box-sizing: border-box;
      }

      body {
        zoom: 0.95;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #000;
        page-break-inside: auto;
      }

      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      thead {
        display: table-header-group;
      }

      th,
      td {
        border: 1px solid #000;
        padding: 2px 4px;
        vertical-align: top;
        font-size: 9pt;
      }

      th {
        font-weight: bold;
        text-align: center;
      }

      .desc-cell {
        display: -webkit-box;
        -webkit-line-clamp: 4; /* max 4 lines */
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
      }

      .no-print {
        display: none !important;
      }

      .signatures {
        page-break-inside: avoid;
      }
    }
  `}</style>
);

/* ---------- Component ---------- */

export default function PrintMvacPage() {
  const params = useParams();
  const { toast } = useToast();

  const { project: projectSlug, mvacId } = params as {
    project: string;
    mvacId: string;
  };

  const [mvacEntry, setMvacEntry] = useState<MvacEntry | null>(null);
  const [project, setProject] = useState<(Project & { signatures?: any[] }) | null>(null);
  const [enrichedItems, setEnrichedItems] = useState<EnrichedMvacItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /* ----- Fetch data ----- */
  useEffect(() => {
    const fetchPrintData = async () => {
      if (!projectSlug || !mvacId) return;

      setIsLoading(true);
      try {
        // Load projects and match by slugified projectName
        const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
        const projectData = projectsSnapshot.docs
          .map(
            (d) =>
              ({
                id: d.id,
                ...d.data(),
              } as Project)
          )
          .find((p) => slugify(p.projectName) === projectSlug);

        if (!projectData) {
          throw new Error('Project not found.');
        }
        setProject(projectData);

        // Load MVAC entry
        const mvacDocRef = doc(db, 'projects', projectData.id, 'mvacEntries', mvacId);
        const mvacDocSnap = await getDoc(mvacDocRef);
        if (!mvacDocSnap.exists()) {
          throw new Error('MVAC not found.');
        }
        const entry = {
          id: mvacDocSnap.id,
          ...mvacDocSnap.data(),
        } as MvacEntry;
        setMvacEntry(entry);

        // Load BOQ items and map by composite key
        const boqSnap = await getDocs(
          query(collection(db, 'projects', projectData.id, 'boqItems'))
        );
        const boqItemsMap = new Map<string, BoqItem>();

        boqSnap.docs.forEach((docSnap) => {
          const item = docSnap.data() as BoqItem;
          const key = `${getScope1(item)}_${getScope2(item)}_${getBoqSlNo(item)}`;
          if (key) {
            boqItemsMap.set(key, item);
          }
        });

        // Enrich MVAC items
        const enriched = (entry.items || []).map((item) => {
          const itemScope1 = getScope1(item);
          const itemScope2 = getScope2(item);
          const itemSlNo = getBoqSlNo(item);
          const itemKey = `${itemScope1}_${itemScope2}_${itemSlNo}`;
          const boqItem = boqItemsMap.get(itemKey);

          return {
            ...item,
            boqQty: boqItem
              ? Number(
                  (boqItem as any).QTY ||
                    (boqItem as any)['Total Qty'] ||
                    0
                )
              : 0,
            previousCertifiedQty: (item as any).totalCertifiedQty || 0,
          };
        });

        setEnrichedItems(enriched);
      } catch (e) {
        console.error(e);
        toast({
          title: 'Error',
          description: (e as Error).message,
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrintData();
  }, [projectSlug, mvacId, toast]);

  /* ----- Auto-print when ready ----- */
  useEffect(() => {
    if (!isLoading && mvacEntry) {
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.print();
        }
      }, 500);
    }
  }, [isLoading, mvacEntry]);

  /* ----- Utils ----- */

  const calculateUpToDateQty = (item: EnrichedMvacItem) =>
    (Number(item.previousCertifiedQty) || 0) + (Number(item.certifiedQty) || 0);

  const getDisplayValue = (v: number | undefined) =>
    v === 0 ? 0 : v ?? '';

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-[80vh]" />
      </div>
    );
  }

  if (!mvacEntry) {
    return <div className="p-8">MVAC Entry not found.</div>;
  }

  const workDetails = {
    orderNo: project?.woNo || 'N/A',
    projectName:
      project?.projectDescription ||
      project?.projectName ||
      'N/A',
    projectSite: project?.projectSite || 'N/A',
    mvacDate: formatDateSafe(mvacEntry.mvacDate),
    mvacNo: mvacEntry.mvacNo,
  };

  /* ----- Render ----- */

  return (
    <>
      <PrintableMvacStyles />
      <div className="bg-white">
        <div id="printable-mvac-sheet">
          {/* Header */}
          <div className="text-center">
            <p className="text-lg font-extrabold">
              SIDDHARTHA ENGINEERING LIMITED
            </p>
            <p className="text-[7pt] font-semibold">
              ELECTRICAL ENGINEERS, CONTRACTORS (EHV) &amp; CONSULTANTS
            </p>
            <p className="text-[7pt]">
              PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)
            </p>
            <p className="text-[7pt]">
              Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915
            </p>
            <p className="text-[7pt]">
              E-mail: sel.techhead@gmail.com
            </p>
          </div>

          <p className="text-center font-bold text-sm border-y-2 border-black py-1 my-2">
            MATERIAL VERIFICATION AND ACCEPTANCE CERTIFICATE
          </p>

          {/* Work Details */}
          <div className="text-[9pt] space-y-1 mb-2 border border-black p-2">
            <div className="flex justify-between">
              <span>
                <strong>MVAC No.:</strong> {workDetails.mvacNo}
              </span>
              <span>
                <strong>DATE:</strong> {workDetails.mvacDate}
              </span>
            </div>
            <p>
              <strong>Order No.</strong> {workDetails.orderNo}
            </p>
            <p>
              <strong>Name of the project:-</strong> {workDetails.projectName}
            </p>
            <p>
              <strong>Project Site :</strong> {workDetails.projectSite}
            </p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border border-black">
            <Table className="w-full table-auto text-[8pt]">
              <TableHeader>
                <TableRow>
                  <TableHead
                    rowSpan={2}
                    className="w-[4%] border-black text-center align-middle"
                  >
                    SL. NO.
                  </TableHead>
                  <TableHead
                    rowSpan={2}
                    className="w-[28%] border-black text-center align-middle"
                  >
                    Description of Items
                  </TableHead>
                  <TableHead
                    rowSpan={2}
                    className="w-[6%] border-black text-center align-middle"
                  >
                    Unit
                  </TableHead>
                  <TableHead
                    rowSpan={2}
                    className="w-[8%] border-black text-center align-middle"
                  >
                    BOQ Qty
                  </TableHead>
                  <TableHead
                    colSpan={3}
                    className="border-black text-center font-bold"
                  >
                    QNTY EXECUTED
                  </TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="w-[8%] border-black text-center">
                    Up to Previous
                  </TableHead>
                  <TableHead className="w-[8%] border-black text-center">
                    Certified in this MVAC
                  </TableHead>
                  <TableHead className="w-[8%] border-black text-center">
                    Up to date
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {enrichedItems.map((item, index) => {
                  const upToDateQty = calculateUpToDateQty(item);
                  return (
                    <TableRow
                      key={`${(item as any).boqSlNo ?? 'NA'}-${index}`}
                    >
                      <TableCell className="text-center border-black">
                        {(item as any).boqSlNo ?? '-'}
                      </TableCell>
                      <TableCell className="border-black">
                        <div className="desc-cell">
                          {(item as any).description ?? '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-center border-black">
                        {(item as any).unit ?? '-'}
                      </TableCell>
                      <TableCell className="text-right border-black">
                        {getDisplayValue(item.boqQty)}
                      </TableCell>
                      <TableCell className="text-right border-black">
                        {getDisplayValue(
                          (item as any).totalCertifiedQty
                        )}
                      </TableCell>
                      <TableCell className="text-right border-black">
                        {getDisplayValue(
                          (item as any).certifiedQty
                        )}
                      </TableCell>
                      <TableCell className="text-right border-black">
                        {getDisplayValue(upToDateQty)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Signatures */}
          <div className="signatures flex justify-between mt-16 text-[9pt] px-4">
            {(project?.signatures || []).map((sig: any, index: number) => (
              <div
                key={sig.id || index}
                className="w-1/3 text-center"
              >
                <p className="border-t border-black pt-1 mt-8">
                  {sig.designation}
                </p>
                <p className="font-bold">{sig.name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
