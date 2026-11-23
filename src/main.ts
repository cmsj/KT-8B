import { Client, Events, GatewayIntentBits, type Message, MessageType } from "discord.js";
import { IssueLookup, extractReferences, linkReferences } from "./chat/linker.ts";
import { type Config, loadConfig } from "./config.ts";
import { RestGateway } from "./discord/gateway.ts";
import { Updates } from "./discord/updates.ts";
import type { Context } from "./handlers/context.ts";
import { consoleLogger as log } from "./log.ts";
import { routeEvent } from "./router.ts";
import { Store } from "./store.ts";
import { type WebhookDelivery, createWebhookServer } from "./webhook-server.ts";

let config: Config;
try {
  config = loadConfig(process.env.KT_CONFIG ?? "config.json");
} catch (error) {
  // Configuration mistakes are the user's to fix, so explain them without a stack trace.
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const store = new Store(config.databasePath);

const intents = new Set([GatewayIntentBits.Guilds]);
if (config.threads.enabled) {
  // Seeing the "KT started a thread" messages, so they can be deleted. Not privileged.
  intents.add(GatewayIntentBits.GuildMessages);
}
if (config.discord.chatChannelIds.length > 0) {
  // Reading "#123" in chat needs the privileged Message Content intent (enable it in the Developer Portal).
  intents.add(GatewayIntentBits.GuildMessages).add(GatewayIntentBits.MessageContent);
}
const client = new Client({ intents: [...intents] });

const ctx: Context = { config, store, updates: new Updates(config, store, new RestGateway(client), log), log };

// Events are handled one at a time: they're infrequent, and it means two events
// about the same PR can't race each other's reaction updates.
let queue: Promise<void> = Promise.resolve();
function enqueue({ id, event, payload }: WebhookDelivery): void {
  queue = queue.then(async () => {
    if (store.hasDelivery(id)) {
      log.debug(`skipping delivery ${id} (${event}): already handled`);
      return;
    }
    try {
      if (await routeEvent(ctx, event, payload)) store.recordDelivery(id);
    } catch (error) {
      log.error(`failed to handle ${event} delivery ${id}`, error);
    }
  });
}

function listenForChat(config: Config): void {
  const lookup = new IssueLookup(config.github.repo, config.secrets.githubToken, log);
  const channels = new Set(config.discord.chatChannelIds);

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    const channel = message.channel;
    const inChatChannel = channels.has(channel.id) || (channel.isThread() && channel.parentId !== null && channels.has(channel.parentId));
    if (!inChatChannel) return;

    const numbers = extractReferences(message.content, config.linker.maxLinksPerMessage);
    if (numbers.length === 0) return;

    try {
      const lines = await linkReferences(config.github.repo, numbers, lookup);
      if (lines.length === 0) return;
      // Silent: no notification for anyone, and no link previews.
      await message.reply({
        content: lines.join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
        flags: ["SuppressEmbeds", "SuppressNotifications"],
      });
    } catch (error) {
      log.warn("failed to reply with issue links", error);
    }
  });
}

/**
 * Discord announces every thread KT starts with a "KT-8B started a thread" message in the
 * channel, which is exactly the clutter the follow-up threads exist to avoid. KT is the
 * author of those messages, so it can delete them without the Manage Messages permission.
 */
function deleteThreadAnnouncements(): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.type !== MessageType.ThreadCreated || message.author.id !== client.user?.id) return;
    try {
      await message.delete();
      log.debug(`deleted the announcement of thread ${message.reference?.channelId} in channel ${message.channelId}`);
    } catch (error) {
      log.warn("could not delete a thread announcement", error);
    }
  });
}

if (config.discord.chatChannelIds.length > 0) listenForChat(config);
if (config.threads.enabled) deleteThreadAnnouncements();

client.once(Events.ClientReady, (ready) => {
  log.info(`logged in to Discord as ${ready.user.tag}`);
  log.info(`reporting on ${config.github.repo} in channel ${config.discord.updatesChannelId}`);
  log.debug("debug logging is on");
  const server = createWebhookServer({ path: config.server.path, secret: config.secrets.webhookSecret, log, onDelivery: enqueue });
  server.listen(config.server.port, () => log.info(`listening for GitHub webhooks on :${config.server.port}${config.server.path}`));

  const pruneTimer = setInterval(() => store.prune(), 24 * 60 * 60 * 1000);
  pruneTimer.unref();

  const shutdown = (signal: string) => {
    log.info(`${signal} received, shutting down`);
    server.close();
    void queue.finally(async () => {
      await client.destroy();
      store.close();
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
});

await client.login(config.secrets.discordToken);
