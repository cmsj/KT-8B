import { type APIEmbed, type APIMessage, type APIThreadChannel, type Client, MessageFlags, Routes } from "discord.js";

export interface OutgoingMessage {
  content?: string;
  embeds?: APIEmbed[];
  /** Roles that may actually be pinged by this message; any other mention is rendered silently. */
  pingRoleIds?: string[];
  replyToMessageId?: string;
  suppressEmbeds?: boolean;
}

/** The handful of Discord operations KT needs. Kept narrow so handlers can be tested against a fake. */
export interface DiscordGateway {
  send(channelId: string, message: OutgoingMessage): Promise<string>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  startThread(channelId: string, messageId: string, name: string, autoArchiveMinutes: number): Promise<string>;
}

/** Discord wants "name:id" for custom emoji and the raw (URL-encoded) character for unicode emoji. */
export function encodeEmoji(emoji: string): string {
  const custom = /^<a?:(\w+):(\d+)>$/.exec(emoji);
  return encodeURIComponent(custom ? `${custom[1]}:${custom[2]}` : emoji);
}

export class RestGateway implements DiscordGateway {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const body = {
      content: message.content,
      embeds: message.embeds,
      allowed_mentions: { parse: [], roles: message.pingRoleIds ?? [], replied_user: false },
      message_reference: message.replyToMessageId ? { message_id: message.replyToMessageId, fail_if_not_exists: false } : undefined,
      flags: message.suppressEmbeds ? MessageFlags.SuppressEmbeds : undefined,
    };
    const sent = (await this.client.rest.post(Routes.channelMessages(channelId), { body })) as APIMessage;
    return sent.id;
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.client.rest.put(Routes.channelMessageOwnReaction(channelId, messageId, encodeEmoji(emoji)));
  }

  async removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.client.rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, encodeEmoji(emoji)));
  }

  async startThread(channelId: string, messageId: string, name: string, autoArchiveMinutes: number): Promise<string> {
    const thread = (await this.client.rest.post(Routes.threads(channelId, messageId), {
      body: { name: name.slice(0, 100), auto_archive_duration: autoArchiveMinutes },
    })) as APIThreadChannel;
    return thread.id;
  }
}
