import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { silentLogger } from "../src/log.ts";
import { type WebhookDelivery, createWebhookServer, verifySignature } from "../src/webhook-server.ts";

const SECRET = "It's a Secret to Everybody";

describe("verifySignature", () => {
  it("matches GitHub's documented example", () => {
    // https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#testing-the-webhook-payload-validation
    const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    assert.ok(verifySignature(SECRET, Buffer.from("Hello, World!"), signature));
    assert.ok(!verifySignature(SECRET, Buffer.from("Hello, World?"), signature));
    assert.ok(!verifySignature(SECRET, Buffer.from("Hello, World!"), undefined));
    assert.ok(!verifySignature(SECRET, Buffer.from("Hello, World!"), "sha256=00"));
  });
});

describe("webhook server", () => {
  const received: WebhookDelivery[] = [];
  const server = createWebhookServer({ path: "/webhook", secret: SECRET, log: silentLogger, onDelivery: (d) => received.push(d) });
  let base = "";

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const deliver = (body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/webhook`, {
      method: "POST",
      body,
      headers: {
        "x-github-event": "issues",
        "x-github-delivery": "abc-123",
        "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
        ...headers,
      },
    });

  it("accepts signed deliveries and hands them on", async () => {
    const response = await deliver('{"action":"opened"}');
    assert.equal(response.status, 202);
    assert.deepEqual(received.at(-1), { id: "abc-123", event: "issues", payload: { action: "opened" } });
  });

  it("rejects bad signatures, wrong paths and non-JSON bodies", async () => {
    const count = received.length;
    assert.equal((await deliver("{}", { "x-hub-signature-256": "sha256=nope" })).status, 401);
    assert.equal((await deliver("action=opened")).status, 400);
    assert.equal((await fetch(`${base}/elsewhere`, { method: "POST" })).status, 404);
    assert.equal(received.length, count);
  });

  it("answers health checks", async () => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  });
});
