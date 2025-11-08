

'use client';

import ModuleDashboard from '@/components/ModuleDashboard';
import { useAuth } from '@/components/auth/AuthProvider';

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="container mx-auto h-full">
        <ModuleDashboard />
      </div>
    </main>
  );
}
