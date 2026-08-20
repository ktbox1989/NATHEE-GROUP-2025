export function safeReturnTo(value: FormDataEntryValue | string | null): string {
  const candidate = typeof value === "string" ? value : null;
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return "/app";
  }

  const base = new URL("https://nathee.invalid");
  const resolved = new URL(candidate, base);
  if (resolved.origin !== base.origin) return "/app";

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
