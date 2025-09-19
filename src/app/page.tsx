

'use client';

import ModuleDashboard from '@/components/ModuleDashboard';
import { useAuth } from '@/components/auth/AuthProvider';

export default function Home() {
  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 flex flex-col h-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Welcome Back!</h1>
        <p className="text-muted-foreground">Here are your available modules.</p>
      </div>
      <ModuleDashboard />
    </div>
  );
}
