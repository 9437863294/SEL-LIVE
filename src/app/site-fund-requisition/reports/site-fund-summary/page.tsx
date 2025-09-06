
'use client';

import Link from 'next/link';
import { ArrowLeft, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const summaryStats = [
  { title: 'Total Requisitions', value: '3' },
  { title: 'Total Amount', value: '₹14,69,300' },
  { title: 'Cancelled', value: '0' },
  { title: 'Balance', value: '₹10,04,654' },
  { title: 'Approved', value: '₹4,64,646' },
];

const stepWiseData = [
  {
    title: 'Request Receiving',
    data: [{ user: 'Super User', total: 1, done: 1, onTime: 0, rejected: 0 }],
  },
  {
    title: 'Verification',
    data: [{ user: 'Super User', total: 1, done: 1, onTime: 0, rejected: 0 }],
  },
  {
    title: 'Approval of Payment',
    data: [{ user: 'Super User', total: 1, done: 1, onTime: 0, rejected: 0 }],
  },
];

export default function SiteFundSummaryPage() {
  return (
    <div className="flex flex-col w-full pr-14">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/site-fund-requisition/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Site Fund Summary</h1>
        </div>
        <Link href="/">
          <Button variant="ghost" size="icon">
            <Home className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
            <div className="space-y-1">
              <p className="text-sm font-medium">Year</p>
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Month</p>
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Project</p>
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Applicant</p>
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All Applicants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Applicants</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
        {summaryStats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold">Step-wise Report</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stepWiseData.map((step) => (
          <Card key={step.title}>
            <CardHeader className="p-4 bg-muted/50">
              <CardTitle className="text-base text-center">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Done</TableHead>
                    <TableHead>On Time</TableHead>
                    <TableHead>Rejected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {step.data.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell>{row.user}</TableCell>
                      <TableCell>{row.total}</TableCell>
                      <TableCell>{row.done}</TableCell>
                      <TableCell>{row.onTime}</TableCell>
                      <TableCell>{row.rejected}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
