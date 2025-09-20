
'use client';

import Link from 'next/link';
import { Shield, User, Home, HardHat, Car, Settings, CalendarClock, CheckSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface InsuranceCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const insuranceItems: Omit<InsuranceCardProps['item'], 'disabled'>[] = [
  { 
    icon: User, 
    text: 'Personal Insurance', 
    href: '/insurance/personal', 
    description: 'Manage personal health and life insurance policies.' 
  },
  { 
    icon: CalendarClock,
    text: 'Premium Due',
    href: '/insurance/premium-due',
    description: 'View upcoming and overdue premium payments.'
  },
  { 
    icon: CheckSquare,
    text: 'Maturity Due',
    href: '/insurance/maturity-due',
    description: 'View policies nearing their maturity dates.'
  },
  { 
    icon: Home, 
    text: 'Property Insurance', 
    href: '#', 
    description: 'Oversee insurance for properties and assets.' 
  },
  { 
    icon: HardHat, 
    text: 'Project Insurance', 
    href: '#', 
    description: 'Handle insurance policies related to specific projects.' 
  },
  { 
    icon: Car, 
    text: 'Vehicle Insurance', 
    href: '#', 
    description: 'Track and manage insurance for all company vehicles.' 
  },
  {
    icon: Settings,
    text: 'Settings',
    href: '/insurance/settings',
    description: 'Manage policy holders and insurance companies.'
  }
];

function InsuranceCard({ item }: InsuranceCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-col items-center text-center gap-4 p-6">
                <div className="bg-primary/10 p-3 rounded-full">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
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

export default function InsurancePage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Shield className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-xl font-bold">Insurance Module</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {insuranceItems.map((item) => (
          <InsuranceCard key={item.text} item={{...item, disabled: item.href === '#'}} />
        ))}
      </div>
    </div>
  );
}
