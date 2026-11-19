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

export async function routeEvent(ctx: Context, name: string, payload: unknown): Promise<void> {
  const repo = (payload as { repository?: P.Repository }).repository?.full_name;

  if (name === "ping") {
    ctx.log.info(`webhook ping received${repo ? ` for ${repo}` : ""}`);
    return;
  }

  const handler = HANDLERS[name];
  if (!handler) return;

  if (repo?.toLowerCase() !== ctx.config.github.repo.toLowerCase()) {
    ctx.log.info(`ignoring ${name} event for ${repo ?? "unknown repository"}`);
    return;
  }

  await handler(ctx, payload as never);
}
