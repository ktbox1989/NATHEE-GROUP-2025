import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { requireSupabaseConfig } from "./config";

type ResponseWithCookies = {
  cookies: {
    set: (name: string, value: string, options?: Record<string, unknown>) => unknown;
  };
  headers: Headers;
};

export function createSupabaseRouteClient(request: NextRequest) {
  const { url, publishableKey } = requireSupabaseConfig();
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];
  const pendingHeaders = new Headers();

  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        pendingCookies.push(...cookiesToSet);
        Object.entries(headersToSet).forEach(([key, value]) =>
          pendingHeaders.set(key, value),
        );
      },
    },
  });

  function applyAuthCookies<T extends ResponseWithCookies>(response: T): T {
    pendingCookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    pendingHeaders.forEach((value, key) => response.headers.set(key, value));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return { client, applyAuthCookies };
}
