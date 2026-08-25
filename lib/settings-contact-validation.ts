import { parseSiteSettings, type SiteSettings } from "./site-settings-content.ts";

/**
 * What the settings editor checks before it submits, and how it names the
 * field that is wrong.
 *
 * The save route answers a bad document with one code — `invalid_settings` —
 * which is the right shape for a validator and a poor one for an editor: it
 * does not say which box to look at, and an Owner who mistyped an email address
 * is told their brand name might be wrong.
 *
 * Rather than copy the patterns into the UI, where they would be a second set
 * of rules that agree until one is edited, the server's own `parseSiteSettings`
 * is asked repeatedly: clear one optional field, ask again, and the field whose
 * removal makes the document valid is the field that is wrong. Bounded to the
 * four optional contact fields, so it is four extra parses of a small object.
 */

export const OPTIONAL_CONTACT_FIELDS = [
  { key: "email", label: "อีเมล" },
  { key: "lineId", label: "LINE ID" },
  { key: "addressLines", label: "ที่อยู่" },
  { key: "lineQrItemId", label: "QR Code LINE" },
] as const;

export const MAX_ADDRESS_LINES = 4;

/**
 * Blank address lines removed.
 *
 * The editor renders four boxes so a line can be added in the middle; a gap
 * left between two filled lines must not become a stored empty line. The server
 * drops them too — this keeps what is submitted equal to what is stored, so the
 * revision hash does not change for a difference nobody made.
 */
export function withBlankAddressLinesRemoved(settings: SiteSettings): SiteSettings {
  return {
    ...settings,
    contact: { ...settings.contact, addressLines: settings.contact.addressLines.filter((line) => line.trim()) },
  };
}

/**
 * The label of the optional contact field the server would refuse, or null.
 *
 * Null when the document is valid, and also when it is invalid for a reason
 * that is not one of these four — the caller then falls back to a general
 * message rather than blaming a field that is fine.
 */
export function offendingContactField(settings: SiteSettings): string | null {
  if (parseSiteSettings(settings)) return null;
  for (const field of OPTIONAL_CONTACT_FIELDS) {
    const candidate: SiteSettings = {
      ...settings,
      contact: { ...settings.contact, [field.key]: field.key === "addressLines" ? [] : "" },
    };
    if (parseSiteSettings(candidate)) return field.label;
  }
  return null;
}
