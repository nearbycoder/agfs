import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { accounts, sessions, users, verifications } from "@agfs/db";
import { db } from "./db";
import { requireStringBindings } from "./bindings";

const bindings = requireStringBindings("APP_URL", "BETTER_AUTH_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");

export const auth = betterAuth({
  appName: "AgentFilesystem",
  baseURL: bindings.APP_URL,
  secret: bindings.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      account: accounts,
      session: sessions,
      user: users,
      verification: verifications,
    },
  }),
  socialProviders: {
    github: {
      clientId: bindings.GITHUB_CLIENT_ID,
      clientSecret: bindings.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [tanstackStartCookies()],
});
