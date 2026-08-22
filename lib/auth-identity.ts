export type AuthIdentityInput = {
  id?: string;
  email?: string;
  email_confirmed_at?: string;
};

export type ConfirmedAuthIdentity = {
  externalAuthId: string;
  email: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The provider's identifier for an account, with no claim about confirmation.
 *
 * Resolving an application role needs `confirmedAuthIdentity`. Binding something
 * to the account the provider just authenticated — a single-use password-change
 * grant, for instance — needs only this: an invited user is completing
 * confirmation at that very moment, and demanding it first would break the
 * invitation it is meant to protect.
 */
export function authIdentityId(user: AuthIdentityInput | null | undefined): string | null {
  const externalAuthId = user?.id?.trim();
  return externalAuthId && UUID_PATTERN.test(externalAuthId) ? externalAuthId : null;
}

export function confirmedAuthIdentity(user: AuthIdentityInput | null | undefined): ConfirmedAuthIdentity | null {
  const externalAuthId = authIdentityId(user);
  const email = user?.email?.trim().toLowerCase();
  if (!externalAuthId) return null;
  if (!email || email.length > 254 || !user?.email_confirmed_at) return null;
  return { externalAuthId, email };
}
