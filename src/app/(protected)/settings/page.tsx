
'use client';

import Link from 'next/link';
import {
  Home, Briefcase, Construction, Clock, Users, ShieldCheck, Hash,
  Palette, MailCheck, LogIn, Package, Settings2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsItemConfig {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string;
  permission: string;
  colorScheme: {
    bg: string;
    iconBg: string;
    iconColor: string;
    border: string;
  };
}

const settingsItemsBase: SettingsItemConfig[] = [
  {
    icon: Briefcase,
    text: 'Manage Department',
    description: 'Add, edit, or remove company departments.',
    href: '/settings/department',
    permission: 'View',
    colorScheme: {
      bg: 'from-sky-500/8 to-sky-600/4',
      iconBg: 'bg-sky-100 dark:bg-sky-900/40',
      iconColor: 'text-sky-600 dark:text-sky-400',
      border: 'border-sky-200/60 dark:border-sky-800/30 hover:border-sky-400/60',
    },
  },
  {
    icon: Construction,
    text: 'Manage Project',
    description: 'Set up and configure project details.',
    href: '/settings/project',
    permission: 'View',
    colorScheme: {
      bg: 'from-amber-500/8 to-amber-600/4',
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      iconColor: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200/60 dark:border-amber-800/30 hover:border-amber-400/60',
    },
  },
  {
    icon: Users,
    text: 'Employee',
    description: 'Manage employee data and sync with HR systems.',
    href: '/employee',
    permission: 'View',
    colorScheme: {
      bg: 'from-green-500/8 to-green-600/4',
      iconBg: 'bg-green-100 dark:bg-green-900/40',
      iconColor: 'text-green-600 dark:text-green-400',
      border: 'border-green-200/60 dark:border-green-800/30 hover:border-green-400/60',
    },
  },
  {
    icon: Users,
    text: 'User Management',
    description: 'Manage user accounts and their roles.',
    href: '/settings/user-management',
    permission: 'View',
    colorScheme: {
      bg: 'from-blue-500/8 to-blue-600/4',
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200/60 dark:border-blue-800/30 hover:border-blue-400/60',
    },
  },
  {
    icon: ShieldCheck,
    text: 'Role Management',
    description: 'Define roles and their specific permissions.',
    href: '/settings/role-management',
    permission: 'View',
    colorScheme: {
      bg: 'from-red-500/8 to-red-600/4',
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      iconColor: 'text-red-600 dark:text-red-400',
      border: 'border-red-200/60 dark:border-red-800/30 hover:border-red-400/60',
    },
  },
  {
    icon: Hash,
    text: 'Serial No. Config',
    description: 'Configure document numbering sequences.',
    href: '/settings/serial-no-configuration',
    permission: 'View',
    colorScheme: {
      bg: 'from-indigo-500/8 to-indigo-600/4',
      iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-200/60 dark:border-indigo-800/30 hover:border-indigo-400/60',
    },
  },
  {
    icon: Clock,
    text: 'Working Hours',
    description: 'Set company working hours and holidays.',
    href: '/settings/working-hours',
    permission: 'View',
    colorScheme: {
      bg: 'from-teal-500/8 to-teal-600/4',
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconColor: 'text-teal-600 dark:text-teal-400',
      border: 'border-teal-200/60 dark:border-teal-800/30 hover:border-teal-400/60',
    },
  },
  {
    icon: Palette,
    text: 'Appearance',
    description: "Customize the application's look and feel.",
    href: '/settings/appearance',
    permission: 'View',
    colorScheme: {
      bg: 'from-pink-500/8 to-pink-600/4',
      iconBg: 'bg-pink-100 dark:bg-pink-900/40',
      iconColor: 'text-pink-600 dark:text-pink-400',
      border: 'border-pink-200/60 dark:border-pink-800/30 hover:border-pink-400/60',
    },
  },
  {
    icon: MailCheck,
    text: 'Email Authorization',
    description: 'Authorize access to email services.',
    href: '/settings/email-authorization',
    permission: 'View',
    colorScheme: {
      bg: 'from-cyan-500/8 to-cyan-600/4',
      iconBg: 'bg-cyan-100 dark:bg-cyan-900/40',
      iconColor: 'text-cyan-600 dark:text-cyan-400',
      border: 'border-cyan-200/60 dark:border-cyan-800/30 hover:border-cyan-400/60',
    },
  },
  {
    icon: LogIn,
    text: 'Login Expiry',
    description: 'Manage session timeout settings.',
    href: '/settings/login-expiry',
    permission: 'View',
    colorScheme: {
      bg: 'from-orange-500/8 to-orange-600/4',
      iconBg: 'bg-orange-100 dark:bg-orange-900/40',
      iconColor: 'text-orange-600 dark:text-orange-400',
      border: 'border-orange-200/60 dark:border-orange-800/30 hover:border-orange-400/60',
    },
  },
  {
    icon: Package,
    text: 'Store & Stock',
    description: 'Configure stock management settings.',
    href: '/store-stock-management/settings',
    permission: 'View',
    colorScheme: {
      bg: 'from-violet-500/8 to-violet-600/4',
      iconBg: 'bg-violet-100 dark:bg-violet-900/40',
      iconColor: 'text-violet-600 dark:text-violet-400',
      border: 'border-violet-200/60 dark:border-violet-800/30 hover:border-violet-400/60',
    },
  },
];

function SettingsCard({
  item,
  index,
}: {
  item: SettingsItemConfig & { disabled?: boolean };
  index: number;
}) {
  const { colorScheme } = item;
  const isDisabled = item.disabled || item.href === '#';

  const cardContent = (
    <Card
      className={cn(
        'group relative flex flex-col h-full overflow-hidden transition-all duration-300 ease-in-out rounded-xl border',
        colorScheme.border,
        !isDisabled && 'hover:shadow-xl hover:-translate-y-0.5 cursor-pointer',
        isDisabled && 'cursor-not-allowed opacity-55 saturate-50',
      )}
    >
      {/* Gradient background */}
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-60', colorScheme.bg)} />
      {/* Top accent */}
      <div className={cn(
        'absolute top-0 left-0 right-0 h-0.5 transition-all duration-300',
        !isDisabled && 'group-hover:h-[2px]',
        colorScheme.iconBg,
      )} />

      <CardHeader className="relative flex-row items-center gap-4 space-y-0 p-4">
        <div className={cn(
          'rounded-xl p-2.5 shrink-0 transition-transform duration-300',
          colorScheme.iconBg,
          !isDisabled && 'group-hover:scale-110',
        )}>
          <item.icon className={cn('w-5 h-5', colorScheme.iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-bold leading-tight">{item.text}</CardTitle>
          <CardDescription className="text-xs mt-0.5 line-clamp-2">{item.description}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (isDisabled) return <div className="h-full">{cardContent}</div>;
  return (
    <Link href={item.href} className="no-underline h-full block animate-bb-card-in"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}>
      {cardContent}
    </Link>
  );
}

export default function SettingsPage() {
  const { can, isLoading } = useAuthorization();

  const permissionMap: Record<string, string> = {
    '/settings/department': 'Settings.Manage Department',
    '/settings/project': 'Settings.Manage Project',
    '/employee': 'Settings.Employee Management',
    '/settings/user-management': 'Settings.User Management',
    '/settings/role-management': 'Settings.Role Management',
    '/settings/serial-no-configuration': 'Settings.Serial No. Config',
    '/settings/working-hours': 'Settings.Working Hrs',
    '/settings/appearance': 'Settings.Appearance',
    '/settings/email-authorization': 'Settings.Email Authorization',
    '/settings/login-expiry': 'Settings.Login Expiry',
    '/store-stock-management/settings': 'Store & Stock Management',
  };

  const settingsItems = settingsItemsBase.map(item => {
    const module = permissionMap[item.href] ?? 'Settings';
    const action = item.href === '/store-stock-management/settings' ? 'View Module' : item.permission;
    return { ...item, disabled: !can(action, module) };
  });

  if (isLoading) {
    return (
      <>
        <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50/80 via-background to-violet-50/50 dark:from-slate-950/40 dark:via-background dark:to-violet-950/20" />
        </div>
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-7 w-40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 11 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ── Animated Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/80 via-background to-violet-50/50 dark:from-slate-950/40 dark:via-background dark:to-violet-950/20" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-sky-300/10 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.10) 1px, transparent 1px)', backgroundSize: '30px 30px' }}
        />
      </div>

      {/* ── Header ── */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
            <Home className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary/70" />
            <h1 className="text-xl font-bold tracking-tight">System Settings</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Configure system preferences and manage access</p>
        </div>
      </div>

      {/* ── Settings Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {settingsItems.map((item, i) => (
          <SettingsCard key={item.text} item={item} index={i} />
        ))}
      </div>
    </>
  );
}
