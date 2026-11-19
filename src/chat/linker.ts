import { escapeMarkdown } from "discord.js";
import type { Logger } from "../log.ts";
import { link } from "../render.ts";

/**
 * Finds "#123"-style references in a chat message, ignoring code, URLs and
 * Discord mentions (channel mentions look like <#123456789>).
 */
export function extractReferences(text: string, max: number): number[] {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[#@][!&]?\d+>/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ");

  const found: number[] = [];
  for (const match of prose.matchAll(/(?<![\w#&/])#(\d{1,7})\b/g)) {
    const number = Number(match[1]);
    if (number > 0 && !found.includes(number)) found.push(number);
    if (found.length === max) break;
  }
  return found;
}

export interface IssueInfo {
  number: number;
  title: string;
  url: string;
  isPullRequest: boolean;
  /** e.g. "open", "draft", "merged", "closed", "not planned" */
  status: string;
}

interface ApiIssue {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  draft?: boolean;
  pull_request?: { merged_at: string | null };
}

export function describeIssue(issue: ApiIssue): IssueInfo {
  const isPullRequest = issue.pull_request !== undefined;
  let status: string;
  if (issue.state === "open") status = issue.draft ? "draft" : "open";
  else if (isPullRequest) status = issue.pull_request?.merged_at ? "merged" : "closed";
  else status = issue.state_reason === "not_planned" ? "not planned" : issue.state_reason === "duplicate" ? "duplicate" : "closed";
  return { number: issue.number, title: issue.title, url: issue.html_url, isPullRequest, status };
}

const CACHE_MS = 5 * 60 * 1000;

/** Looks up issues and PRs via the GitHub REST API, with a short cache so a busy channel doesn't hit rate limits. */
export class IssueLookup {
  private readonly cache = new Map<number, { at: number; info: IssueInfo | "missing" }>();

  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(repo: string, token: string | undefined, log: Logger, fetchImpl: typeof fetch = fetch) {
    this.repo = repo;
    this.token = token;
    this.log = log;
    this.fetchImpl = fetchImpl;
  }

  /** Returns the issue, "missing" if GitHub says it doesn't exist, or null if GitHub couldn't be asked. */
  async get(number: number): Promise<IssueInfo | "missing" | null> {
    const cached = this.cache.get(number);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.info;

    try {
      const response = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/issues/${number}`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "KT-8B",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      // 410: the issue was deleted.
      const info = response.status === 404 || response.status === 410 ? "missing" : response.ok ? describeIssue((await response.json()) as ApiIssue) : null;
      if (info === null) {
        this.log.warn(`GitHub API returned ${response.status} for #${number}`);
        return null;
      }
      this.cache.set(number, { at: Date.now(), info });
      return info;
    } catch (error) {
      this.log.warn(`GitHub API lookup for #${number} failed`, error);
      return null;
    }
  }
}

/** One line per reference; references GitHub says don't exist are dropped. */
export async function linkReferences(repo: string, numbers: number[], lookup: IssueLookup): Promise<string[]> {
  const lines = await Promise.all(
    numbers.map(async (number) => {
      const info = await lookup.get(number);
      if (info === "missing") return null;
      // GitHub redirects /issues/N to /pull/N, so this works even when we couldn't find out which it is.
      if (info === null) return link(`#${number}`, `https://github.com/${repo}/issues/${number}`);
      return `${link(`#${number}`, info.url)} ${escapeMarkdown(info.title)} *(${info.isPullRequest ? "PR" : "issue"}, ${info.status})*`;
    }),
  );
  return lines.filter((line) => line !== null);
}
