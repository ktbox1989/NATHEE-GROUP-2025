/**
 * The client address a security control is allowed to trust.
 *
 * Only `CF-Connecting-IP` is read. The Cloudflare edge overwrites that header on
 * every request, so a caller cannot choose its own value; `X-Forwarded-For` is
 * appended to and is attacker-controlled, and using it would let one client mint
 * an unlimited number of throttle buckets.
 *
 * Callers must treat `null` as "no trusted address", never as "no client".
 */
export function trustedClientAddress(headers: Headers): string | null {
  const value = headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  return isIpAddress(value) ? value : null;
}

export function isIpAddress(value: string): boolean {
  return isIpv4Address(value) || isIpv6Address(value);
}

export function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^[0-9]{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

export function isIpv6Address(value: string): boolean {
  if (value.length > 45 || !/^[0-9a-f:.]+$/.test(value)) return false;

  const compressed = value.split("::");
  if (compressed.length > 2) return false;

  const head = compressed[0] ? compressed[0].split(":") : [];
  const tail = compressed.length === 2 && compressed[1] ? compressed[1].split(":") : [];
  const groups = [...head, ...tail];

  // A trailing dotted-quad stands for the final two groups (::ffff:203.0.113.7).
  let groupCount = groups.length;
  const last = groups.at(-1);
  if (last !== undefined && last.includes(".")) {
    if (!isIpv4Address(last)) return false;
    groupCount += 1;
  }

  const hexGroups = last !== undefined && last.includes(".") ? groups.slice(0, -1) : groups;
  if (!hexGroups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return false;

  return compressed.length === 2 ? groupCount <= 7 : groupCount === 8;
}
