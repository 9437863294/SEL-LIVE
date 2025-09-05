'use client';

import Link from 'next/link';
import {
  Home,
  Briefcase,
  Construction,
  Clock,
  Users,
  ShieldCheck,
  Hash,
  Calculator,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const settingsItems = [
  { icon: Briefcase, text: 'Manage Department', href: '/settings/department' },
  { icon: Construction, text: 'Manage Project', href: '#' },
  { icon: Briefcase, text: 'Manage Vendor', href: '#' },
  { icon: Clock, text: 'Working Hrs', href: '#' },
  { icon: Users, text: 'User Management', href: '#' },
  { icon: ShieldCheck, text: 'Role Management', href: '#' },
  { icon: Hash, text: 'Serial No. Config', href: '#' },
  { icon: Calculator, text: 'Import Config', href: '#' },
];

export default function SettingsPage() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
          <Home className="h-6 w-6 text-primary" />
        </Link>
        <h1 className="text-2xl font-bold text-primary">Settings</h1>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {settingsItems.map((item) => {
          const isSelected = selected === item.text;
          const card = (
            <Card
              className={cn(
                'flex flex-col items-center justify-center p-6 text-center transition-all duration-200 cursor-pointer hover:shadow-lg',
                isSelected
                  ? 'border-primary ring-2 ring-primary text-primary'
                  : 'text-foreground/80 hover:border-primary/50'
              )}
            >
              <CardContent className="p-0 flex flex-col items-center justify-center gap-2">
                <item.icon
                  className={cn(
                    'h-10 w-10 mb-2',
                    isSelected ? 'text-primary' : 'text-accent'
                  )}
                />
                <span className="font-semibold">{item.text}</span>
              </CardContent>
            </Card>
          );

          if (item.href && item.href !== '#') {
            return (
              <Link href={item.href} key={item.text} className="no-underline" onClick={() => setSelected(item.text)}>
                {card}
              </Link>
            );
          }
          return (
            <div key={item.text} onClick={() => setSelected(item.text)}>
              {card}
            </div>
          );
        })}
      </div>
    </div>
  );
}
