import type { ReleaseEvent } from "../github/payloads.ts";
import { Colors, author, embed, roleMention, summarize } from "../render.ts";
import type { Context } from "./context.ts";

export async function handleRelease(ctx: Context, event: ReleaseEvent): Promise<void> {
  // "published" covers both releases and pre-releases; drafts don't fire it until they're published.
  if (event.action !== "published") return;
  const { release } = event;
  if (ctx.store.getPost("release", release.tag_name)) return ctx.log.debug(`release ${release.tag_name} is already posted`);

  const { channelId, pingRoleId, pingOnPrerelease } = ctx.config.releases;
  const ping = pingRoleId !== undefined && (!release.prerelease || pingOnPrerelease);
  if (pingRoleId !== undefined && !ping) ctx.log.debug(`not pinging for pre-release ${release.tag_name} because releases.pingOnPrerelease is off`);
  const name = release.name?.trim() || release.tag_name;
  const kind = release.prerelease ? "Pre-release" : "Release";

  await ctx.updates.post({
    kind: "release",
    key: release.tag_name,
    channelId,
    title: `${kind} ${name}`,
    message: {
      content: ping ? `${roleMention(pingRoleId)} ${kind.toLowerCase()} **${name}** is out` : undefined,
      pingRoleIds: ping ? [pingRoleId] : [],
      embeds: [
        embed({
          title: name === release.tag_name ? `${kind} ${name}` : `${kind} ${name} (${release.tag_name})`,
          url: release.html_url,
          author: author(release.author),
          description: summarize(release.body, 1500),
          color: Colors.release,
          footer: { text: `New ${kind.toLowerCase()}` },
        }),
      ],
    },
  });
}
