import type { APIEmbed, APIEmbedAuthor } from "discord.js";
import type { User } from "./github/payloads.ts";

export const Colors = {
  issue: 0x1a7f37,
  pr: 0x0969da,
  draft: 0x6e7781,
  release: 0x8250df,
  security: 0xcf222e,
  ciFailure: 0xbc4c00,
} as const;

/**
 * Trims an issue/PR/release body down to a readable teaser: drops HTML comments
 * (issue templates are full of them), collapses runs of blank lines, and cuts
 * at a line or word boundary near `max` characters.
 */
export function summarize(body: string | null | undefined, max: number): string | undefined {
  if (!body) return undefined;
  const text = body
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length === 0) return undefined;
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()} …`;
}

export function author(user: User | null | undefined): APIEmbedAuthor | undefined {
  if (!user) return undefined;
  return { name: user.login, url: user.html_url, icon_url: user.avatar_url };
}

export function roleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** A link whose preview Discord won't unfurl. */
export function link(text: string, url: string): string {
  return `[${text.replace(/([[\]])/g, "\\$1")}](<${url}>)`;
}

export function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

export function embed(fields: APIEmbed): APIEmbed {
  // Discord rejects titles over 256 characters.
  return fields.title && fields.title.length > 256 ? { ...fields, title: `${fields.title.slice(0, 255)}…` } : fields;
}
