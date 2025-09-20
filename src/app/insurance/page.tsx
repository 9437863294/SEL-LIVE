
'use client';

import { Shield } from 'lucide-react';

export default function InsurancePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <Shield className="w-24 h-24 text-primary mb-4" />
      <h1 className="text-2xl font-bold">Insurance Module</h1>
      <p className="text-muted-foreground">This is a placeholder for the Insurance module.</p>
    </div>
  );
}
