
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';

const DEFAULT_PASSCODE = 'Sel@123'; // ✅ default passcode

export default function PrintAuthPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() === DEFAULT_PASSCODE) {
      // set cookie valid for 24 hours
      document.cookie =
        'print_auth=ok; path=/; max-age=86400; SameSite=Lax';
      router.replace(next);
    } else {
      setError('❌ Invalid passcode. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Card className="max-w-sm w-full">
        <CardHeader>
          <CardTitle className="text-center text-lg font-semibold">
            Enter Print Passcode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Enter passcode"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              className="text-center"
              required
            />
            {error && (
              <p className="text-xs text-red-500 text-center">{error}</p>
            )}
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
