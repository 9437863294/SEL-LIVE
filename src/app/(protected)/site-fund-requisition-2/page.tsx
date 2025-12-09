'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Edit, Trash2 } from 'lucide-react';

export default function SiteFundRequisition2Page() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Site Fund Requisition 2</h1>
      <div className="max-w-sm">
        <Card>
          <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="bg-primary/10 p-2 rounded-lg">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                  <CardTitle className="text-base font-bold">Manage Requests</CardTitle>
                  <CardDescription className="text-xs">Manage all requests for this module.</CardDescription>
              </div>
          </CardHeader>
          <CardContent>
            {/* Content for managing requests will go here */}
            <p className="text-sm text-muted-foreground">Request management content will appear here.</p>
          </CardContent>
          <CardFooter className="flex justify-end gap-1 p-2 border-t">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
              </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
