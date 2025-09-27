
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function BoqPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Bill of Quantities (BOQ)</h1>
      <Card>
        <CardHeader>
          <CardTitle>BOQ Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Sl No</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>UNIT</TableHead>
                <TableHead>BOQ QTY</TableHead>
                <TableHead>UNIT PRICE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                  BOQ items will be displayed here.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
