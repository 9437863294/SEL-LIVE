"use client";

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  BG_COLLECTIONS,
  BG_SETTINGS_PATH,
  DEFAULT_BG_SETTINGS,
  type BGSettings,
} from "@/lib/bank-guarantee";

export const bgSettingsReference = (organizationId: string) =>
  doc(db, BG_COLLECTIONS.settings, organizationId || "default");

/**
 * Settings used to live in a single global document. Read it as a fallback so
 * existing installations migrate without losing their controls, while all new
 * writes are isolated by organization.
 */
export async function loadBGSettings(
  organizationId: string,
): Promise<BGSettings> {
  const organizationRef = bgSettingsReference(organizationId);
  const organizationSnapshot = await getDoc(organizationRef);
  if (organizationSnapshot.exists()) {
    return {
      ...DEFAULT_BG_SETTINGS,
      ...organizationSnapshot.data(),
      organizationId,
    } as BGSettings;
  }

  const legacySnapshot = await getDoc(doc(db, ...BG_SETTINGS_PATH));
  return {
    ...DEFAULT_BG_SETTINGS,
    ...(legacySnapshot.exists() ? legacySnapshot.data() : {}),
    organizationId,
  } as BGSettings;
}
