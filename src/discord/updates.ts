import type { Config } from "../config.ts";
import type { Logger } from "../log.ts";
import type { Post, PostKind, ReactionSlot, Store } from "../store.ts";
import type { DiscordGateway, OutgoingMessage } from "./gateway.ts";

export interface NewPost {
  kind: PostKind;
  key: string | number;
  message: OutgoingMessage;
  /** Used to name the follow-up thread, if one is ever needed. */
  title: string;
  headSha?: string;
  state?: Record<string, unknown>;
}

/**
 * Everything KT does in the updates channel: posting messages, keeping each
 * message's reaction slots in sync, and recording follow-ups in threads.
 * Discord failures on follow-ups are logged rather than thrown, so one deleted
 * message or missing permission doesn't stop the rest of an event being handled.
 */
export class Updates {
  private readonly config: Config;
  private readonly store: Store;
  private readonly discord: DiscordGateway;
  private readonly log: Logger;

  constructor(config: Config, store: Store, discord: DiscordGateway, log: Logger) {
    this.config = config;
    this.store = store;
    this.discord = discord;
    this.log = log;
  }

  async post({ kind, key, message, title, headSha, state }: NewPost): Promise<Post> {
    const channelId = this.config.discord.updatesChannelId;
    const messageId = await this.discord.send(channelId, message);
    const post: Post = {
      kind,
      key: String(key),
      channelId,
      messageId,
      threadId: null,
      headSha: headSha ?? null,
      reactions: {},
      state: { title, ...state },
    };
    this.store.savePost(post);
    this.log.info(`posted ${kind} ${key}`);
    return post;
  }

  /** Shows `emoji` in the slot (replacing whatever was there), or clears the slot when `emoji` is null. */
  async setReaction(post: Post, slot: ReactionSlot, emoji: string | null): Promise<void> {
    const current = post.reactions[slot] ?? null;
    if (current === emoji) return;

    // Another slot may be showing the same emoji (e.g. ✅ for both CI and "completed");
    // Discord has only one reaction per emoji per user, so leave it alone if so.
    const sharedElsewhere = (e: string) => Object.entries(post.reactions).some(([s, other]) => s !== slot && other === e);

    try {
      if (current && !sharedElsewhere(current)) {
        await this.discord.removeOwnReaction(post.channelId, post.messageId, current);
      }
      if (emoji && !sharedElsewhere(emoji)) {
        await this.discord.addReaction(post.channelId, post.messageId, emoji);
      }
    } catch (error) {
      this.log.warn(`could not update ${slot} reaction on ${post.kind} ${post.key}`, error);
      return;
    }

    if (emoji) post.reactions[slot] = emoji;
    else delete post.reactions[slot];
    this.store.savePost(post);
  }

  /** Adds a line to the post's follow-up thread, creating the thread on first use. */
  async note(post: Post, text: string): Promise<void> {
    const { enabled, autoArchiveMinutes } = this.config.threads;
    if (!enabled) return;

    try {
      if (!post.threadId) {
        const name = typeof post.state.title === "string" ? post.state.title : `${post.kind} ${post.key}`;
        post.threadId = await this.discord.startThread(post.channelId, post.messageId, name, autoArchiveMinutes);
        this.store.savePost(post);
      }
      await this.discord.send(post.threadId, { content: text, suppressEmbeds: true });
    } catch (error) {
      this.log.warn(`could not add a thread note to ${post.kind} ${post.key}`, error);
    }
  }

  /** Replies to the post in the main channel, for things people must see (e.g. a late role ping). */
  async reply(post: Post, message: OutgoingMessage): Promise<void> {
    try {
      await this.discord.send(post.channelId, { ...message, replyToMessageId: post.messageId });
    } catch (error) {
      this.log.warn(`could not reply to ${post.kind} ${post.key}`, error);
    }
  }

  save(post: Post): void {
    this.store.savePost(post);
  }
}
