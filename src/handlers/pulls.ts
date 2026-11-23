import type { PullRequestEvent, PullRequestReviewEvent } from "../github/payloads.ts";
import { Colors, author, embed, summarize } from "../render.ts";
import type { ReviewState } from "../store.ts";
import type { Context } from "./context.ts";
import { syncPullRequestCi } from "./workflows.ts";

export async function handlePullRequest(ctx: Context, event: PullRequestEvent): Promise<void> {
  const pr = event.pull_request;
  const { emoji } = ctx.config;
  const post = ctx.store.getPost("pr", pr.number);
  const by = event.sender ? ` by ${event.sender.login}` : "";

  if (!post && event.action !== "opened") {
    ctx.log.debug(`no post for PR #${pr.number} (not opened while KT was listening, or by an ignored author), so nothing to update`);
  }

  switch (event.action) {
    case "opened": {
      if (post) return ctx.log.debug(`PR #${pr.number} is already posted`);
      if (ctx.config.pullRequests.ignoreAuthors.includes(pr.user?.login ?? "")) {
        return ctx.log.debug(`not posting PR #${pr.number}: ${pr.user?.login} is in pullRequests.ignoreAuthors`);
      }

      const stats =
        pr.changed_files !== undefined
          ? `${pr.changed_files} file${pr.changed_files === 1 ? "" : "s"}, +${pr.additions ?? 0} −${pr.deletions ?? 0}`
          : undefined;
      const created = await ctx.updates.post({
        kind: "pr",
        key: pr.number,
        title: `#${pr.number} ${pr.title}`,
        headSha: pr.head.sha,
        message: {
          embeds: [
            embed({
              title: `#${pr.number} ${pr.title}`,
              url: pr.html_url,
              author: author(pr.user),
              description: summarize(pr.body, 300),
              color: pr.draft ? Colors.draft : Colors.pr,
              fields: [
                { name: "Branch", value: `\`${pr.head.label ?? pr.head.ref}\` → \`${pr.base.ref}\``, inline: true },
                ...(stats ? [{ name: "Changes", value: stats, inline: true }] : []),
              ],
              footer: { text: pr.draft ? "New draft pull request" : "New pull request" },
            }),
          ],
        },
      });
      // Workflows often start before GitHub delivers "opened", so there may already be runs to reflect.
      await syncPullRequestCi(ctx, created);
      return;
    }

    case "synchronize": {
      if (!post) return;
      post.headSha = pr.head.sha;
      ctx.updates.save(post);
      await syncPullRequestCi(ctx, post);
      return;
    }

    case "closed": {
      if (!post) return;
      await ctx.updates.setReaction(post, "lifecycle", pr.merged ? emoji.prMerged : emoji.prClosed);
      await ctx.updates.note(post, pr.merged ? `Merged into \`${pr.base.ref}\`${by}` : `Closed without merging${by}`);
      return;
    }

    case "reopened": {
      if (!post) return;
      await ctx.updates.setReaction(post, "lifecycle", null);
      await ctx.updates.note(post, `Reopened${by}`);
      return;
    }

    case "ready_for_review": {
      if (post) await ctx.updates.note(post, `Ready for review`);
      return;
    }

    case "converted_to_draft": {
      if (post) await ctx.updates.note(post, `Converted to draft${by}`);
      return;
    }
  }
}

export async function handlePullRequestReview(ctx: Context, event: PullRequestReviewEvent): Promise<void> {
  const number = event.pull_request.number;
  const reviewer = event.review.user?.login;
  const post = ctx.store.getPost("pr", number);
  if (!reviewer) return;

  const submitted = event.review.state.toLowerCase();
  let state: ReviewState | null;
  if (event.action === "dismissed") {
    state = null;
  } else if (event.action === "submitted" && (submitted === "approved" || submitted === "changes_requested")) {
    state = submitted;
  } else {
    return; // plain review comments don't change anything
  }

  // Track reviews even without a post, so the reaction is right if one exists later.
  ctx.store.setReview(number, reviewer, state);
  if (!post) return;

  const states = ctx.store.reviewStates(number);
  const { emoji } = ctx.config;
  const reaction = states.includes("changes_requested")
    ? emoji.reviewChangesRequested
    : states.includes("approved")
      ? emoji.reviewApproved
      : null;
  await ctx.updates.setReaction(post, "review", reaction);

  const text =
    state === "approved"
      ? `${emoji.reviewApproved} Approved by ${reviewer}`
      : state === "changes_requested"
        ? `${emoji.reviewChangesRequested} Changes requested by ${reviewer}`
        : `Review by ${reviewer} dismissed`;
  await ctx.updates.note(post, `${text} (<${event.review.html_url}>)`);
}
