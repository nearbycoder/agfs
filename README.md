![AGFS screenshot](./readme.png)

# agfs.dev

AgentFilesystem is a Cloudflare-native file manager for humans and agents.

## Workspace

- `apps/web`: TanStack Start app deployed to Cloudflare Workers
- `packages/contracts`: shared Zod API contracts
- `packages/db`: Drizzle schema, helpers, and SQL migrations
- `packages/cli`: Node CLI for login and filesystem management

## Planned setup

1. Install dependencies with `pnpm install`
2. Configure secrets for GitHub OAuth
3. Run `pnpm --filter @agfs/web cf-typegen`
4. Run `pnpm dev`

`pnpm dev` now auto-applies local D1 migrations before the TanStack Start worker boots, so the Better Auth and AGFS tables stay in sync with local development.

## Environment

Copy `.env.example` into your local secret manager or Worker secret setup and provide:

- `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Optional: `PAID_PLAN_EMAILS` as a comma-delimited list for accounts that should resolve to the paid plan
- `R2_BUCKET_NAME` (non-secret; supplied by Wrangler)
- `APP_URL`

For local Cloudflare development, put Worker secrets in `apps/web/.dev.vars.example` as `apps/web/.dev.vars`. `wrangler.jsonc` already supplies `APP_URL` and `R2_BUCKET_NAME` as non-secret vars.

`PAID_PLAN_EMAILS` is optional. If set, each comma-delimited email in the list is normalized and granted the paid storage plan.

Uploads use a same-origin Worker endpoint backed by `FILES_BUCKET`, with create-only writes, exact Content-Length checks, and a 100 MB per-file limit. Pending uploads reserve storage and expire after 15 minutes; abandoned objects are cleaned when the owner requests another upload. R2 S3 credentials are no longer used. Shared files download as attachments with sandbox and no-cache headers.

## Useful commands

- `pnpm dev`: start the TanStack Start app locally
- `pnpm d1:migrate:local`: apply the full AGFS + Better Auth schema to the local D1 database
- `pnpm d1:migrate:remote`: apply the production D1 schema to Cloudflare
- `pnpm r2:cors`: apply the production R2 CORS policy
- `pnpm deploy:production`: build and deploy the production Worker to `agfs.dev`
- `pnpm check`: run TypeScript checks across the workspace
- `pnpm test`: run unit tests
- `pnpm --filter @agfs/web cf-typegen`: generate local Cloudflare binding types

## Cloudflare resources

- One D1 database named `agfs-db` bound as `DB`
- One R2 bucket named `agfs-files` bound as `FILES_BUCKET`
- Worker upload capabilities hashed in D1; R2 access through the bucket binding

The repository is now wired to the live D1 database ID `e40aac3b-5468-468c-b110-ac6a6ca4cece` and a dedicated Wrangler `production` environment that deploys to the custom domain `agfs.dev`.

## Production deploy checklist

1. Create a production GitHub OAuth app with:
   - Homepage URL: `https://agfs.dev`
   - Authorization callback URL: `https://agfs.dev/api/auth/callback/github`
2. Confirm the `FILES_BUCKET` binding points to `agfs-files`; an S3 API token is not required.
3. Set the production Worker secrets:

   ```bash
   pnpm --filter @agfs/web exec wrangler secret put BETTER_AUTH_SECRET --env production
   pnpm --filter @agfs/web exec wrangler secret put GITHUB_CLIENT_ID --env production
   pnpm --filter @agfs/web exec wrangler secret put GITHUB_CLIENT_SECRET --env production
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

## Security verification

Run `pnpm security:check` to audit dependencies, run regression tests, build, and typecheck the workspace. Production builds also run the workspace tests before compiling. Dependabot checks npm workspace dependencies weekly.

The September 2026 review and deployment verification are documented in [SECURITY-AUDIT.md](./SECURITY-AUDIT.md). `scripts/security-smoke.mjs` runs only against localhost:8787 and expects disposable local users `alice` and `bob` with API tokens `agfs_local_test_alice` and `agfs_local_test_bob`. Never seed these fixtures in production.
