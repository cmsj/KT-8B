// The subset of GitHub webhook payloads KT reads. These are checked against
// GitHub's published schemas in test/payload-types.check.ts, so a field that
// doesn't exist (or has the wrong type) fails `npm run typecheck`.

export interface User {
  login: string;
  html_url?: string;
  avatar_url?: string;
}

export interface Repository {
  full_name: string;
  html_url: string;
  default_branch: string;
}

interface Base {
  repository?: Repository;
  sender?: User;
}

export interface Label {
  name: string;
}

export interface Issue {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  user: User | null;
  labels?: (Label | null)[];
  state_reason?: string | null;
}

export interface IssuesEvent extends Base {
  action: string;
  issue: Issue;
  label?: Label;
}

export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  user: User | null;
  draft?: boolean;
  merged?: boolean | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  head: { sha: string; ref: string; label: string | null };
  base: { ref: string };
}

export interface PullRequestEvent extends Base {
  action: string;
  pull_request: PullRequest;
}

export interface PullRequestReviewEvent extends Base {
  action: string;
  review: { state: string; html_url: string; user: User | null };
  pull_request: { number: number };
}

export interface ReleaseEvent extends Base {
  action: string;
  release: {
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    prerelease: boolean;
    author: User | null;
  };
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  workflow_id: number;
  run_number: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string | null;
  event: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  head_repository: { full_name: string } | null;
  head_commit: { message: string; author: { name: string } } | null;
  pull_requests: ({ number: number } | null)[] | null;
}

export interface WorkflowRunEvent extends Base {
  action: string;
  workflow_run: WorkflowRun;
}

export interface DependabotAlertEvent extends Base {
  action: string;
  alert: {
    number: number;
    html_url: string;
    dependency: { package?: { ecosystem: string; name: string }; manifest_path?: string };
    security_advisory: { ghsa_id: string; cve_id: string | null; summary: string; severity: string };
    security_vulnerability: { first_patched_version: { identifier: string } | null };
  };
}

export interface RepositoryAdvisoryEvent extends Base {
  action: string;
  repository_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    severity: string | null;
    html_url: string;
  };
}

export interface CodeScanningAlertEvent extends Base {
  action: string;
  alert: {
    number: number;
    html_url: string;
    rule: { description?: string; severity?: string | null; security_severity_level?: string | null };
    tool: { name: string } | null;
  };
}

export interface SecretScanningAlertEvent extends Base {
  action: string;
  alert: {
    number?: number;
    html_url?: string;
    secret_type_display_name?: string;
  };
}
