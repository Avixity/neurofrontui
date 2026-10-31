import {
  createClient,
  type AuthChangeEvent,
  type Provider,
  type Session,
} from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const limitedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(20_000),
    ]),
  });
export function configuredAuthClient(endpoint?: string, publicKey?: string) {
  if (!endpoint?.trim() || !publicKey?.trim()) return null;
  try {
    const parsed = new URL(endpoint);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return createClient(endpoint, publicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
      global: { fetch: limitedFetch },
    });
  } catch {
    return null;
  }
}
export const authClient = configuredAuthClient(url, key);
export const cloudConfigured = Boolean(authClient);
const blockedAccounts = new Set<string>();
const accountRequests = new Map<string, Set<Promise<Response>>>();

export class CloudError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

export function requireClient() {
  if (!authClient)
    throw new CloudError(
      "cloud_unavailable",
      "Account storage has not been configured. Your local measurements are available.",
    );
  return authClient;
}

export async function getSession(): Promise<Session | null> {
  if (!authClient) return null;
  const { data, error } = await authClient.auth.getSession();
  if (error) throw new CloudError(error.code || "auth_error", error.message);
  return data.session;
}

export async function accountClient() {
  requireClient();
  const session = await getSession();
  if (!session)
    throw new CloudError(
      "authentication_required",
      "Sign in to use account storage.",
    );
  if (blockedAccounts.has(session.user.id))
    throw new CloudError("account_busy", "Account deletion is in progress.");
  // Every operation retains its initiating JWT, even if the shared auth session changes.
  const db = createClient(url!, key!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
      fetch: async (input, init) => {
        const id = session.user.id;
        if (blockedAccounts.has(id))
          throw new CloudError(
            "account_busy",
            "Account deletion is in progress.",
          );
        const pending = accountRequests.get(id) || new Set<Promise<Response>>();
        accountRequests.set(id, pending);
        const request = limitedFetch(input, init);
        pending.add(request);
        try {
          return await request;
        } finally {
          pending.delete(request);
          if (!pending.size) accountRequests.delete(id);
        }
      },
    },
  });
  return { db, user: session.user, session };
}

export async function accountDeletionBarrier(userId: string) {
  if (blockedAccounts.has(userId))
    throw new CloudError(
      "account_busy",
      "Account deletion is already in progress.",
    );
  blockedAccounts.add(userId);
  await Promise.allSettled([...(accountRequests.get(userId) || [])]);
  return () => blockedAccounts.delete(userId);
}

export function subscribeAuth(
  callback: (session: Session | null, event?: AuthChangeEvent) => void,
) {
  if (!authClient) return () => {};
  const { data } = authClient.auth.onAuthStateChange((event, session) =>
    callback(session, event),
  );
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const { data, error } = await requireClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
  return data;
}

export async function signUp(
  email: string,
  password: string,
  displayName = "",
) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName.slice(0, 80) },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
  return data;
}

export async function recover(email: string) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/?auth=recovery`,
  });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
}

export async function updatePassword(password: string) {
  const { error } = await requireClient().auth.updateUser({ password });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut({ scope: "local" });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
}

export function providerEnabled(provider: Provider = "google") {
  return (
    cloudConfigured &&
    provider === "google" &&
    import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true"
  );
}

export async function signInWithProvider(provider: Provider = "google") {
  if (!providerEnabled(provider))
    throw new CloudError(
      "provider_unavailable",
      "This sign-in provider is not configured.",
    );
  const { data, error } = await requireClient().auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new CloudError(error.code || "auth_error", error.message);
  return data;
}
