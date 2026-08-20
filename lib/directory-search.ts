export const DIRECTORY_PAGE_SIZE = 50;

export function normalizeDirectorySearch(value: string): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  const hasWildcard = ["%", "_", "*", "?", "[", "]", "\\"].some((character) => normalized.includes(character));
  if (normalized.length < 2 || normalized.length > 80 || hasControlCharacter || hasWildcard) return undefined;
  return normalized;
}

export function parseCreatedCursor(createdAt?: string, id?: string): { createdAt: string; id: string } | undefined | null {
  if (!createdAt && !id) return undefined;
  if (!createdAt || !id || id.length > 100 || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}
