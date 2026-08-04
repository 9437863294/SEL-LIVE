import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Vendor Management | SEL Live",
  description: "Manage vendors and purchase orders in SEL Live.",
};

export default function VendorManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
