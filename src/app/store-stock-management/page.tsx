
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Home, HardHat, Warehouse, ListOrdered } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ManagementCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const managementItems = [
  { 
    icon: HardHat, 
    title: 'Projects & Sites', 
    description: 'Manage projects and their associated sites or locations.', 
    href: '/store-stock-management/projects' 
  },
  { 
    icon: ListOrdered, 
    title: 'Item Master', 
    description: 'Define main items, sub-items, and their bill of materials (BOM).', 
    href: '/store-stock-management/items' 
  },
   { 
    icon: Warehouse, 
    title: 'Inventory', 
    description: 'View current stock levels, track movements, and manage inventory logs.', 
    href: '/store-stock-management/inventory' 
  },
];

function ManagementCard({ item }: ManagementCardProps) {
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
                    <CardTitle className="text-base font-bold">{item.title}</CardTitle>
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

export default function StoreStockManagementPage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Home className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-xl font-bold">Store & Stock Management</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {managementItems.map((item) => (
          <ManagementCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
