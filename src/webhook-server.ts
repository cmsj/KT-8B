import { createHmac, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Logger } from "./log.ts";

const MAX_BODY_BYTES = 25 * 1024 * 1024; // GitHub's own cap on webhook payloads

export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface WebhookDelivery {
  id: string;
  event: string;
  payload: unknown;
}

export interface WebhookServerOptions {
  path: string;
  secret: string;
  log: Logger;
  /** Called after GitHub has been answered; must not throw. */
  onDelivery: (delivery: WebhookDelivery) => void;
}

/**
 * Accepts GitHub webhooks: verifies the signature, answers immediately (GitHub
 * gives up after 10 seconds) and hands the event on.
 */
export function createWebhookServer(options: WebhookServerOptions): Server {
  return createServer((req, res) => {
    handle(options, req, res).catch((error) => {
      options.log.error("webhook request failed", error);
      if (!res.headersSent) respond(res, 500, "internal error");
    });
  });
}

async function handle(options: WebhookServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/healthz") return respond(res, 200, "ok");
  if (url.pathname !== options.path) return respond(res, 404, "not found");
  if (req.method !== "POST") return respond(res, 405, "method not allowed");

  const body = await readBody(req);
  if (body === null) return respond(res, 413, "payload too large");

  if (!verifySignature(options.secret, body, header(req, "x-hub-signature-256"))) {
    options.log.warn("rejected webhook with a bad signature");
    return respond(res, 401, "bad signature");
  }

  const event = header(req, "x-github-event");
  const id = header(req, "x-github-delivery");
  if (!event || !id) return respond(res, 400, "missing GitHub headers");

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return respond(res, 400, "body is not JSON (set the webhook content type to application/json)");
  }

  respond(res, 202, "accepted");
  options.onDelivery({ id, event, payload });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function respond(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain" }).end(text);
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
