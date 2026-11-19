import type { Run } from "./store.ts";

export type CiState = "pending" | "failure" | "success";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const PASSED = new Set(["success", "neutral"]);
// Skipped and cancelled runs (e.g. superseded by a newer push) say nothing about the code.
const IRRELEVANT = new Set(["skipped", "cancelled", "stale"]);

export function runOutcome(run: Run): CiState | null {
  if (run.status !== "completed") return "pending";
  if (run.conclusion === null || IRRELEVANT.has(run.conclusion)) return null;
  if (FAILED.has(run.conclusion)) return "failure";
  if (PASSED.has(run.conclusion)) return "success";
  // e.g. "action_required": a fork's workflows are waiting for a maintainer's approval.
  return "pending";
}

/**
 * The runs that currently represent a commit: for each workflow (and trigger, since
 * a commit can be built both as a push and as a pull request), the newest run.
 * Re-running a workflow keeps its run ID, so re-runs are already folded in.
 */
export function currentRuns(runs: Run[], ignoreWorkflows: readonly string[] = []): Run[] {
  const latest = new Map<string, Run>();
  for (const run of runs) {
    if (ignoreWorkflows.includes(run.workflowName)) continue;
    const key = `${run.workflowId}:${run.event}`;
    const seen = latest.get(key);
    if (!seen || run.id > seen.id) latest.set(key, run);
  }
  return [...latest.values()];
}

/**
 * Collapses a set of workflow runs into one state: any failure wins, then
 * anything still running, then success. Null if no run is worth showing.
 */
export function aggregateCi(runs: Run[], ignoreWorkflows: readonly string[] = []): CiState | null {
  const outcomes = currentRuns(runs, ignoreWorkflows).map(runOutcome);
  if (outcomes.includes("failure")) return "failure";
  if (outcomes.includes("pending")) return "pending";
  if (outcomes.includes("success")) return "success";
  return null;
}

export function failedRuns(runs: Run[], ignoreWorkflows: readonly string[] = []): Run[] {
  return currentRuns(runs, ignoreWorkflows).filter((run) => runOutcome(run) === "failure");
}
