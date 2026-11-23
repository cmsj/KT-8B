# KT-8B

KT-8B ("KT") is a Discord bot for integrating with GitHub. It does two jobs:

1. **In chat channels**, when someone mentions `#123`, KT replies with a link, the title and the state of that issue or PR.
2. **In an updates channel**, KT posts the GitHub events worth knowing about, and folds what happens afterwards into reactions on those posts rather than posting more messages.

KT does not try to be an audit log. A new issue is news. The 27th comment on it, or six skipped workflow runs, are not.

## What gets posted

| Event | Message | What happens afterwards |
| --- | --- | --- |
| Issue opened | Embed with title, author, a short summary and labels. Pings `issues.pingRoleId` if the issue has a label in `issues.pingLabels`. | Closed → ✅ (completed) or 🚫 (not planned or duplicate). Reopened → the reaction is removed. If a ping label is added later, KT replies once to the post with the ping. |
| PR opened | Embed with title, author, branch, size and a summary. | **CI**: 🟡 running, 🔴 any workflow failed, 🟢 all passed. **Review**: 👍 approved, 🛠️ changes requested. **Lifecycle**: 🔀 merged, 🗑️ closed. |
| Release published | Embed with the release notes. Posted in `releases.channelId` if set, otherwise the updates channel. Pings `releases.pingRoleId` (for pre-releases too only if `pingOnPrerelease` is set). | — |
| Security alert | Dependabot alerts, published repository advisories, code scanning and secret scanning alerts. Optionally pings `security.pingRoleId`. | ✅ fixed, 🚫 dismissed, the reaction is removed if the alert is reopened. |
| Workflow fails on the default branch | One message per workflow while it stays broken. | 🟡 while a new run is going, 🔴 still failing, 🟢 fixed. The next failure after a fix gets a new message. |

Each post has three independent reaction **slots** (CI, review, lifecycle). Each slot shows at most one emoji, and a new state replaces the old one. All emoji can be changed under `emoji` in the config, and custom server emoji (`<:name:id>`) work too.

### Follow-up threads

When something happens to a post (closed, merged, reopened, a review, CI starting to fail, a default-branch failure being fixed), KT also adds one line about it to a thread on that post. The thread is created the first time it's needed. This keeps a history without adding messages to the channel. Turn it off with `threads.enabled: false`.

### How CI is worked out

- KT watches `workflow_run` events and matches them to PRs by **head commit**. This works for PRs from forks, where GitHub sends an empty `pull_requests` list.
- For each workflow (and each trigger, since a commit can be built as both a `push` and a `pull_request`), only the newest run counts. Re-running a workflow updates that run.
- `skipped` and `cancelled` runs are ignored. `failure`, `timed_out` and `startup_failure` count as failures. A fork's workflows waiting for approval count as running.
- Pushing to a PR clears its CI reaction until the new commit's workflows report.
- Events that arrive out of order (for example `in_progress` after `completed`) are ignored, and runs that start before the PR is posted are picked up when it is.
- Workflows listed in `ci.ignoreWorkflows` never affect anything.

## Setup

### 1. Discord application

1. Create an application and bot at <https://discord.com/developers/applications>.
2. If you use chat channels, enable the **Message Content** privileged intent under *Bot*.
3. Invite the bot with the `bot` scope and these permissions: View Channels, Send Messages, Embed Links, Add Reactions, Read Message History, Create Public Threads, Send Messages in Threads.
4. Make sure the roles you want pinged can be mentioned by the bot. Either the role is mentionable, or the bot has *Mention @everyone, @here, and All Roles*.

To get channel and role IDs, turn on Developer Mode in Discord and right-click → *Copy ID*.

### 2. Configuration

```sh
cp config.example.json config.json   # then fill in the IDs and repo
cp .env.example .env                 # then fill in the secrets
```

Secrets come from the environment:

| Variable | |
| --- | --- |
| `DISCORD_TOKEN` | Bot token. Required. |
| `GITHUB_WEBHOOK_SECRET` | The secret you set on the GitHub webhook. Required. |
| `GITHUB_TOKEN` | Optional. The `#123` linker uses it to look up titles. Without it, GitHub allows 60 lookups an hour. A fine-grained token with read-only Issues and Pull requests access is enough. |
| `KT_CONFIG` | Path to the config file. Defaults to `config.json` (`/config/config.json` in Docker). |
| `KT_LOG_LEVEL` | Set to `debug` to log every delivery KT receives and why it did or didn't post or update anything. |

`src/config.ts` documents every option and its default. You only need `github.repo` and `discord.updatesChannelId`.

### 3. Run it

```sh
docker compose up -d --build
```

Each published GitHub release also builds a multi-arch image at `ghcr.io/<owner>/<repo>`. A release tagged `v1.2.3` is published as `1.2.3`, `1.2`, `1` and `latest`. A pre-release gets only its exact version tag. Release tags must be semver (`v1.2.3`). To use the published image, replace `build: .` in `compose.yaml` with `image: ghcr.io/<owner>/<repo>:1`.

Or without Docker (Node 24 or newer runs the TypeScript directly, so there is no build step):

```sh
npm ci && npm start
```

KT stores the posts it made, workflow runs and reviews in SQLite (`databasePath`, which is `/data` in Docker). Keep that file between restarts, or KT loses track of which message belongs to which issue or PR.

### 4. GitHub webhook

In the repository, go to *Settings → Webhooks → Add webhook*:

- **Payload URL**: `https://<your host>/webhook`. Port 8080 needs to be reachable through your reverse proxy or tunnel.
- **Content type**: `application/json`
- **Secret**: the same value as `GITHUB_WEBHOOK_SECRET`
- **Events**: *Let me select individual events* → Issues, Pull requests, Pull request reviews, Releases, Workflow runs, Dependabot alerts, Repository advisories, Code scanning alerts, Secret scanning alerts.

KT ignores events for any repository other than `github.repo`, and logs a warning naming both repositories. If the repository is renamed or transferred, GitHub keeps sending to the same webhook, but under the new name, so update `github.repo` to match. Redeliveries of an event KT has already handled are also ignored. If handling failed, or the event was ignored because it was for a different repository, you can redeliver the event from GitHub's webhook page and KT will try again.

> **Note:** Dependabot, code scanning and secret scanning alerts are normally visible only to people with access to the repository's security tab. Posting them makes their titles visible to everyone in the updates channel. Turn off any you don't want under `security`. KT only posts repository advisories once they're **published**, never when they're privately reported. KT never includes the contents of a secret scanning alert.

## Development

```sh
npm test            # node:test, including whole event sequences against a fake Discord
npm run typecheck   # also checks KT's payload types against GitHub's published webhook schemas
```

Layout:

- `src/main.ts`: wiring. The Discord client, the webhook server, and a queue that handles events one at a time.
- `src/webhook-server.ts`: signature verification and HTTP.
- `src/router.ts`: maps GitHub event names to handlers.
- `src/handlers/`: one file per area (issues, pulls, workflows, releases, security).
- `src/discord/updates.ts`: posting, reaction slots and follow-up threads.
- `src/ci.ts`: turns workflow runs into a single CI state.
- `src/chat/linker.ts`: the `#123` responder.
- `src/store.ts`: SQLite state.
