export const CONTAINER_PAGE_SIZE = 50;

const letterValues: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function normalizeContainerNumber(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(normalized)) return null;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = normalized[index];
    const numeric = index < 4 ? letterValues[character] : Number(character);
    sum += numeric * (2 ** index);
  }
  const expectedCheckDigit = (sum % 11) % 10;
  return Number(normalized[10]) === expectedCheckDigit ? normalized : null;
}

export function normalizeContainerText(value: string, maxLength = 100): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : undefined;
}
