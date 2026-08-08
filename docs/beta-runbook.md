# Controlled public-beta runbook

## Environments

Support the latest stable Chrome, Edge, Firefox, and Safari on desktop and mobile. Test Malaysia production plus localhost (explicitly allow localhost in Turnstile for development).

## Before opening access

- Enable anonymous sign-in and Cloudflare Turnstile CAPTCHA in Supabase Auth; store only the public site key in `VITE_TURNSTILE_SITE_KEY` and the secret in Supabase Auth.
- Confirm the three cron jobs: unanswered-question expiry, unclaimed-answer purge, and moderation-evidence purge.
- Assign a named moderation owner with trusted `app_metadata.role=moderator`; refresh their JWT and verify the console opens.
- Confirm all browser-visible environment variables are publishable values; never deploy service-role/database passwords.

## Monitoring and escalation

Monitor Auth creation/rate-limit failures, database `rate_limit_rejected` logs, cron failures, open reports, and protected `get_operational_metrics()` results. Pause public traffic, disable anonymous sign-in, or restrict offending identities if abuse, delivery failures, or moderation backlog exceeds the team’s tolerance. Preserve no readable payload beyond the documented retention windows.

## Rollback

1. Disable public entry in the deployment and Supabase anonymous sign-in if active abuse is detected.
2. Pause or roll back the web deployment; do not delete data as a rollback shortcut.
3. Keep RLS/function access restrictions in place and use the moderator console for removals.
4. Inspect Auth/Postgres logs, cron status, and operational metrics before re-opening traffic.

## Required beta evidence

Record browser/device, tester, date, build SHA, and result for: ask → reserve → answer → deliver → rate → report → repeat; keyboard and screen-reader navigation; focus/contrast/reduced motion/touch target checks; RLS/cross-user/replay/concurrency checks; question expiry, answer/evidence cleanup, refunds/rewards, local persistence, offline recovery, and polling after a Realtime disconnect.
