import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/infrastructure/db/client";
import { getAuthConfiguration, type AuthEnvironment } from "./auth-config";

export function createAuth(env: AuthEnvironment, db = getDb()) {
  const config = getAuthConfiguration(env);

  return betterAuth({
    baseURL: config.baseURL,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: config.secret,
    account: {
      encryptOAuthTokens: true,
    },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    plugins: [nextCookies()],
  });
}

export function getAuth() {
  const { env } = getCloudflareContext();
  return createAuth(env as AuthEnvironment);
}
