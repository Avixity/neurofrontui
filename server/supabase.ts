import { createClient } from "@supabase/supabase-js";
import type { ServerConfig } from "./config.js";
import { HttpError } from "./http.js";

const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(10_000),
    ]),
  });
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: boundedFetch },
};
export function serviceClient(config: ServerConfig) {
  if (!config.supabaseUrl || !config.serviceKey)
    throw new HttpError(
      503,
      "cloud_unavailable",
      "Account services are not configured.",
    );
  return createClient(config.supabaseUrl, config.serviceKey, options);
}
export async function verifiedAccount(request: Request, config: ServerConfig) {
  const authorization = request.headers.get("authorization") || "";
  if (
    !/^Bearer [A-Za-z0-9._-]+$/.test(authorization) ||
    authorization.length > 8192
  ) {
    throw new HttpError(
      401,
      "authentication_required",
      "Sign in again to continue.",
    );
  }
  if (!config.supabaseUrl || !config.publicKey)
    throw new HttpError(
      503,
      "cloud_unavailable",
      "Account services are not configured.",
    );
  const token = authorization.slice(7);
  const client = createClient(config.supabaseUrl, config.publicKey, {
    ...options,
    global: { ...options.global, headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error && (!error.status || error.status >= 500))
    throw new HttpError(
      503,
      "cloud_unavailable",
      "Account verification is temporarily unavailable.",
    );
  if (error || !data.user)
    throw new HttpError(
      401,
      "authentication_required",
      "Sign in again to continue.",
    );
  return { user: data.user, client };
}
