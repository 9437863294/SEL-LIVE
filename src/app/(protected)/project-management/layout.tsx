import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Project Management | SEL Live",
  description: "Plan and manage projects in SEL Live.",
};

export default function ProjectManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
