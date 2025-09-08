
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ViewBoqPage() {

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon/tpsodl/boq">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">View BOQ</h1>
      </div>
      <Card>
        <CardContent className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>SL. No.</TableHead>
                        <TableHead>Amended SL No</TableHead>
                        <TableHead>Activity Description</TableHead>
                        <TableHead>DESCRIPTION OF ITEMS</TableHead>
                        <TableHead>UNITS</TableHead>
                        <TableHead>Total Qty</TableHead>
                        <TableHead>BASIC PRICE</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow>
                        <TableCell colSpan={7} className="text-center h-24">
                            No BOQ items found.
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
