import { readFileSync } from "node:fs";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{15,22}$/, "must be a Discord ID (snowflake)");

const emojiSchema = z.object({
  ciPending: z.string().default("🟡"),
  ciFailure: z.string().default("🔴"),
  ciSuccess: z.string().default("🟢"),
  reviewApproved: z.string().default("👍"),
  reviewChangesRequested: z.string().default("🛠️"),
  issueCompleted: z.string().default("✅"),
  issueNotPlanned: z.string().default("🚫"),
  prMerged: z.string().default("🔀"),
  prClosed: z.string().default("🗑️"),
  alertResolved: z.string().default("✅"),
  alertDismissed: z.string().default("🚫"),
});

const fileSchema = z.object({
  github: z.object({
    /** The repository KT reports on, as "owner/name". Events for other repositories are ignored. */
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must look like "owner/name"'),
  }),
  server: z
    .object({
      port: z.number().int().positive().default(8080),
      path: z.string().startsWith("/").default("/webhook"),
    })
    .prefault({}),
  databasePath: z.string().default("data/kt.db"),
  discord: z.object({
    /** Where repository updates are posted. */
    updatesChannelId: snowflake,
    /** Channels (and their threads) where KT responds to humans, e.g. expanding "#123". */
    chatChannelIds: z.array(snowflake).default([]),
  }),
  issues: z
    .object({
      /** An issue opened with (or later given) any of these labels pings `pingRoleId`. */
      pingLabels: z.array(z.string()).default([]),
      pingRoleId: snowflake.optional(),
      ignoreAuthors: z.array(z.string()).default([]),
    })
    .prefault({}),
  pullRequests: z
    .object({
      ignoreAuthors: z.array(z.string()).default([]),
    })
    .prefault({}),
  releases: z
    .object({
      pingRoleId: snowflake.optional(),
      pingOnPrerelease: z.boolean().default(false),
    })
    .prefault({}),
  security: z
    .object({
      pingRoleId: snowflake.optional(),
      /** Alerts below this severity aren't posted. */
      minimumSeverity: z.enum(["low", "medium", "high", "critical"]).default("low"),
      dependabotAlerts: z.boolean().default(true),
      repositoryAdvisories: z.boolean().default(true),
      codeScanningAlerts: z.boolean().default(true),
      secretScanningAlerts: z.boolean().default(true),
    })
    .prefault({}),
  ci: z
    .object({
      /** Workflow names that never affect reactions or default-branch failure posts. */
      ignoreWorkflows: z.array(z.string()).default([]),
      /** Post a message when a workflow fails on the default branch. */
      reportDefaultBranchFailures: z.boolean().default(true),
    })
    .prefault({}),
  threads: z
    .object({
      /** Record follow-ups (closed, merged, reviews, CI failures) in a thread on the original message. */
      enabled: z.boolean().default(true),
      autoArchiveMinutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).default(1440),
    })
    .prefault({}),
  linker: z
    .object({
      maxLinksPerMessage: z.number().int().positive().default(5),
    })
    .prefault({}),
  emoji: emojiSchema.prefault({}),
});

export type Emoji = z.infer<typeof emojiSchema>;

export type Config = z.infer<typeof fileSchema> & {
  secrets: {
    discordToken: string;
    webhookSecret: string;
    /** Optional; used to look up issue titles for the "#123" linker. */
    githubToken: string | undefined;
  };
};

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv): Config {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }

  const missing = ["DISCORD_TOKEN", "GITHUB_WEBHOOK_SECRET"].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    ...parsed.data,
    secrets: {
      discordToken: env.DISCORD_TOKEN!,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET!,
      githubToken: env.GITHUB_TOKEN || undefined,
    },
  };
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): Config {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")), env);
}
