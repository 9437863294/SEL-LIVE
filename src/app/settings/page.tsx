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
  { icon: Briefcase, text: 'Manage Department' },
  { icon: Construction, text: 'Manage Project' },
  { icon: Briefcase, text: 'Manage Vendor' },
  { icon: Clock, text: 'Working Hrs' },
  { icon: Users, text: 'User Management' },
  { icon: ShieldCheck, text: 'Role Management' },
  { icon: Hash, text: 'Serial No. Config' },
  { icon: Calculator, text: 'Import Config' },
];

export default function SettingsPage() {
  const [selected, setSelected] = useState('Manage Department');

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
          <Home className="h-6 w-6 text-primary" />
        </Link>
        <h1 className="text-2xl font-bold text-primary">Settings</h1>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {settingsItems.map((item) => (
          <Card
            key={item.text}
            className={cn(
              'flex flex-col items-center justify-center p-6 text-center transition-all duration-200 cursor-pointer hover:shadow-lg',
              selected === item.text
                ? 'border-primary ring-2 ring-primary text-primary'
                : 'text-foreground/80 hover:border-primary/50'
            )}
            onClick={() => setSelected(item.text)}
          >
            <CardContent className="p-0 flex flex-col items-center justify-center gap-2">
              <item.icon
                className={cn(
                  'h-10 w-10 mb-2',
                  selected === item.text ? 'text-primary' : 'text-accent'
                )}
              />
              <span className="font-semibold">{item.text}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
