
'use client';

import { useModules } from '@/context/ModuleContext';
import type { Module } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { GripVertical, Trash2, Edit, icons, FileText } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from '@/lib/utils';
import { useState }from 'react';
import { EditModuleDialog } from './EditModuleDialog';
import Link from 'next/link';
import { useAuthorization } from '@/hooks/useAuthorization';


interface ModuleCardProps extends React.HTMLAttributes<HTMLDivElement> {
    module: Module;
    isDragging?: boolean;
}

const LucideIcon = ({ name, ...props }: { name: string } & React.ComponentProps<(typeof icons)[keyof typeof icons]>) => {
  const Icon = icons[name as keyof typeof icons];
  if (!Icon) {
    return <FileText {...props} />; // Fallback icon
  }
  return <Icon {...props} />;
};


export default function ModuleCard({ module, isDragging, ...props }: ModuleCardProps) {
  const { deleteModule } = useModules();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { can } = useAuthorization();

  const canEdit = can('Edit', 'Module Hub');
  const canDelete = can('Delete', 'Module Hub');

  const getHref = (moduleTitle: string) => {
    const slug = moduleTitle.toLowerCase().replace(/\s+/g, '-');
    switch (moduleTitle) {
      case 'Subcontractors Management':
        return '/subcontractors-management/all';
      case 'Site Fund Requisition':
        return '/site-fund-requisition';
      case 'Daily Requisition':
        return '/daily-requisition';
      case 'Billing Recon':
        return '/billing-recon';
      case 'Bank Balance':
        return '/bank-balance';
      case 'Expenses':
        return '/expenses';
      case 'Settings':
        return '/settings';
      case 'Chat System':
        return '/chat';
      case 'Loan':
        return '/loan';
      case 'LC Module':
        return '/lc-module';
      case 'Insurance':
        return '/insurance';
      case 'Store & Stock Management':
        return '/store-stock-management';
      // Nested Settings Pages
      case 'User Management':
        return '/settings/user-management';
      case 'Role Management':
        return '/settings/role-management';
      case 'Serial No. Config':
        return '/settings/serial-no-configuration';
      case 'Working Hrs':
        return '/settings/working-hours';
      case 'Appearance':
        return '/settings/appearance';
      case 'Email Authorization':
        return '/settings/email-authorization';
      case 'Login Expiry':
        return '/settings/login-expiry';
      case 'Manage Department':
        return '/settings/department';
      case 'Manage Project':
        return '/settings/project';
      case 'Employee':
        return '/employee';
      // Nested Expenses Settings
      case 'Manage Accounts':
        return '/settings/expenses/accounts';
      case 'Department-wise Serial Number':
        return '/settings/expenses/department-serial-no';
      // Nested Insurance Settings
      case 'Policy Holders':
        return '/insurance/policy-holders';
      case 'Insurance Companies':
        return '/insurance/companies';
      case 'Policy Category':
        return '/insurance/settings/policy-category';
      case 'Projects and Properties':
        return '/insurance/settings/assets';
      case 'Help':
        return '/insurance/settings/help';
      default:
        return `/${slug}`;
    }
  };

  const CardContentWrapper = ({ children }: { children: React.ReactNode }) => (
    <Card
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50", 
        isDragging ? 'opacity-30 scale-95 shadow-2xl ring-2 ring-primary' : 'opacity-100 scale-100'
      )}
      {...props}
    >
      {children}
    </Card>
  );

  const cardInnerContent = (
    <>
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
        <div className="bg-primary/10 p-2 rounded-lg">
           <LucideIcon name={module.icon} className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
            <CardTitle className="text-base font-bold">{module.title}</CardTitle>
            <p className="text-sm text-muted-foreground pt-1 line-clamp-2">{module.content}</p>
        </div>
        <div className="flex items-center -mr-2 -mt-2 self-start">
             <div className="cursor-grab p-2 text-muted-foreground touch-none" aria-label="Drag to reorder">
                <GripVertical className="h-5 w-5" />
            </div>
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex justify-end gap-1 p-2 border-t">
        {canEdit && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.preventDefault(); setIsEditOpen(true); }}>
              <Edit className="h-4 w-4" />
              <span className="sr-only">Edit</span>
          </Button>
        )}
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(e) => e.preventDefault()}>
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  "{module.title}" module.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteModule(module.id)}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </>
  );

  return (
    <>
      <Link href={getHref(module.title)} className="no-underline h-full">
        <CardContentWrapper>
          {cardInnerContent}
        </CardContentWrapper>
      </Link>
      <EditModuleDialog isOpen={isEditOpen} onOpenChange={setIsEditOpen} module={module} />
    </>
  );
}
