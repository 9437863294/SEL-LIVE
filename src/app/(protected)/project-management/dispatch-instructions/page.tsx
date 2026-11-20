"use client";

/**
 * The Dispatch Instructions landing screen.
 *
 * A wrapper over the shared supply-gate hub: MDCC, DI and GRN differ in vocabulary rather than
 * behaviour, so the stage definition supplies the wording and the shared component supplies the
 * figures. See project-management-supply-ledger.ts for the quantity rules.
 */

import { SupplyDocumentHub } from "@/components/project-management/supply-document-hub";

export default function DispatchInstructionsHubPage() {
  return <SupplyDocumentHub stage="di" />;
}
