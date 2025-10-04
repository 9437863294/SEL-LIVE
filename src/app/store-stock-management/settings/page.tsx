
'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Construction, Ruler, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6 flex items-center gap-2">
        <Link href="/store-stock-management">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-xl font-bold">Stock Management Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        <Link href="/store-stock-management/settings/projects" className="no-underline">
           <Card className="flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50 cursor-pointer">
              <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <Construction className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Projects & Sites</CardTitle>
                      <CardDescription className="text-xs">Configure which projects require stock management.</CardDescription>
                  </div>
              </CardHeader>
          </Card>
        </Link>
        <Link href="/store-stock-management/settings/units" className="no-underline">
           <Card className="flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50 cursor-pointer">
              <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <Ruler className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Unit Management</CardTitle>
                      <CardDescription className="text-xs">Manage units of measurement for stock items.</CardDescription>
                  </div>
              </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
