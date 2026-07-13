import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the Atlas product page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Atlas - Architecture Intelligence Engine(?: \| Atlas)?<\/title>/i,
  );
  assert.match(html, /Google Maps for a NestJS codebase/i);
  assert.match(html, /Static analysis first/i);
  assert.match(html, /atlas_find_node/i);
  assert.match(html, /No cloud, no telemetry, no hidden uploads/i);
});

test("exposes the main page sections", async () => {
  const response = await render();
  const html = await response.text();

  for (const sectionId of ["graph", "scope", "start", "mcp", "privacy"]) {
    assert.match(html, new RegExp(`id=["']${sectionId}["']`, "i"));
  }
});
