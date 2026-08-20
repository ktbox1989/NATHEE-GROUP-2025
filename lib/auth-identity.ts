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

export function confirmedAuthIdentity(user: AuthIdentityInput | null | undefined): ConfirmedAuthIdentity | null {
  const externalAuthId = user?.id?.trim();
  const email = user?.email?.trim().toLowerCase();
  if (!externalAuthId || !UUID_PATTERN.test(externalAuthId)) return null;
  if (!email || email.length > 254 || !user?.email_confirmed_at) return null;
  return { externalAuthId, email };
}
