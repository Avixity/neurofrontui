import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "./config";
import { verifiedAccount } from "./supabase";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("account identity verification and operation binding", () => {
  it("isolates malformed cloud setup so the guest application can still initialize", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "not a project URL");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");
    const auth = await import("../src/services/auth");
    expect(auth.cloudConfigured).toBe(false);
    expect(auth.authClient).toBeNull();
    expect(() =>
      auth.configuredAuthClient("not a project URL", "public-key"),
    ).not.toThrow();
    expect(
      auth.configuredAuthClient("not a project URL", "public-key"),
    ).toBeNull();
    expect(
      auth.configuredAuthClient("ftp://example.com", "public-key"),
    ).toBeNull();
    expect(
      auth.configuredAuthClient("https://test.supabase.co", " "),
    ).toBeNull();
  });
  it("asks Supabase Auth to verify the bearer token and rejects its rejection", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: "bad_jwt", message: "Invalid JWT" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", transport);
    const config = {
      ...readConfig({}),
      supabaseUrl: "https://test.supabase.co",
      publicKey: "test-public-key",
    };
    await expect(
      verifiedAccount(
        new Request("https://dashboard.example/api/account", {
          headers: { Authorization: "Bearer unverified.token.signature" },
        }),
        config,
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(String(transport.mock.calls[0][0])).toBe(
      "https://test.supabase.co/auth/v1/user",
    );
    expect(
      new Headers(transport.mock.calls[0][1].headers).get("Authorization"),
    ).toBe("Bearer unverified.token.signature");
  });
  it("keeps a database write on the initiating token after the shared session switches", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
    const auth = await import("../src/services/auth");
    const session = (id: string, token: string) => ({
      access_token: token,
      refresh_token: "refresh",
      token_type: "bearer" as const,
      expires_in: 3600,
      user: {
        id,
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-11-01",
      },
    });
    const current = vi.spyOn(auth.authClient!.auth, "getSession");
    current.mockResolvedValue({
      data: { session: session("account-a", "token-a") },
      error: null,
    });
    const bound = await auth.accountClient();
    current.mockResolvedValue({
      data: { session: session("account-b", "token-b") },
      error: null,
    });
    const transport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "saved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", transport);
    await bound.db.rpc("save_capture", {
      p_capture: { id: "captured-before-switch" },
    });
    expect(bound.user.id).toBe("account-a");
    expect(
      new Headers(transport.mock.calls[0][1].headers).get("Authorization"),
    ).toBe("Bearer token-a");
    expect((await auth.getSession())?.user.id).toBe("account-b");
  });
  it("waits for in-flight cloud writes and blocks new operations during account deletion", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
    const auth = await import("../src/services/auth");
    vi.spyOn(auth.authClient!.auth, "getSession").mockResolvedValue({
      data: {
        session: {
          access_token: "token-a",
          refresh_token: "refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: "account-a",
            app_metadata: {},
            user_metadata: {},
            aud: "authenticated",
            created_at: "2026-11-01",
          },
        },
      },
      error: null,
    });
    let finish!: (response: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", transport);
    const bound = await auth.accountClient();
    const writing = Promise.resolve(bound.db.rpc("save_capture", {}));
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    let settled = false;
    const barrier = auth.accountDeletionBarrier("account-a").then((release) => {
      settled = true;
      return release;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(auth.accountClient()).rejects.toMatchObject({
      code: "account_busy",
    });
    finish(
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    await writing;
    const release = await barrier;
    expect(settled).toBe(true);
    release();
    await expect(auth.accountClient()).resolves.toHaveProperty(
      "user.id",
      "account-a",
    );
  });
});
