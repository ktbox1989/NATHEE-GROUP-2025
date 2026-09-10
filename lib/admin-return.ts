import { safeReturnTo } from "./safe-return-to.ts";

/**
 * Where a mutation's success or failure notice should send the browser back to.
 *
 * The original back office posts to these endpoints from `/app/...` and expects
 * to land back there; the plain-form back office at `/admin/...` sends a
 * `returnTo` field so its pages work without a single line of client script.
 * Only `/admin` origins are honoured — anything else (including a missing
 * field) keeps the endpoint's long-standing default, so existing callers see
 * exactly the behaviour they always did.
 */
export function adminReturnTarget(form: FormData, fallback: string): string {
  const raw = form.get("returnTo");
  if (typeof raw !== "string" || !raw.startsWith("/admin")) return fallback;
  return safeReturnTo(raw) === "/app" ? fallback : safeReturnTo(raw);
}
