"use client";

import { useModules } from "@/context/ModuleContext";
import type { Module } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Edit, EyeOff, GripVertical, Pin, Trash2 } from "lucide-react";
import { getModuleIconEntry } from "./module-icon-registry";
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
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { EditModuleDialog } from "./EditModuleDialog";
import Link from "next/link";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Density } from "@/lib/appearance/model";

interface ModuleCardProps extends React.HTMLAttributes<HTMLDivElement> {
  module: Module;
  isDragging?: boolean;
  /** The user's "Dashboard card density". `standard` is the card exactly as it has always been. */
  density?: Density;
  /** Whether this module is on the user's pinned list — the pin button's pressed state. */
  pinned?: boolean;
  /** Pin/Unpin and Hide appear only when these are given. Both are personal display choices. */
  onTogglePin?: () => void;
  onHide?: () => void;
}

/** Spacing per density. Only padding, clamping and button size change — never what is shown. */
const densityStyles: Record<
  Density,
  { header: string; footer: string; button: string; description: string }
> = {
  compact: {
    header: "p-2 sm:p-3",
    footer: "p-1 sm:gap-1 sm:p-1.5",
    button: "h-7 w-7 sm:h-8 sm:w-8",
    description: "line-clamp-1",
  },
  standard: {
    header: "p-3 sm:p-4",
    footer: "p-1.5 sm:gap-1.5 sm:p-2",
    button: "h-7 w-7 sm:h-9 sm:w-9",
    description: "line-clamp-2",
  },
  comfortable: {
    header: "p-4 sm:p-5",
    footer: "p-2 sm:gap-2 sm:p-2.5",
    button: "h-8 w-8 sm:h-10 sm:w-10",
    description: "line-clamp-3",
  },
};

export default function ModuleCard({
  module,
  isDragging,
  density = "standard",
  pinned = false,
  onTogglePin,
  onHide,
  draggable,
  ...props
}: ModuleCardProps) {
  const { deleteModule } = useModules();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { can } = useAuthorization();

  const canEdit = can("Edit", "Module Hub");
  const canDelete = can("Delete", "Module Hub");

  const getHref = (moduleTitle: string) => {
    const slug = moduleTitle.toLowerCase().replace(/\s+/g, "-");
    switch (moduleTitle) {
      case "Subcontractors Management":
        return "/subcontractors-management/all";
      case "Project Management":
        return "/project-management";
      case "Vendor Management":
        return "/vendor-management";
      case "Site Fund Requisition":
        return "/site-fund-requisition-2";
      case "Site Fund Request":
        return "/site-fund-request";
      case "Daily Requisition":
        return "/daily-requisition";
      case "Billing Recon":
        return "/billing-recon";
      case "Bank Balance":
        return "/bank-balance";
      case "Expenses":
        return "/expenses";
      case "Settings":
        return "/settings";
      case "Chat System":
        return "/chat-system";
      case "Loan":
        return "/loan";
      case "Recurring Payments":
        return "/recurring-payments";
      // The slug fallback below would produce "hr-&-recruitment", so this needs naming explicitly.
      case "HR & Recruitment":
        return "/hr";
      // The slug fallback below would produce "tour,-travel-&-expense" (comma and ampersand carried
      // straight through), a URL no route matches, so this needs naming explicitly too.
      case "Tour, Travel & Expense":
        return "/tour-travel";
      case "Letter of Credit Management":
        return "/letter-of-credit";
      case "Bank Guarantee Management":
        return "/bank-guarantee";
      case "Fixed Deposit Management":
        return "/fixed-deposit";
      case "Insurance":
        return "/insurance";
      case "Store & Stock Management":
        return "/store-stock-management";
      case "Vehicle Management":
        return "/vehicle-management";
      case "Driver Management":
        return "/driver-management";
      case "Site Account Statement":
        return "/site-account-statement";
      case "Mail Hub":
        return "/mail";
      // Nested Settings Pages
      // User Management and Role Management no longer have screens of their own — Access Management
      // absorbed both. Their permission nodes stay (roles still hold them, and they still grant the
      // work), so all three titles resolve to the one screen.
      case "User Management":
      case "Role Management":
      case "Access Management":
        return "/settings/access-management";
      case "Serial No. Config":
        return "/settings/serial-no-configuration";
      case "Working Hrs":
        return "/settings/working-hours";
      case "Appearance":
        return "/settings/appearance";
      case "Email Authorization":
        return "/settings/email-authorization";
      case "Login Expiry":
        return "/settings/login-expiry";
      case "Manage Department":
        return "/settings/department";
      case "Manage Project":
        return "/settings/project";
      case "Employee":
        return "/employee";
      // Nested Expenses Settings — these live inside the module, under its own shell and its own
      // Expenses.Settings permissions. The /settings/expenses duplicates they used to point at are gone.
      case "Manage Accounts":
        return "/expenses/settings/accounts";
      case "Department-wise Serial Number":
        return "/expenses/settings/department-serial-no";
      // Nested Insurance Settings
      case "Policy Holders":
        return "/insurance/policy-holders";
      case "Insurance Companies":
        return "/insurance/companies";
      case "Policy Category":
        return "/insurance/settings/policy-category";
      case "Projects and Properties":
        return "/insurance/settings/assets";
      case "Help":
        return "/insurance/settings/help";
      default:
        return `/${slug}`;
    }
  };

  const { Icon: ModuleGlyph, gradient } = getModuleIconEntry(module.icon);
  const styles = densityStyles[density];
  const reorderable = draggable === true || draggable === "true";
  const hasActions = Boolean(onTogglePin || onHide || canEdit || canDelete);

  return (
    <>
      <Card
        className={cn(
          "relative flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
          isDragging
            ? "opacity-30 scale-95 shadow-2xl ring-2 ring-primary"
            : "opacity-100 scale-100",
        )}
        draggable={draggable}
        {...props}
      >
        {/*
          The whole card opens the module, through one link stretched over it — not an <a> wrapped
          around the card, which put the card's buttons inside the link (invalid, and every click on
          them had to be talked out of navigating). The buttons and drag handles are lifted above this
          overlay with `relative z-10`, so they are siblings of the link: clicking one never opens the
          module, and each is its own stop in the tab order. The link is not draggable itself, so a
          drag that starts on it picks up the card rather than the URL.
        */}
        <Link
          href={getHref(module.title)}
          draggable={false}
          className="absolute inset-0 rounded-xl ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="sr-only">Open {module.title}</span>
        </Link>
        <CardHeader
          className={cn(
            "flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:gap-4",
            styles.header,
          )}
        >
          <div className="flex w-full items-center gap-2 sm:contents">
            <div
              className={cn(
                "bg-gradient-to-br p-1.5 sm:p-2 rounded-lg shrink-0 shadow-sm",
                gradient,
              )}
            >
              <ModuleGlyph className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0 sm:hidden">
              <CardTitle className="text-xs font-bold leading-tight truncate">
                {module.title}
              </CardTitle>
            </div>
            {reorderable && (
              <div
                className="relative z-10 ml-auto sm:hidden cursor-grab p-1 text-muted-foreground touch-none"
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:min-w-0">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-bold">
                {module.title}
              </CardTitle>
              <p
                className={cn(
                  "text-sm text-muted-foreground pt-1",
                  styles.description,
                )}
              >
                {module.content}
              </p>
            </div>
            {reorderable && (
              <div className="flex items-center -mr-2 -mt-2 self-start shrink-0">
                <div
                  className="relative z-10 cursor-grab p-2 text-muted-foreground touch-none"
                  aria-label="Drag to reorder"
                >
                  <GripVertical className="h-5 w-5" />
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        {hasActions && (
          <CardContent
            className={cn("mt-auto flex items-center gap-1 border-t", styles.footer)}
          >
            {/* Personal display choices on the left; the Module Hub editor's tools on the right. */}
            <div className="relative z-10 flex items-center gap-1 sm:gap-1.5">
              {onTogglePin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      // One fixed name, with `aria-pressed` carrying the state — a label that
                      // flipped to "Unpin" would be read as "Unpin, pressed".
                      aria-label={`Pin ${module.title}`}
                      aria-pressed={pinned}
                      data-module-control="pin"
                      data-module-title={module.title}
                      className={cn(
                        styles.button,
                        pinned && "bg-accent text-accent-foreground",
                      )}
                      onClick={onTogglePin}
                    >
                      {/* Filled when pinned, so the state is a shape change as well as a colour. */}
                      <Pin
                        className={cn(
                          "h-3.5 w-3.5 sm:h-4 sm:w-4",
                          pinned && "fill-current",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{pinned ? "Unpin" : "Pin to the top"}</TooltipContent>
                </Tooltip>
              )}
              {onHide && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Hide ${module.title} from the launcher`}
                      data-module-control="hide"
                      data-module-title={module.title}
                      className={styles.button}
                      onClick={onHide}
                    >
                      <EyeOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Hide from the launcher</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="relative z-10 ml-auto flex items-center gap-1 sm:gap-1.5">
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={styles.button}
                  onClick={() => setIsEditOpen(true)}
                >
                  <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="sr-only">Edit</span>
                </Button>
              )}
              {canDelete && (
                <AlertDialog>
                  {/* No preventDefault here any more: it was only there to stop the wrapping link,
                      and Radix reads a prevented click as "do not open", so the dialog never did. */}
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        styles.button,
                        "text-destructive hover:bg-destructive/10 hover:text-destructive",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the
                        &ldquo;{module.title}&rdquo; module.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteModule(module.id)}>
                        Continue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        )}
      </Card>
      <EditModuleDialog
        isOpen={isEditOpen}
        onOpenChange={setIsEditOpen}
        module={module}
      />
    </>
  );
}
