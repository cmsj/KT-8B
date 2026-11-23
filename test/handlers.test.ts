import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeEvent } from "../src/router.ts";
import { CRASH_ROLE, RELEASE_ROLE, issueEvent, makeConfig, makeContext, prEvent, repository, reviewEvent, runEvent } from "./helpers.ts";

describe("issues", () => {
  it("posts new issues and pings the role for configured labels", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "issues", issueEvent("opened", 7, { labels: ["bug"] }));
    await routeEvent(ctx, "issues", issueEvent("opened", 8, { labels: ["crash", "bug"] }));

    const [plain, crash] = ctx.discord.posts();
    assert.equal(plain?.message.content, undefined);
    assert.deepEqual(plain?.message.pingRoleIds, []);
    assert.equal(plain?.message.embeds?.[0]?.title, "#7 Issue 7");
    assert.equal(plain?.message.embeds?.[0]?.description, "It broke");
    assert.match(crash?.message.content ?? "", new RegExp(`<@&${CRASH_ROLE}>`));
    assert.deepEqual(crash?.message.pingRoleIds, [CRASH_ROLE]);
  });

  it("pings once when a ping label is added after opening", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "issues", issueEvent("opened", 7));
    await routeEvent(ctx, "issues", issueEvent("labeled", 7, { label: "crash" }));
    await routeEvent(ctx, "issues", issueEvent("labeled", 7, { label: "crash" }));
    await routeEvent(ctx, "issues", issueEvent("labeled", 7, { label: "docs" }));

    const replies = ctx.discord.sent.filter((s) => s.message.replyToMessageId);
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0]?.message.pingRoleIds, [CRASH_ROLE]);
  });

  it("doesn't ping again for labels an issue was opened with", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "issues", issueEvent("opened", 7, { labels: ["crash"] }));
    await routeEvent(ctx, "issues", issueEvent("labeled", 7, { label: "crash" }));
    assert.equal(ctx.discord.sent.length, 1);
  });

  it("reacts and notes in a thread when closed, and undoes the reaction on reopen", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "issues", issueEvent("opened", 7));
    const id = ctx.discord.posts()[0]!.messageId;

    await routeEvent(ctx, "issues", issueEvent("closed", 7, { state_reason: "completed" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["✅"]);

    await routeEvent(ctx, "issues", issueEvent("reopened", 7));
    assert.deepEqual(ctx.discord.reactionsOn(id), []);

    await routeEvent(ctx, "issues", issueEvent("closed", 7, { state_reason: "not_planned" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🚫"]);
    assert.deepEqual(ctx.discord.notes(id), ["Closed as completed by alice", "Reopened by alice", "Closed as not planned by alice"]);
    assert.equal(ctx.discord.posts().length, 1, "follow-ups never become channel messages");
  });

  it("ignores configured authors and events for other repositories", async () => {
    const ctx = makeContext(makeConfig({ issues: { ignoreAuthors: ["spambot"] } }));
    await routeEvent(ctx, "issues", issueEvent("opened", 1, { author: "spambot" }));
    await routeEvent(ctx, "issues", { ...issueEvent("opened", 2), repository: { ...repository, full_name: "other/repo" } });
    assert.equal(ctx.discord.sent.length, 0);
  });

  it("says which repository it expected, and doesn't count the event as handled", async () => {
    const warnings: string[] = [];
    const ctx = makeContext();
    ctx.log = { ...ctx.log, warn: (message) => warnings.push(message) };
    const handled = await routeEvent(ctx, "pull_request", { ...prEvent("closed", 3), repository: { ...repository, full_name: "Neworg/widgets" } });
    assert.equal(handled, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /pull_request\.closed #3 for Neworg\/widgets: KT is configured for octo\/widgets/);
    assert.equal(await routeEvent(ctx, "issues", issueEvent("opened", 4)), true);
    assert.equal(await routeEvent(ctx, "star", { action: "created", repository }), false);
  });

  it("skips thread notes when threads are disabled", async () => {
    const ctx = makeContext(makeConfig({ threads: { enabled: false } }));
    await routeEvent(ctx, "issues", issueEvent("opened", 7));
    await routeEvent(ctx, "issues", issueEvent("closed", 7));
    assert.equal(ctx.discord.threads.size, 0);
    assert.deepEqual(ctx.discord.reactionsOn(ctx.discord.posts()[0]!.messageId), ["✅"]);
  });
});

describe("pull requests and CI", () => {
  it("tracks workflow runs as a single CI reaction", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "pull_request", prEvent("opened", 1, { sha: "sha1" }));
    const id = ctx.discord.posts()[0]!.messageId;
    assert.deepEqual(ctx.discord.reactionsOn(id), []);

    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "sha1", status: "in_progress", workflowId: 1, name: "Build" }));
    await routeEvent(ctx, "workflow_run", runEvent({ id: 11, sha: "sha1", status: "in_progress", workflowId: 2, name: "Lint" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟡"]);

    await routeEvent(ctx, "workflow_run", runEvent({ id: 11, sha: "sha1", status: "completed", conclusion: "failure", workflowId: 2, name: "Lint" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🔴"], "a failure shows even while other runs are going");
    assert.equal(ctx.discord.notes(id).length, 1);
    assert.match(ctx.discord.notes(id)[0]!, /CI failed on `sha1`: \[Lint\]/);

    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "sha1", status: "completed", conclusion: "success", workflowId: 1 }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🔴"]);

    // Re-running the failed workflow keeps its run ID and bumps the attempt.
    await routeEvent(ctx, "workflow_run", runEvent({ id: 11, sha: "sha1", status: "in_progress", attempt: 2, workflowId: 2, name: "Lint" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟡"]);
    await routeEvent(ctx, "workflow_run", runEvent({ id: 11, sha: "sha1", status: "completed", conclusion: "success", attempt: 2, workflowId: 2, name: "Lint" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟢"]);
    assert.equal(ctx.discord.posts().length, 1);
  });

  it("ignores skipped runs and out-of-order deliveries", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "pull_request", prEvent("opened", 1, { sha: "sha1" }));
    const id = ctx.discord.posts()[0]!.messageId;

    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "sha1", status: "completed", conclusion: "skipped" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), []);

    await routeEvent(ctx, "workflow_run", runEvent({ id: 12, sha: "sha1", status: "completed", conclusion: "success", workflowId: 3 }));
    await routeEvent(ctx, "workflow_run", runEvent({ id: 12, sha: "sha1", status: "in_progress", workflowId: 3 }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟢"]);
  });

  it("picks up runs that arrived before the PR was opened, including from forks", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "forksha", status: "in_progress", fork: true }));
    await routeEvent(ctx, "pull_request", prEvent("opened", 5, { sha: "forksha" }));
    assert.deepEqual(ctx.discord.reactionsOn(ctx.discord.posts()[0]!.messageId), ["🟡"]);
  });

  it("follows the new head commit when a PR is pushed to", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "pull_request", prEvent("opened", 1, { sha: "sha1" }));
    const id = ctx.discord.posts()[0]!.messageId;
    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "sha1", status: "completed", conclusion: "success" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟢"]);

    await routeEvent(ctx, "pull_request", prEvent("synchronize", 1, { sha: "sha2" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), [], "old commit's result no longer applies");

    await routeEvent(ctx, "workflow_run", runEvent({ id: 20, sha: "sha2", status: "queued" }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟡"]);
    // A late event for the old commit must not touch the PR.
    await routeEvent(ctx, "workflow_run", runEvent({ id: 11, sha: "sha1", status: "completed", conclusion: "failure", workflowId: 9 }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟡"]);
  });

  it("shows merged/closed and review state in separate slots", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "pull_request", prEvent("opened", 1));
    const id = ctx.discord.posts()[0]!.messageId;

    await routeEvent(ctx, "pull_request_review", reviewEvent("submitted", 1, "carol", "commented"));
    assert.deepEqual(ctx.discord.reactionsOn(id), []);
    await routeEvent(ctx, "pull_request_review", reviewEvent("submitted", 1, "carol", "changes_requested"));
    await routeEvent(ctx, "pull_request_review", reviewEvent("submitted", 1, "dave", "approved"));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🛠️"], "outstanding change requests win over approvals");
    await routeEvent(ctx, "pull_request_review", reviewEvent("submitted", 1, "carol", "approved"));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["👍"]);

    await routeEvent(ctx, "pull_request", prEvent("closed", 1, { merged: true }));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["👍", "🔀"]);
    assert.deepEqual(
      ctx.discord.notes(id).map((n) => n.replace(/ \(<.*>\)$/, "")),
      ["🛠️ Changes requested by carol", "👍 Approved by dave", "👍 Approved by carol", "Merged into `main` by bob"],
    );
  });

  it("does not post PRs from ignored authors", async () => {
    const ctx = makeContext(makeConfig({ pullRequests: { ignoreAuthors: ["dependabot[bot]"] } }));
    await routeEvent(ctx, "pull_request", prEvent("opened", 1, { author: "dependabot[bot]" }));
    await routeEvent(ctx, "workflow_run", runEvent({ id: 10, sha: "aaaaaaa1", status: "in_progress" }));
    assert.equal(ctx.discord.sent.length, 0);
  });
});

describe("CI on the default branch", () => {
  const mainRun = (id: number, status: string, conclusion: string | null = null) =>
    runEvent({ id, runNumber: id, sha: `main${id}`, status, conclusion, event: "push", branch: "main" });

  it("posts one message per failing streak and reacts when fixed", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "workflow_run", mainRun(1, "completed", "success"));
    assert.equal(ctx.discord.sent.length, 0, "passing runs on main are silent");

    await routeEvent(ctx, "workflow_run", mainRun(2, "completed", "failure"));
    assert.equal(ctx.discord.posts().length, 1);
    const id = ctx.discord.posts()[0]!.messageId;
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🔴"]);

    await routeEvent(ctx, "workflow_run", mainRun(3, "in_progress"));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟡"]);
    await routeEvent(ctx, "workflow_run", mainRun(3, "completed", "failure"));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🔴"]);
    await routeEvent(ctx, "workflow_run", mainRun(4, "completed", "success"));
    assert.deepEqual(ctx.discord.reactionsOn(id), ["🟢"]);
    assert.equal(ctx.discord.posts().length, 1);
    assert.equal(ctx.discord.notes(id).length, 2);
    assert.match(ctx.discord.notes(id)[0]!, /^Still failing/);
    assert.match(ctx.discord.notes(id)[1]!, /^Fixed at/);

    await routeEvent(ctx, "workflow_run", mainRun(5, "completed", "failure"));
    assert.equal(ctx.discord.posts().length, 2, "a new failure after a fix gets a new message");
  });

  it("ignores stale runs, PR runs from fork branches named main, and ignored workflows", async () => {
    const ctx = makeContext(makeConfig({ ci: { ignoreWorkflows: ["Nightly"] } }));
    await routeEvent(ctx, "workflow_run", mainRun(5, "completed", "success"));
    await routeEvent(ctx, "workflow_run", mainRun(4, "completed", "failure"));
    await routeEvent(ctx, "workflow_run", runEvent({ id: 6, sha: "x", status: "completed", conclusion: "failure", branch: "main", fork: true }));
    await routeEvent(ctx, "workflow_run", { ...mainRun(7, "completed", "failure"), workflow_run: { ...mainRun(7, "completed", "failure").workflow_run, name: "Nightly", workflow_id: 2 } });
    assert.equal(ctx.discord.sent.length, 0);
  });
});

describe("releases", () => {
  it("pings for releases but not pre-releases by default", async () => {
    const ctx = makeContext();
    const release = (tag: string, prerelease: boolean) => ({
      action: "published",
      repository,
      release: { tag_name: tag, name: null, body: "Notes", html_url: `https://github.com/r/${tag}`, prerelease, author: null },
    });
    await routeEvent(ctx, "release", release("v1.0.0", false));
    await routeEvent(ctx, "release", release("v1.1.0-beta", true));
    await routeEvent(ctx, "release", release("v1.0.0", false)); // redelivered

    const [stable, beta] = ctx.discord.posts();
    assert.equal(ctx.discord.posts().length, 2);
    assert.deepEqual(stable?.message.pingRoleIds, [RELEASE_ROLE]);
    assert.equal(stable?.message.embeds?.[0]?.title, "Release v1.0.0");
    assert.deepEqual(beta?.message.pingRoleIds, []);
  });
});

describe("security", () => {
  const dependabot = (action: string, severity = "high") => ({
    action,
    repository,
    sender: { login: "alice" },
    alert: {
      number: 3,
      html_url: `https://github.com/${repository.full_name}/security/dependabot/3`,
      dependency: { package: { ecosystem: "npm", name: "lodash" }, manifest_path: "package-lock.json" },
      security_advisory: { ghsa_id: "GHSA-xxxx", cve_id: "CVE-2026-1", summary: "Prototype pollution", severity },
      security_vulnerability: { first_patched_version: { identifier: "4.17.21" } },
    },
  });

  it("posts new alerts and reacts when they're fixed", async () => {
    const ctx = makeContext();
    await routeEvent(ctx, "dependabot_alert", dependabot("created"));
    const post = ctx.discord.posts()[0]!;
    assert.equal(post.message.embeds?.[0]?.title, "Dependabot: Prototype pollution");
    assert.match(post.message.embeds?.[0]?.description ?? "", /lodash/);

    await routeEvent(ctx, "dependabot_alert", dependabot("fixed"));
    assert.deepEqual(ctx.discord.reactionsOn(post.messageId), ["✅"]);
  });

  it("respects the minimum severity", async () => {
    const ctx = makeContext(makeConfig({ security: { minimumSeverity: "high" } }));
    await routeEvent(ctx, "dependabot_alert", dependabot("created", "medium"));
    assert.equal(ctx.discord.sent.length, 0);
  });

  it("never posts privately reported advisories", async () => {
    const ctx = makeContext();
    const advisory = { ghsa_id: "GHSA-yyyy", cve_id: null, summary: "RCE", severity: "critical", html_url: "https://github.com/a" };
    await routeEvent(ctx, "repository_advisory", { action: "reported", repository, repository_advisory: advisory });
    assert.equal(ctx.discord.sent.length, 0);
    await routeEvent(ctx, "repository_advisory", { action: "published", repository, repository_advisory: advisory });
    assert.equal(ctx.discord.sent.length, 1);
  });
});
