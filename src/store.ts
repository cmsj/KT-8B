import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** What a post in the updates channel is about. Together with `key` it identifies the post. */
export type PostKind = "issue" | "pr" | "release" | "dependabot" | "advisory" | "code-scanning" | "secret-scanning" | "ci-main";

/**
 * Reactions are grouped into slots; each slot shows at most one emoji at a time,
 * so e.g. a CI failure replaces the CI pending reaction but leaves review state alone.
 */
export type ReactionSlot = "ci" | "review" | "lifecycle";

export interface Post {
  kind: PostKind;
  key: string;
  channelId: string;
  messageId: string;
  threadId: string | null;
  /** For PRs: the commit whose workflow runs drive the CI reaction. */
  headSha: string | null;
  reactions: Partial<Record<ReactionSlot, string>>;
  /** Kind-specific state, e.g. the last CI state of a PR or whether an issue has pinged. */
  state: Record<string, unknown>;
}

export interface Run {
  id: number;
  workflowId: number;
  workflowName: string;
  runNumber: number;
  runAttempt: number;
  headSha: string;
  headBranch: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  /** True when the run is for a push/schedule/etc. on this repository rather than a pull request. */
  onRepoBranch: boolean;
}

export type ReviewState = "approved" | "changes_requested";

interface PostRow {
  kind: string;
  key: string;
  channel_id: string;
  message_id: string;
  thread_id: string | null;
  head_sha: string | null;
  reactions: string;
  state: string;
}

interface RunRow {
  id: number;
  workflow_id: number;
  workflow_name: string;
  run_number: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  on_repo_branch: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  head_sha TEXT,
  reactions TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS posts_head_sha ON posts (head_sha) WHERE head_sha IS NOT NULL;

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  workflow_id INTEGER NOT NULL,
  workflow_name TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  run_attempt INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  head_branch TEXT,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  html_url TEXT NOT NULL,
  on_repo_branch INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_head_sha ON runs (head_sha);

CREATE TABLE IF NOT EXISTS reviews (
  pr_number INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (pr_number, reviewer)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
`;

const STATUS_ORDER: Record<string, number> = { requested: 0, waiting: 1, pending: 1, queued: 2, in_progress: 3, completed: 4 };

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- posts ---

  getPost(kind: PostKind, key: string | number): Post | undefined {
    const row = this.db.prepare("SELECT * FROM posts WHERE kind = ? AND key = ?").get(kind, String(key)) as PostRow | undefined;
    return row && toPost(row);
  }

  postsForHeadSha(headSha: string): Post[] {
    const rows = this.db.prepare("SELECT * FROM posts WHERE head_sha = ?").all(headSha) as unknown as PostRow[];
    return rows.map(toPost);
  }

  savePost(post: Post): void {
    this.db
      .prepare(
        `INSERT INTO posts (kind, key, channel_id, message_id, thread_id, head_sha, reactions, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET
           channel_id = excluded.channel_id, message_id = excluded.message_id, thread_id = excluded.thread_id,
           head_sha = excluded.head_sha, reactions = excluded.reactions, state = excluded.state`,
      )
      .run(
        post.kind,
        post.key,
        post.channelId,
        post.messageId,
        post.threadId,
        post.headSha,
        JSON.stringify(post.reactions),
        JSON.stringify(post.state),
        Date.now(),
      );
  }

  deletePost(kind: PostKind, key: string | number): void {
    this.db.prepare("DELETE FROM posts WHERE kind = ? AND key = ?").run(kind, String(key));
  }

  // --- workflow runs ---

  /**
   * Records a workflow run, ignoring updates that arrive out of order (GitHub
   * doesn't guarantee delivery order, so "in_progress" can land after "completed").
   * Returns false if the update was stale and ignored.
   */
  upsertRun(run: Run): boolean {
    const existing = this.db.prepare("SELECT run_attempt, status FROM runs WHERE id = ?").get(run.id) as
      | { run_attempt: number; status: string }
      | undefined;
    if (existing) {
      const newer =
        run.runAttempt > existing.run_attempt ||
        (run.runAttempt === existing.run_attempt && (STATUS_ORDER[run.status] ?? 0) >= (STATUS_ORDER[existing.status] ?? 0));
      if (!newer) return false;
    }
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_id, workflow_name, run_number, run_attempt, head_sha, head_branch, event, status, conclusion, html_url, on_repo_branch, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           workflow_name = excluded.workflow_name, run_attempt = excluded.run_attempt, status = excluded.status,
           conclusion = excluded.conclusion, html_url = excluded.html_url, updated_at = excluded.updated_at`,
      )
      .run(
        run.id,
        run.workflowId,
        run.workflowName,
        run.runNumber,
        run.runAttempt,
        run.headSha,
        run.headBranch,
        run.event,
        run.status,
        run.conclusion,
        run.htmlUrl,
        run.onRepoBranch ? 1 : 0,
        Date.now(),
      );
    return true;
  }

  runsForHeadSha(headSha: string): Run[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE head_sha = ? ORDER BY id").all(headSha) as unknown as RunRow[];
    return rows.map(toRun);
  }

  /** The most recently started run of a workflow on a branch of this repository (not from a pull request). */
  latestBranchRun(workflowId: number, branch: string): Run | undefined {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE workflow_id = ? AND head_branch = ? AND on_repo_branch = 1 ORDER BY run_number DESC LIMIT 1")
      .get(workflowId, branch) as RunRow | undefined;
    return row && toRun(row);
  }

  // --- reviews ---

  setReview(prNumber: number, reviewer: string, state: ReviewState | null): void {
    if (state === null) {
      this.db.prepare("DELETE FROM reviews WHERE pr_number = ? AND reviewer = ?").run(prNumber, reviewer);
    } else {
      this.db
        .prepare("INSERT INTO reviews (pr_number, reviewer, state) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET state = excluded.state")
        .run(prNumber, reviewer, state);
    }
  }

  reviewStates(prNumber: number): ReviewState[] {
    const rows = this.db.prepare("SELECT state FROM reviews WHERE pr_number = ?").all(prNumber) as { state: ReviewState }[];
    return rows.map((r) => r.state);
  }

  // --- webhook deliveries ---

  hasDelivery(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM deliveries WHERE id = ?").get(id) !== undefined;
  }

  /** Remembers a successfully handled delivery, so a GitHub redelivery of it is ignored. */
  recordDelivery(id: string): void {
    this.db.prepare("INSERT OR IGNORE INTO deliveries (id, received_at) VALUES (?, ?)").run(id, Date.now());
  }

  /** Drops bookkeeping that can no longer matter. */
  prune(now = Date.now()): void {
    const week = 7 * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM deliveries WHERE received_at < ?").run(now - week);
    this.db.prepare("DELETE FROM runs WHERE updated_at < ?").run(now - 4 * week);
  }
}

function toPost(row: PostRow): Post {
  return {
    kind: row.kind as PostKind,
    key: row.key,
    channelId: row.channel_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    headSha: row.head_sha,
    reactions: JSON.parse(row.reactions),
    state: JSON.parse(row.state),
  };
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    runNumber: row.run_number,
    runAttempt: row.run_attempt,
    headSha: row.head_sha,
    headBranch: row.head_branch,
    event: row.event,
    status: row.status,
    conclusion: row.conclusion,
    htmlUrl: row.html_url,
    onRepoBranch: row.on_repo_branch === 1,
  };
}
