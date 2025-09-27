
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Module Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Settings for the Store &amp; Stock Management module will be configured here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
