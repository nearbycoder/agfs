import { env } from "cloudflare:workers";

export interface AppBindings {
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  PAID_PLAN_EMAILS?: string;
  R2_ACCESS_KEY_ID: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_SECRET_ACCESS_KEY: string;
}

type StringBindingKey = Exclude<keyof AppBindings, "DB" | "FILES_BUCKET">;
type ResourceBindingKey = Extract<keyof AppBindings, "DB" | "FILES_BUCKET">;

export function getBindings(): Partial<AppBindings> {
  return env as Partial<AppBindings>;
}

export function requireStringBindings<const Keys extends readonly StringBindingKey[]>(
  ...keys: Keys
): Pick<AppBindings, Keys[number]> {
  const bindings = getBindings();
  const missing = keys.filter((key) => {
    const value = bindings[key];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing Cloudflare binding(s): ${missing.join(", ")}. For local dev, create apps/web/.dev.vars with these values.`,
    );
  }

  return bindings as Pick<AppBindings, Keys[number]>;
}

export function requireResourceBindings<const Keys extends readonly ResourceBindingKey[]>(
  ...keys: Keys
): Pick<AppBindings, Keys[number]> {
  const bindings = getBindings();
  const missing = keys.filter((key) => !bindings[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Cloudflare resource binding(s): ${missing.join(", ")}.`);
  }

  return bindings as Pick<AppBindings, Keys[number]>;
}
