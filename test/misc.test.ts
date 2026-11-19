import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig } from "../src/config.ts";
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

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-config-"));
  const env = { DISCORD_TOKEN: "t", GITHUB_WEBHOOK_SECRET: "s" };

  it("explains a missing file, a directory in its place, and bad JSON", () => {
    assert.throws(() => loadConfig(join(dir, "nope.json"), env), /No config file at .*nope\.json/);
    assert.throws(() => loadConfig(dir, env), /is a directory, not a config file/);
    writeFileSync(join(dir, "bad.json"), "{ nope");
    assert.throws(() => loadConfig(join(dir, "bad.json"), env), /bad\.json is not valid JSON/);
  });

  it("loads a valid file", () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ github: { repo: "a/b" }, discord: { updatesChannelId: "123456789012345678" } }));
    assert.equal(loadConfig(path, env).github.repo, "a/b");
  });
});
