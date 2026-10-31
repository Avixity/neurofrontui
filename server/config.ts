export type ServerConfig = {
  supabaseUrl: string;
  publicKey: string;
  serviceKey: string;
  model: string;
  gatewayReady: boolean;
  signingSecret: string;
  production: boolean;
  trustedVercelProxy: boolean;
  appOrigin: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL || "",
    publicKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "",
    serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
    model: env.ASSISTANT_MODEL || "",
    gatewayReady: Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
    signingSecret: env.ASSISTANT_SIGNING_SECRET || "",
    production: env.NODE_ENV === "production",
    trustedVercelProxy: env.VERCEL === "1",
    appOrigin: env.APP_ORIGIN || "",
  };
}

export function cloudConfigured(config: ServerConfig) {
  return Boolean(config.supabaseUrl && config.publicKey);
}

export function assistantConfigured(config: ServerConfig) {
  return (
    cloudConfigured(config) &&
    Boolean(
      config.serviceKey &&
      config.model &&
      config.gatewayReady &&
      config.signingSecret.length >= 32,
    )
  );
}
