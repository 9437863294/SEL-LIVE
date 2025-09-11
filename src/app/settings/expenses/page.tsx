
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ExpensesSettingsPage() {
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/expenses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Expenses Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expenses Module Settings</CardTitle>
          <CardDescription>
            Configure settings for the expenses module here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Settings for this module can be added here in the future.</p>
        </CardContent>
      </Card>
    </div>
  );
}
