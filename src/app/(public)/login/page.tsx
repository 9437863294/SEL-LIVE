'use client';

import { Suspense } from 'react';
import { LoginPageContent } from '@/components/auth/LoginPageContent';
import { LoginSplash } from '@/components/auth/login/parts';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSplash />}>
      <LoginPageContent />
    </Suspense>
  );
}
