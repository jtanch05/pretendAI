# Matchmaking verification

These checks run only against the local Supabase stack by default. The concurrency script refuses remote URLs unless `ALLOW_REMOTE_MATCHMAKING_BENCHMARK=true` is explicitly set for an isolated test project.

## Start from a clean local database

```sh
pnpm db:start
pnpm db:reset
```

## Verify database behavior and indexes

```sh
pnpm db:test
```

The pgTAP suite verifies the three matchmaking indexes, oldest-first selection, self-question exclusion, and the recent-skip cooldown.

## Run concurrent reservation requests

```sh
pnpm benchmark:matchmaking
```

The default run creates 20 queued questions and sends 20 reservation RPCs concurrently. It fails if an expected assignment is missing or if any question is assigned more than once. Optional positional arguments change the queue and answerer counts:

```sh
node scripts/benchmark-matchmaking.mjs 50 50
```

## Compare query plans on 100,000 queued questions

```sh
pnpm benchmark:matchmaking:plan
```

The SQL benchmark inserts 100,000 queued questions and 100 recent exclusions inside a transaction, prints `EXPLAIN (ANALYZE, BUFFERS)` before and after the matchmaking indexes, and rolls back every inserted row and schema change. The exclusion count models the application's rate-limited skip/report behavior; it is not intended to hide pathological cases with tens of thousands of exclusions for one player.

Record the machine, database version, queue size, concurrency, p50/p95 latency, throughput, and duplicate count with any published result. Do not compare numbers collected on different environments.
