import type { Metadata } from "next";
import type { ReactNode } from "react";
import ProjectManagementBottomNav from "@/components/project-management/bottom-nav";

export const metadata: Metadata = {
  title: "Project Management | SEL Live",
  description: "Plan and manage projects in SEL Live.",
};

export default function ProjectManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      {children}
      {/* Phones only: the module's screens each bring their own chrome, so the bar that ties them
          together lives here, after whichever page is showing. */}
      <ProjectManagementBottomNav />
    </>
  );
}
