# agfs.dev

AgentFilesystem is a Cloudflare-native file manager for humans and agents.

## Workspace

- `apps/web`: TanStack Start app deployed to Cloudflare Workers
- `packages/contracts`: shared Zod API contracts
- `packages/db`: Drizzle schema, helpers, and SQL migrations
- `packages/cli`: Node CLI for login and filesystem management

## Planned setup

1. Install dependencies with `pnpm install`
2. Configure secrets for GitHub OAuth and R2 presigning
3. Run `pnpm --filter @agfs/web d1:migrate:local`
4. Run `pnpm --filter @agfs/web cf-typegen`
5. Run `pnpm dev`

## Environment

Copy `.env.example` into your local secret manager or Worker secret setup and provide:

- `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `APP_URL`

For local Cloudflare development, put Worker secrets in `apps/web/.dev.vars.example` as `apps/web/.dev.vars`. `wrangler.jsonc` already supplies `APP_URL` and `R2_BUCKET_NAME` as non-secret vars.

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are optional for local development now. If they are missing, AGFS falls back to a same-origin Worker upload endpoint backed by the local `FILES_BUCKET` binding instead of generating presigned R2 upload URLs.

## Useful commands

- `pnpm dev`: start the TanStack Start app locally
- `pnpm --filter @agfs/web d1:migrate:local`: apply the full AGFS + Better Auth schema to the local D1 database
- `pnpm check`: run TypeScript checks across the workspace
- `pnpm test`: run unit tests
- `pnpm --filter @agfs/web cf-typegen`: generate local Cloudflare binding types

## Cloudflare resources

- One D1 database bound as `DB`
- One R2 bucket bound as `FILES_BUCKET`
- R2 S3 API credentials stored as Worker secrets for presigned uploads
