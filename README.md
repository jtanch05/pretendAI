# Are u Human?

The initial walking skeleton for Are u Human?. A visitor confirms they are at least 13, signs in with Supabase Anonymous Auth, receives one server-authoritative starter credit, and returns to the same balance on the same browser.

## Run locally

1. Create a Supabase project and enable **Anonymous sign-ins** in Authentication.
2. Apply `supabase/migrations/20260807000000_initial_player.sql` through the Supabase CLI or SQL Editor.
3. Copy `.env.example` to `.env.local` and provide the project URL and publishable key. Never use a service-role key in the browser.
4. Install and run:

   ```sh
   pnpm install
   pnpm dev
   ```

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
```

The database function is intentionally idempotent: a profile insert and matching starter-credit ledger entry occur only for the first authenticated anonymous identity. Later calls return the stored authoritative balance.
