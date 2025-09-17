
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const cashflowData = [
  { month: 'April 2025', inflow: 125199576.99, outflow: 180777413.56, net: -55577836.57, avgExpense: 6025913.79, avgUtil: -445904855.23, utilPercent: 96.96, interestProjected: 4027087.93, interestActual: 4031030.82 },
  { month: 'May 2025', inflow: 201758441.69, outflow: 164535668.33, net: 37222773.36, avgExpense: 5307602.20, avgUtil: -454380554.54, utilPercent: 98.68, interestProjected: 4192374.04, interestActual: 4212116.00 },
  { month: 'June 2025', inflow: 122263901.00, outflow: 138202434.85, net: -15938533.85, avgExpense: 4606747.83, avgUtil: -442836639.53, utilPercent: 98.03, interestProjected: 3858668.46, interestActual: 3858828.14 },
  { month: 'July 2025', inflow: 157262569.74, outflow: 154667757.32, net: 2594812.42, avgExpense: 4989282.49, avgUtil: -438243034.49, utilPercent: 97.45, interestProjected: 3855312.33, interestActual: 3854083.11 },
  { month: 'August 2025', inflow: 133237083.23, outflow: 118583621.51, net: 14653461.72, avgExpense: 3825278.11, avgUtil: -448074986.50, utilPercent: 99.28, interestProjected: 3949754.34, interestActual: 3981986.00 },
  { month: 'September 2025', inflow: 43662957.10, outflow: 76873895.30, net: -33210938.20, avgExpense: 2562463.18, avgUtil: -450777675.46, utilPercent: 99.79, interestProjected: 2901198.31, interestActual: 0.00 },
  { month: 'October 2025', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 101.78, interestProjected: 0.00, interestActual: 0.00 },
  { month: 'November 2025', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 101.67, interestProjected: 0.00, interestActual: 0.00 },
  { month: 'December 2025', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 101.67, interestProjected: 0.00, interestActual: 0.00 },
  { month: 'January 2026', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 100.82, interestProjected: 0.00, interestActual: 0.00 },
  { month: 'February 2026', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 99.71, interestProjected: 0.00, interestActual: 0.00 },
  { month: 'March 2026', inflow: 0.00, outflow: 0.00, net: 0.00, avgExpense: 0.00, avgUtil: -457403320.09, utilPercent: 101.67, interestProjected: 0.00, interestActual: 0.00 },
];

const total = cashflowData.reduce((acc, row) => ({
    inflow: acc.inflow + row.inflow,
    outflow: acc.outflow + row.outflow,
    net: acc.net + row.net,
    avgExpense: acc.avgExpense + row.avgExpense,
    avgUtil: acc.avgUtil + row.avgUtil,
    utilPercent: acc.utilPercent + row.utilPercent,
    interestProjected: acc.interestProjected + row.interestProjected,
    interestActual: acc.interestActual + row.interestActual,
}), { inflow: 0, outflow: 0, net: 0, avgExpense: 0, avgUtil: 0, utilPercent: 0, interestProjected: 0, interestActual: 0 });

const average = {
    inflow: 65282044.15,
    outflow: 69470065.91,
    net: -4188021.76,
    avgExpense: 2276440.63,
    avgUtil: -452053138.86,
    utilPercent: 97.89,
    interestProjected: 1898699.62,
    interestActual: 1661503.67
};

export default function CashflowStatementPage() {

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  
  const formatNumber = (value: number) => {
      return value.toFixed(2);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/bank-balance/reports">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Cashflow Statement</h1>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>FY 2025-2026</CardTitle>
            <CardDescription>Monthly breakdown of cash flow and interest.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">MONTH</TableHead>
                    <TableHead className="text-right font-bold">INFLOW (RECEIPTS)</TableHead>
                    <TableHead className="text-right font-bold">OUTFLOW (EXPENSES)</TableHead>
                    <TableHead className="text-right font-bold">NET CASHFLOW</TableHead>
                    <TableHead className="text-right font-bold">AVERAGE EXPENSE</TableHead>
                    <TableHead className="text-right font-bold">AVERAGE UTILISATION</TableHead>
                    <TableHead className="text-right font-bold">% UTILISATION</TableHead>
                    <TableHead className="text-right font-bold">PROJ. INTEREST</TableHead>
                    <TableHead className="text-right font-bold">ACTUAL INTEREST</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashflowData.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">{row.month}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.inflow)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.outflow)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.net)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.avgExpense)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.avgUtil)}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.utilPercent)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.interestProjected)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.interestActual)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                    <TableRow className="font-bold bg-muted/50">
                        <TableCell>TOTAL FOR THE YEAR</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.inflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.outflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.net)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.avgExpense)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.avgUtil)}</TableCell>
                        <TableCell className="text-right">{formatNumber(total.utilPercent)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.interestProjected)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total.interestActual)}</TableCell>
                    </TableRow>
                     <TableRow className="font-bold bg-muted/50">
                        <TableCell>AVERAGE FOR THE YEAR</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.inflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.outflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.net)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.avgExpense)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.avgUtil)}</TableCell>
                        <TableCell className="text-right">{formatNumber(average.utilPercent)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.interestProjected)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(average.interestActual)}</TableCell>
                    </TableRow>
                </TableFooter>
              </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
