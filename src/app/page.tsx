

'use client';

import ModuleDashboard from '@/components/ModuleDashboard';
import { useAuth } from '@/components/auth/AuthProvider';

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 flex flex-col h-full">
      
      <ModuleDashboard />
    </div>
  );
}

