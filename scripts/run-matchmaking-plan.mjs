import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const container = "supabase_db_pretend-ai";
const localFile = resolve("supabase/tests/performance/matchmaking_plan.sql");
const containerFile = "/tmp/matchmaking_plan.sql";

execFileSync("docker", ["inspect", container], { stdio: "ignore" });
execFileSync("docker", ["cp", localFile, `${container}:${containerFile}`], { stdio: "inherit" });
execFileSync(
  "docker",
  ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", containerFile],
  { stdio: "inherit" }
);
