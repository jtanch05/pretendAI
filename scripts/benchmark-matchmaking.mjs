import { execFileSync, execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const requestedQuestions = Number.parseInt(process.argv[2] ?? "20", 10);
const requestedAnswerers = Number.parseInt(process.argv[3] ?? String(requestedQuestions), 10);

if (!Number.isInteger(requestedQuestions) || requestedQuestions < 1) {
  throw new Error("Question count must be a positive integer.");
}
if (!Number.isInteger(requestedAnswerers) || requestedAnswerers < 1) {
  throw new Error("Answerer count must be a positive integer.");
}

function localStatus() {
  const output = process.platform === "win32"
    ? execSync("pnpm dlx supabase status -o env", { encoding: "utf8" })
    : execFileSync("pnpm", ["dlx", "supabase", "status", "-o", "env"], { encoding: "utf8" });
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

const status = localStatus();
const url = process.env.SUPABASE_URL ?? status.API_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? status.PUBLISHABLE_KEY ?? status.ANON_KEY;

if (!url || !key) {
  throw new Error("Start the local Supabase stack before running this benchmark.");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) && process.env.ALLOW_REMOTE_MATCHMAKING_BENCHMARK !== "true") {
  throw new Error("Refusing to create benchmark users outside local Supabase. Set ALLOW_REMOTE_MATCHMAKING_BENCHMARK=true only for an isolated test project.");
}

function client() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function createPlayer() {
  const supabase = client();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(error?.message ?? "Anonymous sign-in failed.");
  const { error: profileError } = await supabase.rpc("create_profile_with_starter_credit");
  if (profileError) throw new Error(profileError.message);
  return { supabase, userId: data.user.id };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const askers = await Promise.all(Array.from({ length: requestedQuestions }, () => createPlayer()));
await Promise.all(askers.map(async ({ supabase }, index) => {
  const { error } = await supabase.rpc("create_question_v2", {
    question_text: `matchmaking benchmark ${index + 1}`,
    requested_kind: "text"
  });
  if (error) throw new Error(error.message);
}));

const answerers = await Promise.all(Array.from({ length: requestedAnswerers }, () => createPlayer()));
const startedAt = performance.now();
const reservations = await Promise.all(answerers.map(async ({ supabase, userId }) => {
  const requestStartedAt = performance.now();
  const { data, error } = await supabase.rpc("get_and_reserve_question_v2");
  const durationMs = performance.now() - requestStartedAt;
  if (error) throw new Error(error.message);
  return { userId, questionId: data?.[0]?.question_id ?? null, durationMs };
}));
const totalDurationMs = performance.now() - startedAt;

const assigned = reservations.filter(({ questionId }) => questionId !== null);
const assignedIds = assigned.map(({ questionId }) => questionId);
const uniqueIds = new Set(assignedIds);
const latencies = reservations.map(({ durationMs }) => durationMs);
const expectedAssignments = Math.min(requestedQuestions, requestedAnswerers);

if (assigned.length !== expectedAssignments) {
  throw new Error(`Expected ${expectedAssignments} assignments, received ${assigned.length}.`);
}
if (uniqueIds.size !== assignedIds.length) {
  throw new Error(`Duplicate assignment detected: ${assignedIds.length - uniqueIds.size} duplicate(s).`);
}

console.log(JSON.stringify({
  questions: requestedQuestions,
  concurrentAnswerers: requestedAnswerers,
  successfulAssignments: assigned.length,
  duplicateAssignments: assignedIds.length - uniqueIds.size,
  totalDurationMs: Number(totalDurationMs.toFixed(2)),
  throughputPerSecond: Number((assigned.length / (totalDurationMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(latencies, 0.5).toFixed(2)),
    p95: Number(percentile(latencies, 0.95).toFixed(2)),
    max: Number(Math.max(...latencies).toFixed(2))
  }
}, null, 2));
