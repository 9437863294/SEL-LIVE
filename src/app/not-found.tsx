
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen text-center bg-background">
      <h1 className="text-4xl font-bold mb-2">404 – Page Not Found</h1>
      <p className="text-muted-foreground mb-6">
        The page you’re looking for doesn’t exist or has been moved.
      </p>
      <Link href="/">
        <Button variant="default">Go Back Home</Button>
      </Link>
    </div>
  );
}
