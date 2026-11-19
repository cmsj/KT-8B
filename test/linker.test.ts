import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IssueLookup, extractReferences, linkReferences } from "../src/chat/linker.ts";
import { silentLogger } from "../src/log.ts";

describe("extractReferences", () => {
  it("finds issue numbers in prose", () => {
    assert.deepEqual(extractReferences("see #12 and #345, also (#6)", 5), [12, 345, 6]);
    assert.deepEqual(extractReferences("#1 #1 #2", 5), [1, 2]);
    assert.deepEqual(extractReferences("#1 #2 #3", 2), [1, 2]);
  });

  it("ignores code, links, mentions and things that aren't references", () => {
    assert.deepEqual(
      extractReferences(
        "`#1` ```\n#2\n``` https://example.com/#3 <#123456789012345678> &#38; abc#4 ##5 #0 #9999999999 / #6",
        10,
      ),
      [6],
    );
  });
});

function fakeFetch(responses: Record<number, { status: number; body?: unknown }>): typeof fetch {
  return (async (url: string) => {
    const number = Number(url.split("/").pop());
    const r = responses[number] ?? { status: 500 };
    return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status });
  }) as typeof fetch;
}

describe("linkReferences", () => {
  it("describes issues and PRs, drops missing ones, and falls back to bare links", async () => {
    const lookup = new IssueLookup(
      "octo/widgets",
      undefined,
      silentLogger,
      fakeFetch({
        1: { status: 200, body: { number: 1, title: "Crash *on* launch", html_url: "https://github.com/octo/widgets/issues/1", state: "closed", state_reason: "completed" } },
        2: { status: 200, body: { number: 2, title: "Fix it", html_url: "https://github.com/octo/widgets/pull/2", state: "closed", pull_request: { merged_at: "2026-01-01" } } },
        3: { status: 404 },
      }),
    );
    assert.deepEqual(await linkReferences("octo/widgets", [1, 2, 3, 4], lookup), [
      "[#1](<https://github.com/octo/widgets/issues/1>) Crash \\*on\\* launch *(issue, closed)*",
      "[#2](<https://github.com/octo/widgets/pull/2>) Fix it *(PR, merged)*",
      "[#4](<https://github.com/octo/widgets/issues/4>)",
    ]);
  });
});
