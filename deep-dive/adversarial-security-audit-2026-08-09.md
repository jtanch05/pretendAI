# Adversarial security audit — 2026-08-09

## Scope and method

Reviewed the browser RPC surface, Supabase production grants/RLS/function exposure, SQL construction, DOM rendering, anonymous-auth abuse controls, and production dependencies. The review assumed a malicious anonymous player can call any browser-visible RPC directly and can alter all browser state and request parameters.

## Findings

### P1 — Client-supplied report evidence can frame an answerer — fixed locally, pending deployment

`public.report_answer(reported_answer_id, report_reason, answer_evidence)` verifies that the caller owns the delivered answer, but stores `answer_evidence` supplied by the caller rather than the server's answer payload. The client passes this field directly in `src/services/gameApi.ts`.

An asker can submit arbitrary 1–750-character evidence for an answer they received. A moderator may then remove content or restrict the actual answerer based on fabricated evidence.

Implemented in `20260809000000_secure_report_evidence_and_realtime.sql`: delivery acknowledgement stores a server-authenticated text or drawing snapshot for 30 days before deleting the payload, and the replacement two-argument `report_answer` reads only that snapshot. The browser can no longer submit evidence.

### P2 — Realtime grant exposes a stable answerer UUID to the asker — fixed locally, pending deployment

The production grant allows authenticated users to `SELECT public.question_jobs`. Its RLS policy lets an asker select their own row. That full row includes `reserved_by`, so an asker who calls the Data API directly can obtain and correlate the anonymous answerer's stable user UUID across their own questions.

Implemented in `20260809000000_secure_report_evidence_and_realtime.sql`: direct `SELECT` is revoked, the Postgres Changes publication is removed, and a private Broadcast sends only a status transition. A Realtime RLS policy authorizes only the asker for the matching topic.

### P2 — Production permission fix is prepared but not yet deployed

Production still lets `authenticated` execute `public.purge_unclaimed_answers()`, a scheduler-only `SECURITY DEFINER` function with no identity check. The new local migration `20260808172557_restrict_purge_function_execution.sql` revokes it and pgTAP verifies the intended role cannot execute it. It remains live until the migration is applied to production.

### P2 — Anonymous users can bypass per-identity rate limits at scale

The database rate limits actions per anonymous Auth identity. An attacker can create many anonymous identities, so the limits do not cap a coordinated account-creation flood. Turnstile is optional when the site key is absent in the browser.

Recommended remediation: enforce CAPTCHA in Supabase Auth for public deployment, keep Auth rate limits enabled, and monitor anonymous sign-up spikes.

## Verified controls

- No service-role, secret key, database URL, or credential file is tracked or used in browser code.
- No user-controlled dynamic SQL, `eval`, `new Function`, `innerHTML`, or `dangerouslySetInnerHTML` was found.
- Local migration state denies direct `SELECT`, `INSERT`, `UPDATE`, and `DELETE` to `anon` and `authenticated` on all private content tables, including `question_jobs`; production still needs the pending migrations deployed.
- Every currently exposed `SECURITY DEFINER` gameplay/moderation RPC except the undeployed purge fix checks `auth.uid()`; moderator RPCs additionally check `app_metadata.role`.
- `anon` and `authenticated` cannot create objects in the `public` schema, preventing `search_path = public` object-shadowing by players.
- `pnpm audit --prod --json` reported 0 vulnerabilities across 15 production dependencies.

## No critical SQL-injection or direct-table takeover was found

Supabase RPC parameters are encoded by the client library and consumed as typed function arguments. The one dynamic `EXECUTE` found is a migration-time constant string, not user input.
