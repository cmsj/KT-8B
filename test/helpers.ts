import { type Config, parseConfig } from "../src/config.ts";
import type { DiscordGateway, OutgoingMessage } from "../src/discord/gateway.ts";
import { Updates } from "../src/discord/updates.ts";
import type { Context } from "../src/handlers/context.ts";
import { silentLogger } from "../src/log.ts";
import { Store } from "../src/store.ts";

export const UPDATES_CHANNEL = "100000000000000001";
export const CRASH_ROLE = "200000000000000001";
export const RELEASE_ROLE = "200000000000000002";
export const REPO = "octo/widgets";

export interface Sent {
  channelId: string;
  messageId: string;
  message: OutgoingMessage;
}

/** Records what KT would have done in Discord, and tracks each message's reactions. */
export class FakeDiscord implements DiscordGateway {
  sent: Sent[] = [];
  reactions = new Map<string, string[]>();
  threads = new Map<string, string>(); // parent message ID → thread channel ID
  private nextId = 1;

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const messageId = `m${this.nextId++}`;
    this.sent.push({ channelId, messageId, message });
    return messageId;
  }

  async addReaction(_channelId: string, messageId: string, emoji: string): Promise<void> {
    const list = this.reactions.get(messageId) ?? [];
    if (!list.includes(emoji)) list.push(emoji);
    this.reactions.set(messageId, list);
  }

  async removeOwnReaction(_channelId: string, messageId: string, emoji: string): Promise<void> {
    this.reactions.set(messageId, (this.reactions.get(messageId) ?? []).filter((e) => e !== emoji));
  }

  async startThread(_channelId: string, messageId: string): Promise<string> {
    const threadId = `t${this.nextId++}`;
    this.threads.set(messageId, threadId);
    return threadId;
  }

  /** Top-level messages in the updates channel. */
  posts(): Sent[] {
    return this.sent.filter((s) => s.channelId === UPDATES_CHANNEL);
  }

  /** Text of the notes in the thread on `messageId`. */
  notes(messageId: string): string[] {
    const threadId = this.threads.get(messageId);
    return this.sent.filter((s) => s.channelId === threadId).map((s) => s.message.content ?? "");
  }

  reactionsOn(messageId: string): string[] {
    return this.reactions.get(messageId) ?? [];
  }
}

export function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return parseConfig(
    {
      github: { repo: REPO },
      discord: { updatesChannelId: UPDATES_CHANNEL },
      issues: { pingLabels: ["crash"], pingRoleId: CRASH_ROLE },
      releases: { pingRoleId: RELEASE_ROLE },
      ...overrides,
    },
    { DISCORD_TOKEN: "token", GITHUB_WEBHOOK_SECRET: "secret" },
  );
}

export function makeContext(config: Config = makeConfig()): Context & { discord: FakeDiscord } {
  const store = new Store(":memory:");
  const discord = new FakeDiscord();
  return { config, store, discord, updates: new Updates(config, store, discord, silentLogger), log: silentLogger };
}

// --- payload builders ---

export const repository = { full_name: REPO, html_url: `https://github.com/${REPO}`, default_branch: "main" };
const user = (login: string) => ({ login, html_url: `https://github.com/${login}`, avatar_url: "https://example.com/a.png" });

export function issueEvent(action: string, number: number, extra: { labels?: string[]; label?: string; state_reason?: string; author?: string } = {}) {
  return {
    action,
    repository,
    sender: user("alice"),
    label: extra.label ? { name: extra.label } : undefined,
    issue: {
      number,
      title: `Issue ${number}`,
      html_url: `https://github.com/${REPO}/issues/${number}`,
      body: "It broke <!-- template comment -->",
      user: user(extra.author ?? "alice"),
      labels: (extra.labels ?? []).map((name) => ({ name })),
      state_reason: extra.state_reason ?? null,
    },
  };
}

export function prEvent(action: string, number: number, extra: { sha?: string; merged?: boolean; author?: string } = {}) {
  return {
    action,
    repository,
    sender: user("bob"),
    pull_request: {
      number,
      title: `PR ${number}`,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      body: "Fixes things",
      user: user(extra.author ?? "bob"),
      draft: false,
      merged: extra.merged ?? false,
      additions: 10,
      deletions: 2,
      changed_files: 3,
      head: { sha: extra.sha ?? "aaaaaaa1", ref: "feature", label: "bob:feature" },
      base: { ref: "main" },
    },
  };
}

export function reviewEvent(action: string, number: number, reviewer: string, state: string) {
  return {
    action,
    repository,
    sender: user(reviewer),
    review: { state, html_url: `https://github.com/${REPO}/pull/${number}#review`, user: user(reviewer) },
    pull_request: { number },
  };
}

export function runEvent(run: {
  id: number;
  sha: string;
  status: string;
  conclusion?: string | null;
  workflowId?: number;
  name?: string;
  event?: string;
  branch?: string;
  runNumber?: number;
  attempt?: number;
  fork?: boolean;
}) {
  return {
    action: run.status === "completed" ? "completed" : run.status === "in_progress" ? "in_progress" : "requested",
    repository,
    sender: user("bob"),
    workflow_run: {
      id: run.id,
      name: run.name ?? "Build",
      workflow_id: run.workflowId ?? 1,
      run_number: run.runNumber ?? run.id,
      run_attempt: run.attempt ?? 1,
      head_sha: run.sha,
      head_branch: run.branch ?? "feature",
      event: run.event ?? "pull_request",
      status: run.status,
      conclusion: run.conclusion ?? null,
      html_url: `https://github.com/${REPO}/actions/runs/${run.id}`,
      head_repository: { full_name: run.fork ? "someone/widgets" : REPO },
      head_commit: { message: "Do the thing\n\nLonger description", author: { name: "Bob" } },
      pull_requests: run.fork ? [] : [{ number: 1 }],
    },
  };
}
