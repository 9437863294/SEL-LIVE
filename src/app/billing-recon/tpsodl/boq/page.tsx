
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  UploadCloud,
  Eye,
  PlusSquare,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BoqCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}

const boqItems = [
  { icon: UploadCloud, text: 'Import BOQ', href: '/billing-recon/tpsodl/boq/import', description: 'Upload and process a new BOQ file.' },
  { icon: Eye, text: 'View BOQ', href: '/billing-recon/tpsodl/boq/view', description: 'See the details of existing BOQs.' },
  { icon: PlusSquare, text: 'Add BOQ Items', href: '/billing-recon/tpsodl/boq/add', description: 'Manually add items to a BOQ.' },
];

function BoqCard({ item }: BoqCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function BoqPage() {

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon/tpsodl">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">BOQ Management</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {boqItems.map((item) => (
          <BoqCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
