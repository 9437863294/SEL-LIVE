'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const VEHICLE_TABLE_PAGE_SIZE = 25;

export function useVehicleTablePagination<T>(rows: T[], pageSize = VEHICLE_TABLE_PAGE_SIZE) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const paginatedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, rows]
  );

  return { currentPage, setCurrentPage, totalPages, paginatedRows, pageSize };
}

export function VehicleTablePagination({
  currentPage,
  totalPages,
  totalRows,
  pageSize,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalRows === 0) return null;
  const first = (currentPage - 1) * pageSize + 1;
  const last = Math.min(currentPage * pageSize, totalRows);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/70 bg-white/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">Showing {first}-{last} of {totalRows}</p>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="h-8 bg-white">
          <ChevronLeft className="mr-1 h-4 w-4" />Previous
        </Button>
        <span className="min-w-16 text-center text-xs font-semibold text-slate-600">{currentPage} / {totalPages}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="h-8 bg-white">
          Next<ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
