import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { getBrowserLaunch, serveViewer } from "../dist/index.js";

test("serves viewer files with security headers and rejects unsafe requests", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "atlas-server-"));
  const outside = resolve(root, "../atlas-server-secret.txt");
  await writeFile(resolve(root, "index.html"), "<!doctype html><title>Atlas test</title>");
  await writeFile(resolve(root, "app.js"), "console.log('atlas');\n");
  await writeFile(outside, "must not be served\n");
  if (process.platform !== "win32") await symlink(outside, resolve(root, "leak.txt"));

  const server = await serveViewer(root, 0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  try {
    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    const csp = index.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /font-src 'self' data:/);
    assert.match(csp, /script-src 'self';/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.equal(index.headers.get("x-content-type-options"), "nosniff");
    assert.match(await index.text(), /Atlas test/);

    const head = await fetch(`http://127.0.0.1:${port}/app.js`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    assert.equal((await rawRequest(port, "/%E0%A4%A")).status, 400);
    assert.equal((await rawRequest(port, "/../../package.json")).status, 404);
    if (process.platform !== "win32") assert.equal((await rawRequest(port, "/leak.txt")).status, 403);
  } finally {
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  }
});

test("rejects missing viewers and uses shell-free browser commands", async () => {
  await assert.rejects(() => serveViewer(resolve(tmpdir(), "atlas-does-not-exist"), 0), /Viewer not found/);
  const target = "C:\\project & tools\\viewer.html";
  assert.deepEqual(getBrowserLaunch(target, "win32"), { command: "explorer.exe", args: [target] });
  assert.deepEqual(getBrowserLaunch("https://localhost", "darwin"), { command: "open", args: ["https://localhost"] });
  assert.deepEqual(getBrowserLaunch("https://localhost", "linux"), { command: "xdg-open", args: ["https://localhost"] });
});

function rawRequest(port, path) {
  return new Promise((resolvePromise, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise({ status: response.statusCode, headers: response.headers }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}
