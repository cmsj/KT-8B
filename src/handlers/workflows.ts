import { type CiState, aggregateCi, failedRuns, runOutcome } from "../ci.ts";
import type { Emoji } from "../config.ts";
import type { Repository, WorkflowRunEvent } from "../github/payloads.ts";
import { Colors, embed, firstLine, link, shortSha } from "../render.ts";
import type { Post, Run } from "../store.ts";
import type { Context } from "./context.ts";

export function ciEmoji(emoji: Emoji, state: CiState | null): string | null {
  switch (state) {
    case "pending":
      return emoji.ciPending;
    case "failure":
      return emoji.ciFailure;
    case "success":
      return emoji.ciSuccess;
    case null:
      return null;
  }
}

/** Brings a PR post's CI reaction in line with the runs recorded for its head commit. */
export async function syncPullRequestCi(ctx: Context, post: Post): Promise<void> {
  if (!post.headSha) return;
  const { ignoreWorkflows } = ctx.config.ci;
  const runs = ctx.store.runsForHeadSha(post.headSha);
  const state = aggregateCi(runs, ignoreWorkflows);
  const previous = post.state.ci ?? null;

  await ctx.updates.setReaction(post, "ci", ciEmoji(ctx.config.emoji, state));
  if (state === previous) return;

  post.state.ci = state;
  ctx.updates.save(post);
  if (state === "failure") {
    const failures = failedRuns(runs, ignoreWorkflows).map((run) => link(run.workflowName, run.htmlUrl));
    await ctx.updates.note(post, `${ctx.config.emoji.ciFailure} CI failed on \`${shortSha(post.headSha)}\`: ${failures.join(", ")}`);
  }
}

export async function handleWorkflowRun(ctx: Context, event: WorkflowRunEvent): Promise<void> {
  const wr = event.workflow_run;
  const repo = event.repository;
  const run: Run = {
    id: wr.id,
    workflowId: wr.workflow_id,
    workflowName: wr.name ?? `workflow ${wr.workflow_id}`,
    runNumber: wr.run_number,
    runAttempt: wr.run_attempt,
    headSha: wr.head_sha,
    headBranch: wr.head_branch,
    event: wr.event,
    status: wr.status ?? "queued",
    conclusion: wr.conclusion,
    htmlUrl: wr.html_url,
    // A fork's PR can come from a branch that is also called "main", so check where the commit lives.
    onRepoBranch: !wr.event.startsWith("pull_request") && wr.head_repository?.full_name === repo?.full_name,
  };

  if (!ctx.store.upsertRun(run)) return; // stale, out-of-order delivery

  // Fork PRs arrive with an empty pull_requests list, so match PRs on their head commit instead.
  for (const post of ctx.store.postsForHeadSha(run.headSha)) {
    if (post.kind === "pr") await syncPullRequestCi(ctx, post);
  }

  if (
    repo &&
    ctx.config.ci.reportDefaultBranchFailures &&
    run.onRepoBranch &&
    run.headBranch === repo.default_branch &&
    !ctx.config.ci.ignoreWorkflows.includes(run.workflowName)
  ) {
    await trackDefaultBranch(ctx, run, event.workflow_run.head_commit, repo);
  }
}

/**
 * A failing workflow on the default branch gets one message, which then tracks
 * that workflow (pending → failing → fixed) until a run passes. The next failure
 * after that starts a new message.
 */
async function trackDefaultBranch(
  ctx: Context,
  run: Run,
  commit: WorkflowRunEvent["workflow_run"]["head_commit"],
  repo: Repository,
): Promise<void> {
  // Only the newest run of the workflow says anything about the branch's current state.
  if (ctx.store.latestBranchRun(run.workflowId, repo.default_branch)?.id !== run.id) return;

  const { emoji } = ctx.config;
  const post = ctx.store.getPost("ci-main", run.workflowId);
  const outcome = runOutcome(run);
  const commitText = `${link(shortSha(run.headSha), `${repo.html_url}/commit/${run.headSha}`)}${commit ? ` ${firstLine(commit.message)}` : ""}`;
  const attempt = `${run.id}:${run.runAttempt}`;

  if (outcome === "failure") {
    if (!post) {
      const created = await ctx.updates.post({
        kind: "ci-main",
        key: run.workflowId,
        title: `${run.workflowName} failing on ${repo.default_branch}`,
        state: { attempt },
        message: {
          embeds: [
            embed({
              title: `${run.workflowName} is failing on ${repo.default_branch}`,
              url: run.htmlUrl,
              description: `${commitText}${commit ? `\n— ${commit.author.name}` : ""}`,
              color: Colors.ciFailure,
              footer: { text: "CI failure" },
            }),
          ],
        },
      });
      await ctx.updates.setReaction(created, "ci", emoji.ciFailure);
    } else {
      await ctx.updates.setReaction(post, "ci", emoji.ciFailure);
      if (post.state.attempt !== attempt) {
        post.state.attempt = attempt;
        ctx.updates.save(post);
        await ctx.updates.note(post, `Still failing at ${commitText} (${link("run", run.htmlUrl)})`);
      }
    }
    return;
  }

  if (!post) return;

  if (outcome === "pending") {
    await ctx.updates.setReaction(post, "ci", emoji.ciPending);
  } else if (outcome === "success") {
    await ctx.updates.setReaction(post, "ci", emoji.ciSuccess);
    await ctx.updates.note(post, `Fixed at ${commitText} (${link("run", run.htmlUrl)})`);
    ctx.store.deletePost("ci-main", run.workflowId);
  } else {
    // Skipped or cancelled: nothing has changed, so it's still failing as far as we know.
    await ctx.updates.setReaction(post, "ci", emoji.ciFailure);
  }
}
