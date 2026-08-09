# CI/CD

Every push and pull request runs the checks in [ci.yml](../.github/workflows/ci.yml): formatting, ESLint, TypeScript, Vitest, a production build, Supabase migration validation, database tests, and a Chromium Playwright test.

## Enable production deployment

Deployment is intentionally off until the repository owner enables it. This prevents an accidental push from changing production.

1. In GitHub, create a protected `production` Environment and add any required reviewers.
2. Add these Environment secrets:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_ID` (the Supabase project reference)
   - `SUPABASE_DB_PASSWORD`
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
3. Add repository variable `DEPLOY_ENABLED` with value `true`.

After that, a successful push to `master` or a manually started `master` workflow first applies Supabase migrations and then deploys the Vite build to Vercel. Turn the variable back to any other value to pause deployment without deleting the workflow.

Before the first production deployment, take a Supabase backup and confirm the target project reference. The database migration is irreversible once applied to production.
