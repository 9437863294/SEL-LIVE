
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
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
  };
}

const settingsItems = [
  { icon: Briefcase, text: 'Manage Department', href: '/settings/department' },
  { icon: Construction, text: 'Manage Project', href: '/settings/project' },
  { icon: Briefcase, text: 'Manage Vendor', href: '#' },
  { icon: Clock, text: 'Working Hrs', href: '/settings/working-hours' },
  { icon: Users, text: 'User Management', href: '/settings/user-management' },
  { icon: ShieldCheck, text: 'Role Management', href: '/settings/role-management' },
  { icon: Hash, text: 'Serial No. Config', href: '#' },
  { icon: Calculator, text: 'Import Config', href: '#' },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function SettingsPage() {

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Home className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
