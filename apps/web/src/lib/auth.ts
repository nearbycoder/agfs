import { mcp } from "@better-auth/mcp";
import { jwt } from "better-auth/plugins";
import { requestContext } from "./request-context";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import {
  accounts,
  sessions,
  users,
  verifications,
  oauthSchema,
} from "@agfs/db";
import { db } from "./db";
import { requireStringBindings } from "./bindings";

const bindings = requireStringBindings(
  "APP_URL",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
);

function createAuth() {
  return betterAuth({
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
        ...oauthSchema,
      },
    }),
    socialProviders: {
      github: {
        clientId: bindings.GITHUB_CLIENT_ID,
        clientSecret: bindings.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/oauth/consent",
        consentPage: "/oauth/consent",
        resource: bindings.APP_URL + "/mcp",
        scopes: [
          "openid",
          "profile",
          "offline_access",
          "agfs:read",
          "agfs:write",
          "agfs:delete",
          "agfs:share",
        ],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        postLogin: {
          page: "/oauth/consent",
          shouldRedirect: () => !requestContext.getStore()?.oauthGrantId,
          consentReferenceId: () => requestContext.getStore()?.oauthGrantId,
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user || !referenceId)
            throw new Error("An approved AGFS connection is required");
          const grant = await (
            await import("./oauth")
          ).oauthGrant(referenceId, user.id);
          // Membership and current role are checked again on every resource request.
          return { agfs_grant: grant.id };
        },
      }),
      tanstackStartCookies(),
    ],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
// Plugin initialization performs D1 I/O; defer it until a request accesses auth.
export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, key) {
    return Reflect.get((instance ??= createAuth()), key);
  },
});
