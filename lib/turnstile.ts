const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const QUOTATION_TURNSTILE_ACTION = "quotation";
const TOKEN_MAX_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 5000;

type TurnstileResponse = {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
};

type VerifyInput = {
  token: string;
  remoteIp: string | null;
  idempotencyKey: string;
  expectedHostname: string;
  secretKey?: string;
  fetcher?: typeof fetch;
};

export function turnstileKeysReady(siteKey: string | undefined, secretKey: string | undefined): boolean {
  return validTurnstileKey(siteKey) && validTurnstileKey(secretKey);
}

export function getTurnstileWidgetSiteKey(): string | null {
  return turnstileKeysReady(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY)
    ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!.trim()
    : null;
}

export function isTurnstileConfigured(): boolean {
  return turnstileKeysReady(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY);
}

export function validTurnstileVerification(payload: unknown, expectedHostname: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const response = payload as TurnstileResponse;
  return response.success === true && response.hostname === expectedHostname && response.action === QUOTATION_TURNSTILE_ACTION;
}

export async function verifyTurnstile(input: VerifyInput): Promise<boolean> {
  const secretKey = input.secretKey ?? process.env.TURNSTILE_SECRET_KEY;
  const token = input.token.trim();
  if (!validTurnstileKey(secretKey) || !token || token.length > TOKEN_MAX_LENGTH || !isUuid(input.idempotencyKey) || !isHostname(input.expectedHostname)) return false;
  const fetcher = input.fetcher ?? fetch;
  const payload = new URLSearchParams({
    secret: secretKey!.trim(),
    response: token,
    idempotency_key: input.idempotencyKey,
  });
  if (input.remoteIp && safeIp(input.remoteIp)) payload.set("remoteip", input.remoteIp);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        return false;
      }
      return validTurnstileVerification(await response.json(), input.expectedHostname);
    } catch {
      if (attempt === 1) return false;
    }
  }
  return false;
}

export function turnstileRemoteIp(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return safeIp(normalized) ? normalized : null;
}

function validTurnstileKey(value: string | undefined): boolean {
  return /^[0-9]x[A-Za-z0-9_-]{20,100}$/.test(value?.trim() ?? "");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHostname(value: string): boolean {
  return value.length >= 1 && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function safeIp(value: string): boolean {
  return value.length >= 3 && value.length <= 64 && /^[0-9a-f:.]+$/i.test(value);
}
