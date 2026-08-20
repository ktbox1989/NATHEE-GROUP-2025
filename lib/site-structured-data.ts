import type { SiteSettings } from "@/lib/site-settings-content";

export function siteOrganizationSchema(settings: SiteSettings) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.brand.legalName,
    alternateName: settings.brand.name,
    url: "https://natheegroup2025.com/",
    telephone: [settings.contact.primaryPhone, settings.contact.secondaryPhone].filter(Boolean),
  };
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
