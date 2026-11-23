import type * as P from "./github/payloads.ts";
import type { Context } from "./handlers/context.ts";
import { handleIssues } from "./handlers/issues.ts";
import { handlePullRequest, handlePullRequestReview } from "./handlers/pulls.ts";
import { handleRelease } from "./handlers/releases.ts";
import {
  handleCodeScanningAlert,
  handleDependabotAlert,
  handleRepositoryAdvisory,
  handleSecretScanningAlert,
} from "./handlers/security.ts";
import { handleWorkflowRun } from "./handlers/workflows.ts";

type Handler = (ctx: Context, payload: never) => Promise<void>;

/** GitHub event name (the X-GitHub-Event header) → handler. Anything else is ignored. */
const HANDLERS: Record<string, Handler> = {
  issues: handleIssues,
  pull_request: handlePullRequest,
  pull_request_review: handlePullRequestReview,
  release: handleRelease,
  workflow_run: handleWorkflowRun,
  dependabot_alert: handleDependabotAlert,
  repository_advisory: handleRepositoryAdvisory,
  code_scanning_alert: handleCodeScanningAlert,
  secret_scanning_alert: handleSecretScanningAlert,
};

export const SUBSCRIBED_EVENTS = Object.keys(HANDLERS);

interface AnyPayload {
  action?: string;
  repository?: P.Repository;
  issue?: { number: number };
  pull_request?: { number: number };
  release?: { tag_name: string };
  workflow_run?: { id: number; name?: string | null };
  alert?: { number?: number };
}

/** A short description for logs, e.g. "pull_request.closed #12" or "workflow_run.completed Build (run 123)". */
export function describeEvent(name: string, payload: unknown): string {
  const p = payload as AnyPayload;
  const subject = p.pull_request
    ? `#${p.pull_request.number}`
    : p.issue
      ? `#${p.issue.number}`
      : p.release
        ? p.release.tag_name
        : p.workflow_run
          ? `${p.workflow_run.name ?? "workflow"} (run ${p.workflow_run.id})`
          : p.alert?.number !== undefined
            ? `alert ${p.alert.number}`
            : undefined;
  return `${name}${p.action ? `.${p.action}` : ""}${subject ? ` ${subject}` : ""}`;
}

/**
 * Hands the event to its handler. Returns false if it was ignored without being
 * looked at (not an event KT handles, or for another repository), so the caller
 * doesn't record it as handled and a redelivery can be tried after fixing the config.
 */
export async function routeEvent(ctx: Context, name: string, payload: unknown): Promise<boolean> {
  const repo = (payload as AnyPayload).repository?.full_name;
  const description = describeEvent(name, payload);

  if (name === "ping") {
    ctx.log.info(`webhook ping received${repo ? ` for ${repo}` : ""}`);
    return false;
  }

  const handler = HANDLERS[name];
  if (!handler) {
    ctx.log.debug(`ignoring ${description}: KT doesn't handle ${name} events`);
    return false;
  }

  const expected = ctx.config.github.repo;
  if (repo?.toLowerCase() !== expected.toLowerCase()) {
    ctx.log.warn(
      `ignoring ${description} for ${repo ?? "an unknown repository"}: KT is configured for ${expected} (github.repo). ` +
        `If the repository was renamed or transferred, update github.repo.`,
    );
    return false;
  }

  ctx.log.debug(`handling ${description}`);
  await handler(ctx, payload as never);
  return true;
}
