import type { IssuesEvent } from "../github/payloads.ts";
import { Colors, author, embed, roleMention, summarize } from "../render.ts";
import type { Context } from "./context.ts";

export async function handleIssues(ctx: Context, event: IssuesEvent): Promise<void> {
  const { issue } = event;
  const { emoji } = ctx.config;
  const post = ctx.store.getPost("issue", issue.number);
  const by = event.sender ? ` by ${event.sender.login}` : "";

  switch (event.action) {
    case "opened": {
      if (post || ctx.config.issues.ignoreAuthors.includes(issue.user?.login ?? "")) return;

      const labels = (issue.labels ?? []).flatMap((label) => (label ? [label.name] : []));
      const pingLabels = labels.filter((label) => ctx.config.issues.pingLabels.includes(label));
      const roleId = ctx.config.issues.pingRoleId;
      const ping = roleId !== undefined && pingLabels.length > 0;

      await ctx.updates.post({
        kind: "issue",
        key: issue.number,
        title: `#${issue.number} ${issue.title}`,
        state: { pinged: ping },
        message: {
          content: ping ? `${roleMention(roleId)} new issue labelled ${pingLabels.map((l) => `\`${l}\``).join(", ")}` : undefined,
          pingRoleIds: ping ? [roleId] : [],
          embeds: [
            embed({
              title: `#${issue.number} ${issue.title}`,
              url: issue.html_url,
              author: author(issue.user),
              description: summarize(issue.body, 300),
              color: Colors.issue,
              fields: labels.length > 0 ? [{ name: "Labels", value: labels.join(", "), inline: true }] : undefined,
              footer: { text: "New issue" },
            }),
          ],
        },
      });
      return;
    }

    case "labeled": {
      // Triage often adds labels after the issue is opened; ping then, but only once per issue.
      const label = event.label?.name;
      const roleId = ctx.config.issues.pingRoleId;
      if (!post || post.state.pinged || !label || !roleId || !ctx.config.issues.pingLabels.includes(label)) return;
      post.state.pinged = true;
      ctx.updates.save(post);
      await ctx.updates.reply(post, {
        content: `${roleMention(roleId)} issue #${issue.number} is now labelled \`${label}\``,
        pingRoleIds: [roleId],
      });
      return;
    }

    case "closed": {
      if (!post) return;
      const notPlanned = issue.state_reason === "not_planned" || issue.state_reason === "duplicate";
      await ctx.updates.setReaction(post, "lifecycle", notPlanned ? emoji.issueNotPlanned : emoji.issueCompleted);
      const reason = issue.state_reason === "duplicate" ? "as a duplicate" : notPlanned ? "as not planned" : "as completed";
      await ctx.updates.note(post, `Closed ${reason}${by}`);
      return;
    }

    case "reopened": {
      if (!post) return;
      await ctx.updates.setReaction(post, "lifecycle", null);
      await ctx.updates.note(post, `Reopened${by}`);
      return;
    }
  }
}
