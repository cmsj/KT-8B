// Compile-time only: asserts that GitHub's published webhook schemas are
// assignable to KT's hand-written payload types. Never executed.
import type { components } from "@octokit/openapi-webhooks-types";
import type * as P from "../src/github/payloads.ts";

type S = components["schemas"];
type Assignable<From extends To, To> = [From, To];

export type Checks = [
  Assignable<S["webhook-issues-opened"], P.IssuesEvent>,
  Assignable<S["webhook-issues-closed"], P.IssuesEvent>,
  Assignable<S["webhook-issues-reopened"], P.IssuesEvent>,
  Assignable<S["webhook-issues-labeled"], P.IssuesEvent>,
  Assignable<S["webhook-pull-request-opened"], P.PullRequestEvent>,
  Assignable<S["webhook-pull-request-closed"], P.PullRequestEvent>,
  Assignable<S["webhook-pull-request-reopened"], P.PullRequestEvent>,
  Assignable<S["webhook-pull-request-synchronize"], P.PullRequestEvent>,
  Assignable<S["webhook-pull-request-ready-for-review"], P.PullRequestEvent>,
  Assignable<S["webhook-pull-request-review-submitted"], P.PullRequestReviewEvent>,
  Assignable<S["webhook-pull-request-review-dismissed"], P.PullRequestReviewEvent>,
  Assignable<S["webhook-release-published"], P.ReleaseEvent>,
  Assignable<S["webhook-workflow-run-requested"], P.WorkflowRunEvent>,
  Assignable<S["webhook-workflow-run-in-progress"], P.WorkflowRunEvent>,
  Assignable<S["webhook-workflow-run-completed"], P.WorkflowRunEvent>,
  Assignable<S["webhook-dependabot-alert-created"], P.DependabotAlertEvent>,
  Assignable<S["webhook-dependabot-alert-fixed"], P.DependabotAlertEvent>,
  Assignable<S["webhook-dependabot-alert-dismissed"], P.DependabotAlertEvent>,
  Assignable<S["webhook-repository-advisory-published"], P.RepositoryAdvisoryEvent>,
  Assignable<S["webhook-code-scanning-alert-created"], P.CodeScanningAlertEvent>,
  Assignable<S["webhook-code-scanning-alert-fixed"], P.CodeScanningAlertEvent>,
  Assignable<S["webhook-secret-scanning-alert-created"], P.SecretScanningAlertEvent>,
  Assignable<S["webhook-secret-scanning-alert-resolved"], P.SecretScanningAlertEvent>,
];
