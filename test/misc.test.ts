import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig } from "../src/config.ts";
import { encodeEmoji } from "../src/discord/gateway.ts";
import { summarize } from "../src/render.ts";

describe("summarize", () => {
  it("strips template comments and truncates at a word boundary", () => {
    assert.equal(summarize("<!-- fill this in -->\n\n\n\nHello", 100), "Hello");
    assert.equal(summarize("<!-- only a comment -->", 100), undefined);
    assert.equal(summarize("one two three four five", 16), "one two three …");
  });
});

describe("encodeEmoji", () => {
  it("encodes unicode and custom emoji for the reactions endpoint", () => {
    assert.equal(encodeEmoji("✅"), "%E2%9C%85");
    assert.equal(encodeEmoji("<:ci_ok:123456789>"), "ci_ok%3A123456789");
    assert.equal(encodeEmoji("<a:spin:42>"), "spin%3A42");
  });
});

describe("parseConfig", () => {
  const env = { DISCORD_TOKEN: "t", GITHUB_WEBHOOK_SECRET: "s" };

  it("fills in defaults", () => {
    const config = parseConfig({ github: { repo: "a/b" }, discord: { updatesChannelId: "123456789012345678" } }, env);
    assert.equal(config.server.port, 8080);
    assert.equal(config.emoji.ciFailure, "🔴");
    assert.equal(config.threads.enabled, true);
  });

  it("explains what's wrong", () => {
    assert.throws(() => parseConfig({ github: { repo: "nope" }, discord: { updatesChannelId: "x" } }, env), /owner\/name[\s\S]*snowflake/);
    assert.throws(() => parseConfig({ github: { repo: "a/b" }, discord: { updatesChannelId: "123456789012345678" } }, {}), /DISCORD_TOKEN/);
  });
});
