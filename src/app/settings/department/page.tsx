
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const departments = [
  {
    sr: 1,
    name: 'IT',
    head: 'N/A',
    status: 'Active',
  },
  {
    sr: 2,
    name: 'HR',
    head: 'N/A',
    status: 'Active',
  },
  {
    sr: 3,
    name: 'PROJECT',
    head: 'N/A',
    status: 'Active',
  },
  {
    sr: 4,
    name: 'ADMIN',
    head: 'N/A',
    status: 'Active',
  },
  {
    sr: 5,
    name: 'FINANCE',
    head: 'N/A',
    status: 'Active',
  },
  {
    sr: 6,
    name: 'TENDER',
    head: 'N/A',
    status: 'Active',
  },
];

export default function ManageDepartmentPage() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Department</h1>
        </div>
        <Button>Add Department</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Sr. No.</TableHead>
                <TableHead>Department Name</TableHead>
                <TableHead>Head of Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((dept) => (
                <TableRow key={dept.sr}>
                  <TableCell>{dept.sr}</TableCell>
                  <TableCell className="font-medium">{dept.name}</TableCell>
                  <TableCell>{dept.head}</TableCell>
                  <TableCell>{dept.status}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm">Edit</Button>
                    <Button variant="destructive" size="sm">Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
