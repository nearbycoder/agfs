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
- `pnpm d1:migrate:remote`: apply the production D1 schema to Cloudflare
- `pnpm r2:cors`: apply the production R2 CORS policy
- `pnpm deploy:production`: build and deploy the production Worker to `agfs.dev`
- `pnpm check`: run TypeScript checks across the workspace
- `pnpm test`: run unit tests
- `pnpm --filter @agfs/web cf-typegen`: generate local Cloudflare binding types

## Cloudflare resources

- One D1 database named `agfs-db` bound as `DB`
- One R2 bucket named `agfs-files` bound as `FILES_BUCKET`
- R2 S3 API credentials stored as Worker secrets for presigned uploads

The repository is now wired to the live D1 database ID `e40aac3b-5468-468c-b110-ac6a6ca4cece` and a dedicated Wrangler `production` environment that deploys to the custom domain `agfs.dev`.

## Production deploy checklist

1. Create a production GitHub OAuth app with:
   - Homepage URL: `https://agfs.dev`
   - Authorization callback URL: `https://agfs.dev/api/auth/callback/github`
2. In the Cloudflare dashboard, create an R2 API token with Object Read & Write access for `agfs-files`. Copy the Access Key ID and Secret Access Key once.
3. Set the production Worker secrets:

   ```bash
   pnpm --filter @agfs/web exec wrangler secret put BETTER_AUTH_SECRET --env production
   pnpm --filter @agfs/web exec wrangler secret put GITHUB_CLIENT_ID --env production
   pnpm --filter @agfs/web exec wrangler secret put GITHUB_CLIENT_SECRET --env production
   pnpm --filter @agfs/web exec wrangler secret put R2_ACCOUNT_ID --env production
   pnpm --filter @agfs/web exec wrangler secret put R2_ACCESS_KEY_ID --env production
   pnpm --filter @agfs/web exec wrangler secret put R2_SECRET_ACCESS_KEY --env production
   ```

4. Apply the R2 CORS policy:

   ```bash
   pnpm r2:cors
   ```

5. Apply database migrations:

   ```bash
   pnpm d1:migrate:remote
   ```

6. Deploy the Worker:

   ```bash
   pnpm deploy:production
   ```

7. Smoke test:
   - Sign in with GitHub at `https://agfs.dev`
   - Upload a file in the web app
   - Create a share link and open it in a private window
   - Run `AGFS_BASE_URL=https://agfs.dev agfs whoami`
   - Run `AGFS_BASE_URL=https://agfs.dev agfs upload ./shot.png /screenshots/shot.png --share 15m`

## Cloudflare Git deploys

Production deploys now come from Cloudflare's Git integration in the Cloudflare dashboard.

Recommended settings for this repository:

- Worker / project: `agfs-dev-production`
- Git repository: `nearbycoder/agfs`
- Production branch: `main`
- Root directory: repository root
- Build command: `pnpm --dir apps/web run build:production`
- Deploy command: `pnpm --dir apps/web exec wrangler deploy --env production`

Optional watch paths that fit this monorepo well:

- `apps/web/**`
- `packages/**`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`

If Cloudflare enables preview builds for non-production branches and asks for a preview deploy command, use:

```bash
pnpm --dir apps/web exec wrangler versions upload --env production
```

The production app secrets still live in Cloudflare, not GitHub:

- `BETTER_AUTH_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
