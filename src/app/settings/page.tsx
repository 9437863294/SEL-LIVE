
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
  Palette,
  MailCheck,
  Receipt,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const settingsItemsBase = [
  { icon: Briefcase, text: 'Manage Department', description: 'Add, edit, or remove company departments.', href: '/settings/department', permission: 'View' },
  { icon: Construction, text: 'Manage Project', description: 'Set up and configure project details.', href: '/settings/project', permission: 'View' },
  { icon: Users, text: 'Employee', description: 'Manage employee data and sync with HR systems.', href: '/settings/employee', permission: 'View' },
  { icon: Users, text: 'User Management', description: 'Manage user accounts and their roles.', href: '/settings/user-management', permission: 'View' },
  { icon: ShieldCheck, text: 'Role Management', description: 'Define roles and their specific permissions.', href: '/settings/role-management', permission: 'View' },
  { icon: Hash, text: 'Serial No. Config', description: 'Configure document numbering sequences.', href: '/settings/serial-no-configuration', permission: 'View' },
  { icon: Clock, text: 'Working Hrs', description: 'Set company working hours and holidays.', href: '/settings/working-hours', permission: 'View' },
  { icon: Palette, text: 'Appearance', description: 'Customize the application\'s look and feel.', href: '/settings/appearance', permission: 'View' },
  { icon: MailCheck, text: 'Email Authorization', description: 'Authorize access to email services.', href: '/settings/email-authorization', permission: 'View' },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function SettingsPage() {
  const { can, isLoading } = useAuthorization();
  
  const settingsItems = settingsItemsBase.map(item => {
    const [mainModule, subModule] = item.href.split('/').filter(p => p && p !== 'settings');
    let permissionModule = `Settings.${item.text}`; // Default assumption
    
    // This logic needs to be robust. Map href to permission module name.
    switch(mainModule) {
      case 'department': permissionModule = 'Settings.Manage Department'; break;
      case 'project': permissionModule = 'Settings.Manage Project'; break;
      case 'employee': permissionModule = 'Settings.Employee Management'; break;
      case 'user-management': permissionModule = 'Settings.User Management'; break;
      case 'role-management': permissionModule = 'Settings.Role Management'; break;
      case 'serial-no-configuration': permissionModule = 'Settings.Serial No. Config'; break;
      case 'working-hours': permissionModule = 'Settings.Working Hrs'; break;
      case 'appearance': permissionModule = 'Settings.Appearance'; break;
      case 'email-authorization': permissionModule = 'Settings.Email Authorization'; break;
    }

    return {
      ...item,
      disabled: !can(item.permission, permissionModule)
    }
  });


  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-8 w-32" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({length: 9}).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
    </div>
    )
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Home className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
