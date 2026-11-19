import type {
  CodeScanningAlertEvent,
  DependabotAlertEvent,
  RepositoryAdvisoryEvent,
  SecretScanningAlertEvent,
} from "../github/payloads.ts";
import { Colors, embed, roleMention } from "../render.ts";
import type { PostKind } from "../store.ts";
import type { Context } from "./context.ts";

const SEVERITY_RANK: Record<string, number> = { low: 1, warning: 1, note: 1, medium: 2, moderate: 2, high: 3, error: 3, critical: 4 };

interface Alert {
  kind: PostKind;
  key: string | number;
  title: string;
  url: string | undefined;
  severity: string | null | undefined;
  description?: string;
  footer: string;
}

async function postAlert(ctx: Context, alert: Alert): Promise<void> {
  if (ctx.store.getPost(alert.kind, alert.key)) return;

  const minimum = SEVERITY_RANK[ctx.config.security.minimumSeverity] ?? 0;
  if (alert.severity && (SEVERITY_RANK[alert.severity.toLowerCase()] ?? 0) < minimum) return;

  const roleId = ctx.config.security.pingRoleId;
  await ctx.updates.post({
    kind: alert.kind,
    key: alert.key,
    title: alert.title,
    message: {
      content: roleId ? roleMention(roleId) : undefined,
      pingRoleIds: roleId ? [roleId] : [],
      embeds: [
        embed({
          title: alert.title,
          url: alert.url,
          description: alert.description,
          color: Colors.security,
          fields: alert.severity ? [{ name: "Severity", value: alert.severity, inline: true }] : undefined,
          footer: { text: alert.footer },
        }),
      ],
    },
  });
}

/** Reflects an alert being resolved, dismissed or reopened on its original post. */
async function updateAlert(
  ctx: Context,
  kind: PostKind,
  key: string | number,
  outcome: "resolved" | "dismissed" | "reopened",
  sender: string | undefined,
): Promise<void> {
  const post = ctx.store.getPost(kind, key);
  if (!post) return;
  const { emoji } = ctx.config;
  const by = sender ? ` by ${sender}` : "";
  const reaction = outcome === "resolved" ? emoji.alertResolved : outcome === "dismissed" ? emoji.alertDismissed : null;
  await ctx.updates.setReaction(post, "lifecycle", reaction);
  await ctx.updates.note(post, outcome === "resolved" ? "Fixed" : outcome === "dismissed" ? `Dismissed${by}` : `Reopened${by}`);
}

export async function handleDependabotAlert(ctx: Context, event: DependabotAlertEvent): Promise<void> {
  if (!ctx.config.security.dependabotAlerts) return;
  const { alert } = event;
  const sender = event.sender?.login;

  switch (event.action) {
    case "created": {
      const advisory = alert.security_advisory;
      const pkg = alert.dependency.package;
      const patched = alert.security_vulnerability.first_patched_version?.identifier;
      const lines = [
        pkg && `Package: \`${pkg.name}\` (${pkg.ecosystem})${alert.dependency.manifest_path ? ` in \`${alert.dependency.manifest_path}\`` : ""}`,
        patched && `Fixed in: \`${patched}\``,
        [advisory.ghsa_id, advisory.cve_id].filter(Boolean).join(" · "),
      ];
      await postAlert(ctx, {
        kind: "dependabot",
        key: alert.number,
        title: `Dependabot: ${advisory.summary}`,
        url: alert.html_url,
        severity: advisory.severity,
        description: lines.filter(Boolean).join("\n"),
        footer: "Dependabot alert",
      });
      return;
    }
    case "fixed":
      return updateAlert(ctx, "dependabot", alert.number, "resolved", sender);
    case "dismissed":
    case "auto_dismissed":
      return updateAlert(ctx, "dependabot", alert.number, "dismissed", sender);
    case "reopened":
    case "auto_reopened":
    case "reintroduced":
      return updateAlert(ctx, "dependabot", alert.number, "reopened", sender);
  }
}

export async function handleRepositoryAdvisory(ctx: Context, event: RepositoryAdvisoryEvent): Promise<void> {
  // Only "published": a privately reported advisory must not be broadcast before it's public.
  if (!ctx.config.security.repositoryAdvisories || event.action !== "published") return;
  const advisory = event.repository_advisory;
  await postAlert(ctx, {
    kind: "advisory",
    key: advisory.ghsa_id,
    title: `Security advisory: ${advisory.summary}`,
    url: advisory.html_url,
    severity: advisory.severity,
    description: [advisory.ghsa_id, advisory.cve_id].filter(Boolean).join(" · "),
    footer: "Security advisory published",
  });
}

export async function handleCodeScanningAlert(ctx: Context, event: CodeScanningAlertEvent): Promise<void> {
  if (!ctx.config.security.codeScanningAlerts) return;
  const { alert } = event;
  const sender = event.sender?.login;

  switch (event.action) {
    case "created":
      await postAlert(ctx, {
        kind: "code-scanning",
        key: alert.number,
        title: `Code scanning: ${alert.rule.description ?? "new alert"}`,
        url: alert.html_url,
        severity: alert.rule.security_severity_level ?? alert.rule.severity,
        description: alert.tool ? `Found by ${alert.tool.name}` : undefined,
        footer: "Code scanning alert",
      });
      return;
    case "fixed":
      return updateAlert(ctx, "code-scanning", alert.number, "resolved", sender);
    case "closed_by_user":
      return updateAlert(ctx, "code-scanning", alert.number, "dismissed", sender);
    case "reopened":
    case "reopened_by_user":
      return updateAlert(ctx, "code-scanning", alert.number, "reopened", sender);
  }
}

export async function handleSecretScanningAlert(ctx: Context, event: SecretScanningAlertEvent): Promise<void> {
  if (!ctx.config.security.secretScanningAlerts) return;
  const { alert } = event;
  if (alert.number === undefined) return;
  const sender = event.sender?.login;

  switch (event.action) {
    case "created":
      // Deliberately says nothing about where or what the secret is; the link is access-controlled.
      await postAlert(ctx, {
        kind: "secret-scanning",
        key: alert.number,
        title: `Secret scanning: ${alert.secret_type_display_name ?? "secret"} detected`,
        url: alert.html_url,
        severity: undefined,
        footer: "Secret scanning alert",
      });
      return;
    case "resolved":
      return updateAlert(ctx, "secret-scanning", alert.number, "resolved", sender);
    case "reopened":
      return updateAlert(ctx, "secret-scanning", alert.number, "reopened", sender);
  }
}
