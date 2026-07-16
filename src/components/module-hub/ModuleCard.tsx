
'use client';

import { useModules } from '@/context/ModuleContext';
import type { Module } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
        return '/site-fund-requisition-2';
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
      case 'Loan':
        return '/loan';
      case 'LC Module':
        return '/lc-module';
      case 'LC Management':
        return '/lc-management';
      case 'Insurance':
        return '/insurance';
      case 'Store & Stock Management':
        return '/store-stock-management';
      case 'Vehicle Management':
        return '/vehicle-management';
      case 'Driver Management':
        return '/driver-management';
      case 'Site Account Statement':
        return '/site-account-statement';
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
      <CardHeader className="flex-col items-start gap-2 space-y-0 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        <div className="flex w-full items-center gap-2 sm:contents">
          <div className="bg-primary/10 p-1.5 sm:p-2 rounded-lg shrink-0">
            <LucideIcon name={module.icon} className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 sm:hidden">
            <CardTitle className="text-xs font-bold leading-tight truncate">{module.title}</CardTitle>
          </div>
          <div className="ml-auto sm:hidden cursor-grab p-1 text-muted-foreground touch-none" aria-label="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </div>
        </div>
        <div className="hidden sm:flex sm:flex-1 sm:min-w-0">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-bold">{module.title}</CardTitle>
            <p className="text-sm text-muted-foreground pt-1 line-clamp-2">{module.content}</p>
          </div>
          <div className="flex items-center -mr-2 -mt-2 self-start shrink-0">
            <div className="cursor-grab p-2 text-muted-foreground touch-none" aria-label="Drag to reorder">
              <GripVertical className="h-5 w-5" />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("mt-auto flex justify-end gap-1 p-1.5 sm:gap-1.5 sm:p-2 border-t", !canEdit && !canDelete && "hidden")}>
        {canEdit && (
          <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-9 sm:w-9" onClick={(e) => { e.preventDefault(); setIsEditOpen(true); }}>
              <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="sr-only">Edit</span>
          </Button>
        )}
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-9 sm:w-9 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(e) => e.preventDefault()}>
                  <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
